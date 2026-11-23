import { DatabaseSync } from 'node:sqlite';
import { statSync } from 'node:fs';
import { aliasSchema, foodSchema, metaSchema, OPTIONAL_NUTRIENTS, unitSchema } from './model.ts';
import { normalizeGtin14 } from './barcode.ts';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts';

export interface NutrientCoverage { known: number; missing: number; zero: number; percent: number }
export interface ValidationReport {
  valid: boolean;
  errors: string[];
  file_size_bytes: number;
  counts: Record<string, number>;
  coverage: Record<string, NutrientCoverage>;
}

const tables = ['pack_meta', 'foods', 'food_aliases', 'food_units', 'food_barcodes', 'foods_fts'];
const normalizeSql = (value: string) => value.toLowerCase().replace(/[\s"`\[\]]/g, '');

function validateSchema(db: DatabaseSync, errors: string[]): void {
  const reference = new DatabaseSync(':memory:');
  try {
    reference.exec(SCHEMA_SQL);
    for (const table of tables) {
      const expected = reference.prepare(`PRAGMA table_info(${table})`).all();
      const actual = db.prepare(`PRAGMA table_info(${table})`).all();
      if (JSON.stringify(expected) !== JSON.stringify(actual)) errors.push(`Schema mismatch: ${table} columns, types, nullability, defaults or primary key`);
    }
    const sqlFor = (database: DatabaseSync, name: string): string => String(database.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(name)?.sql ?? '');
    const constraints: Record<string, string[]> = {
      pack_meta: ["CHECK(kind IN ('reference','branded','regional','custom'))"],
      foods: ["CHECK(prep_state IN ('raw','cooked','prepared','unknown'))", "CHECK(basis IN ('per_100g','per_100ml','per_serving'))"],
      food_units: ['CHECK(grams IS NOT NULL OR ml IS NOT NULL)', 'AUTOINCREMENT'],
      food_aliases: ['AUTOINCREMENT'], food_barcodes: ['AUTOINCREMENT'],
      foods_fts: ["USING fts5(", 'food_id UNINDEXED', "tokenize='unicode61 remove_diacritics 2'"],
    };
    for (const [table, fragments] of Object.entries(constraints)) {
      const sql = normalizeSql(sqlFor(db, table));
      for (const fragment of fragments) if (!sql.includes(normalizeSql(fragment))) errors.push(`Schema ${table}: missing ${fragment}`);
    }
    for (const table of ['food_aliases', 'food_units', 'food_barcodes']) {
      const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${table})`).all();
      if (!foreignKeys.some(row => row.table === 'foods' && row.from === 'food_id' && row.to === 'id')) errors.push(`Missing food foreign key: ${table}`);
    }
    // Match indexed expressions rather than relying on arbitrary index names.
    const indexes = db.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL").all().map(row => normalizeSql(String(row.sql)));
    for (const expected of reference.prepare("SELECT name,sql FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL").all()) {
      const target = normalizeSql(String(expected.sql).split(/\bON\b/i)[1]!);
      if (!indexes.some(sql => sql.endsWith(`on${target}`))) errors.push(`Missing complete index: ${expected.name}`);
    }
  } finally { reference.close(); }
}

/** Opens packs read-only. Unknown source values cannot be inferred from a stored zero. */
export function validatePack(path: string): ValidationReport {
  const report: ValidationReport = { valid: false, errors: [], file_size_bytes: 0, counts: {}, coverage: {} };
  const errors = report.errors;
  let db: DatabaseSync | undefined;
  let suppressed = 0;
  const error = (message: string) => { if (errors.length < 100) errors.push(message); else suppressed++; };
  try {
    report.file_size_bytes = statSync(path).size;
    db = new DatabaseSync(path, { readOnly: true });
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') error('SQLite integrity check failed');
    validateSchema(db, errors);
    // Stop before querying absent/malformed columns; schema errors are actionable.
    if (errors.length) return report;
    if (db.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'delete') error('Pack journal mode must be DELETE');
    if (db.prepare('PRAGMA user_version').get()?.user_version !== SCHEMA_VERSION) error('Unsupported SQLite user_version');
    if (db.prepare('PRAGMA foreign_key_check').all().length) error('Broken food foreign key references');
    for (const table of tables) report.counts[table] = Number(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count);
    const metadata = db.prepare('SELECT * FROM pack_meta').all();
    if (metadata.length !== 1) error('Pack must contain exactly one pack_meta row');
    for (const row of metadata) {
      const { built_at, schema_version, food_count, ...meta } = row;
      if (!metaSchema.safeParse(meta).success) error('Invalid pack_meta fields');
      if (schema_version !== SCHEMA_VERSION) error(`Unsupported schema_version: ${schema_version}`);
      if (typeof built_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(built_at) || !Number.isFinite(Date.parse(built_at))) error('Invalid pack built_at timestamp');
      if (food_count !== report.counts.foods) error('pack_meta.food_count does not match foods');
    }
    if (!report.counts.foods) error('Pack must contain foods');
    for (const row of db.prepare('SELECT * FROM foods').iterate()) {
      const result = foodSchema.safeParse(row);
      if (!result.success) error(`Invalid food ${row.id}: ${result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ')}`);
    }
    for (const row of db.prepare('SELECT * FROM food_aliases').iterate()) {
      if (!aliasSchema.safeParse({ alias: row.alias, lang: row.lang }).success) error(`Invalid alias ${row.id}`);
    }
    for (const row of db.prepare('SELECT * FROM food_units').iterate()) {
      if (!unitSchema.safeParse({ label: row.label, grams: row.grams, ml: row.ml }).success) error(`Invalid unit ${row.id}`);
    }
    for (const row of db.prepare('SELECT * FROM food_barcodes').iterate()) {
      try {
        if (typeof row.raw_code !== 'string' || !row.raw_code.trim() || typeof row.symbology !== 'string' || !row.symbology.trim()) throw new Error('empty code or symbology');
        if (normalizeGtin14(row.raw_code, row.symbology) !== row.gtin14) throw new Error('stored gtin14 differs from normalization');
      } catch (cause) { error(`Invalid barcode ${row.id}: ${cause instanceof Error ? cause.message : String(cause)}`); }
    }
    if (report.counts.foods_fts !== report.counts.foods) error('FTS row count does not match foods');
    const badFts = db.prepare(`
      SELECT count(*) AS count FROM foods_fts s
      LEFT JOIN foods f ON f.id=s.food_id
      LEFT JOIN (SELECT food_id,group_concat(alias,' ') AS aliases FROM
        (SELECT food_id,alias FROM food_aliases ORDER BY id) GROUP BY food_id) a ON a.food_id=s.food_id
      WHERE f.id IS NULL OR s.name IS NOT f.name OR s.brand IS NOT f.brand
        OR s.aliases IS NOT coalesce(a.aliases,'')
    `).get()!;
    if (Number(badFts.count)) error('FTS content differs from foods or aliases');
    if (db.prepare('SELECT food_id FROM foods_fts GROUP BY food_id HAVING count(*) != 1 LIMIT 1').get()) error('Duplicate food_id in FTS');
    db.prepare("SELECT food_id FROM foods_fts WHERE foods_fts MATCH 'octpackvalidationtoken' LIMIT 1").all();
    for (const row of db.prepare('SELECT id,name FROM foods LIMIT 10').all()) {
      const name = String(row.name);
      // Let unicode61 tokenize the complete phrase. JS letter regexes split
      // decomposed accents differently (e.g. a + combining acute + bc).
      const phrase = `"${name.replace(/"/g, '""')}"`;
      if (/[\p{L}\p{N}]/u.test(name) && !db.prepare('SELECT food_id FROM foods_fts WHERE foods_fts MATCH ? AND food_id=?').get(phrase, row.id!)) error(`FTS index cannot find food ${row.id}`);
    }
    for (const key of OPTIONAL_NUTRIENTS) {
      const row = db.prepare(`SELECT count(${key}) AS known, sum(CASE WHEN ${key}=0 THEN 1 ELSE 0 END) AS zero FROM foods`).get()!;
      const known = Number(row.known), total = report.counts.foods!;
      report.coverage[key] = { known, missing: total - known, zero: Number(row.zero ?? 0), percent: total ? 100 * known / total : 0 };
    }
    if (suppressed) errors.push(`${suppressed} additional data errors omitted`);
    report.valid = errors.length === 0;
  } catch (cause) { error(cause instanceof Error ? cause.message : String(cause)); }
  finally { db?.close(); }
  return report;
}
