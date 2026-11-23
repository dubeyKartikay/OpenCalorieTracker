import { DatabaseSync } from 'node:sqlite';
import { existsSync, linkSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FOOD_COLUMNS, foodSchema, metaSchema } from './model.ts';
import type { Dataset } from './model.ts';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts';
import { normalizeGtin14 } from './barcode.ts';
import { validatePack } from './validator.ts';
import type { ValidationReport } from './validator.ts';

export interface BuildOptions { overwrite?: boolean; builtAt?: string }
export interface BuildResult { output: string; report: ValidationReport; warnings: string[] }

/** Build off to the side, validate, then publish atomically. Never leave a partial output. */
export async function buildPack(dataset: Dataset, output: string, options: BuildOptions = {}): Promise<BuildResult> {
  const destination = resolve(output);
  if (!destination.endsWith('.octpack.sqlite')) throw new Error('Output must end in .octpack.sqlite');
  if (!options.overwrite && existsSync(destination)) throw new Error(`Output already exists: ${destination} (use --force)`);
  const meta = metaSchema.parse(dataset.meta);
  const builtAt = options.builtAt ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(builtAt) || !Number.isFinite(Date.parse(builtAt))) throw new Error('builtAt must be an ISO date-time');
  const temporary = `${destination}.${randomUUID()}.tmp`;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(temporary);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE;');
    db.exec(SCHEMA_SQL);
    db.exec(`PRAGMA user_version=${SCHEMA_VERSION}; BEGIN IMMEDIATE;`);
    const foodInsert = db.prepare(`INSERT INTO foods (${FOOD_COLUMNS.join(',')}) VALUES (${FOOD_COLUMNS.map(() => '?').join(',')})`);
    const aliasInsert = db.prepare('INSERT INTO food_aliases(food_id,alias,lang) VALUES(?,?,?)');
    const unitInsert = db.prepare('INSERT INTO food_units(food_id,label,grams,ml) VALUES(?,?,?,?)');
    const barcodeInsert = db.prepare('INSERT INTO food_barcodes(raw_code,symbology,gtin14,food_id) VALUES(?,?,?,?)');
    const ftsInsert = db.prepare('INSERT INTO foods_fts(food_id,name,brand,aliases) VALUES(?,?,?,?)');
    let count = 0;
    for await (const input of dataset.foods) {
      const food = foodSchema.parse(input);
      foodInsert.run(...FOOD_COLUMNS.map(key => food[key]));
      for (const alias of food.aliases) aliasInsert.run(food.id, alias.alias, alias.lang);
      for (const unit of food.units) unitInsert.run(food.id, unit.label, unit.grams, unit.ml);
      for (const barcode of food.barcodes) {
        barcodeInsert.run(barcode.raw_code, barcode.symbology, normalizeGtin14(barcode.raw_code, barcode.symbology), food.id);
      }
      ftsInsert.run(food.id, food.name, food.brand, food.aliases.map(value => value.alias).join(' '));
      count++;
    }
    if (count === 0) throw new Error('Refusing to build an empty food pack');
    db.prepare('INSERT INTO pack_meta VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
      meta.pack_id, meta.name, meta.version, meta.kind, meta.region, meta.license,
      meta.attribution_text, meta.attribution_url, SCHEMA_VERSION, builtAt, count,
    );
    db.exec("INSERT INTO foods_fts(foods_fts) VALUES('optimize'); COMMIT; PRAGMA journal_mode=DELETE; ANALYZE; VACUUM;");
    db.close(); db = undefined;
    const report = validatePack(temporary);
    if (!report.valid) throw new Error(`Built pack failed validation: ${report.errors.join('; ')}`);
    if (options.overwrite) renameSync(temporary, destination);
    else { linkSync(temporary, destination); rmSync(temporary); }
    return { output: destination, report, warnings: [...dataset.warnings] };
  } finally {
    db?.close();
    for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(temporary + suffix, { force: true });
  }
}
