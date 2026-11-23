import { foodRecordSchema, normalizeBarcode, nutrientKeys, packMetaSchema } from '../domain';
import type { FoodRecord, FoodUnit, NormalizedBarcode, PackMeta } from '../domain';
import type { SqlDatabase } from '../storage/driver';
import { matchTier, preferredPreparation, queryTokens } from './ranker';
import type { FoodSourceAdapter, SearchCandidate, SearchOptions } from './types';

export async function validatePackDatabase(db: SqlDatabase): Promise<PackMeta> {
  const required = ['pack_meta', 'foods', 'food_aliases', 'food_units', 'food_barcodes', 'foods_fts'];
  const tables = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
  for (const name of required) if (!tables.some((table) => table.name === name)) throw new Error(`Invalid pack: missing table ${name}`);
  // Select only contract metadata; pack-builder also stores built_at and food_count.
  const metas = await db.getAllAsync<PackMeta>('SELECT pack_id,name,version,kind,region,license,attribution_text,attribution_url,schema_version FROM pack_meta');
  if (metas.length !== 1) throw new Error('Invalid pack: expected one metadata row');
  const meta = packMetaSchema.parse(metas[0]);
  if (meta.schema_version !== 1) throw new Error(`Unsupported pack schema version: ${meta.schema_version}`);
  const fts = await db.getFirstAsync<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name='foods_fts'");
  if (!fts || !/USING\s+fts5\s*\(/i.test(fts.sql)) throw new Error('Invalid pack: foods_fts must use FTS5');
  await db.getAllAsync("SELECT food_id,bm25(foods_fts) FROM foods_fts WHERE foods_fts MATCH ? LIMIT 1", '"octpackvalidationprobe"*');
  // Verify the columns needed by the reader before mounting.
  await db.getAllAsync(`SELECT id,name,brand,category,prep_state,basis,serving_g,serving_ml,${nutrientKeys.join(',')} FROM foods LIMIT 0`);
  await db.getAllAsync('SELECT food_id,alias,lang FROM food_aliases LIMIT 0');
  await db.getAllAsync('SELECT food_id,label,grams,ml FROM food_units LIMIT 0');
  await db.getAllAsync('SELECT food_id,raw_code,symbology,gtin14 FROM food_barcodes LIMIT 0');
  return meta;
}

/** Tokenize user text, quote every token, then add only our own prefix/OR operators. */
export function sanitizeFtsQuery(query: string): string {
  return [...new Set(queryTokens(query))].map((token) => `"${token.replace(/"/g, '""')}"*`).join(' OR ');
}

export class SqlitePackAdapter implements FoodSourceAdapter {
  readonly bucket = 'database' as const;
  readonly sourceId: string;
  constructor(private readonly db: SqlDatabase, private readonly meta: PackMeta, public priority = 100) { this.sourceId = meta.pack_id; }
  static async create(db: SqlDatabase, priority = 100): Promise<SqlitePackAdapter> { return new SqlitePackAdapter(db, await validatePackDatabase(db), priority); }
  async getMeta(): Promise<PackMeta> { return { ...this.meta }; }
  private async hydrate(row: Record<string, unknown>): Promise<FoodRecord> {
    const units = await this.db.getAllAsync<FoodUnit>('SELECT label,grams,ml FROM food_units WHERE food_id=? ORDER BY id', String(row.id));
    return foodRecordSchema.parse({
      id: row.id, name: row.name, brand: row.brand, category: row.category,
      prep_state: row.prep_state, basis: row.basis, serving_g: row.serving_g, serving_ml: row.serving_ml,
      nutrients: Object.fromEntries(nutrientKeys.map((key) => [key, row[key]])), units,
      provenance_kind: 'database', source_pack_id: this.meta.pack_id, source_id: row.id, source_version: this.meta.version,
    });
  }
  async getById(id: string): Promise<FoodRecord | null> {
    const row = await this.db.getFirstAsync<Record<string, unknown>>('SELECT * FROM foods WHERE id=?', id);
    return row ? this.hydrate(row) : null;
  }
  async search(query: string, options: SearchOptions = {}): Promise<SearchCandidate[]> {
    const fts = sanitizeFtsQuery(query);
    if (!fts) return [];
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Search limit must be a positive integer');
    const rows = await this.db.getAllAsync<Record<string, unknown>>(`SELECT foods.*,bm25(foods_fts) AS within_score
      FROM foods_fts JOIN foods ON foods.id=foods_fts.food_id WHERE foods_fts MATCH ?
      ORDER BY within_score,foods.id LIMIT ?`, fts, limit);
    const prep = preferredPreparation(query, options.preferredPrepState);
    return Promise.all(rows.map(async (row, index) => {
      const food = await this.hydrate(row);
      const aliases = await this.db.getAllAsync<{ alias: string }>('SELECT alias FROM food_aliases WHERE food_id=? ORDER BY id', food.id);
      const bestAlias = aliases.map(({ alias }) => ({ alias, tier: matchTier(alias, query) })).sort((a, b) => a.tier - b.tier)[0];
      const nameTier = matchTier(food.name, query);
      return {
        food, bucket: this.bucket, sourceLabel: this.meta.name, packPriority: this.priority,
        matchTier: Math.min(nameTier, bestAlias?.tier ?? 3) as SearchCandidate['matchTier'],
        matchedAlias: bestAlias && bestAlias.tier <= nameTier ? bestAlias.alias : null,
        prepStateMatch: prep !== undefined && food.prep_state === prep, withinPackRank: index,
      };
    }));
  }
  async lookupBarcode(code: NormalizedBarcode): Promise<FoodRecord | null> {
    const rows = await this.db.getAllAsync<{ food_id: string; raw_code: string; symbology: string; gtin14: string | null }>(
      'SELECT food_id,raw_code,symbology,gtin14 FROM food_barcodes WHERE gtin14=? OR raw_code=? ORDER BY id', code.gtin14, code.rawCode);
    for (const row of rows) {
      if (row.gtin14 === code.gtin14) return this.getById(row.food_id);
      // Legacy raw-only rows still need symbology disambiguation (UPC-E != EAN-8).
      // Normalize spelling variants such as UPC-E/upc_e rather than comparing strings.
      try {
        if (normalizeBarcode(row.raw_code, row.symbology).gtin14 === code.gtin14) return this.getById(row.food_id);
      } catch { /* A malformed raw-only pack row cannot resolve this valid scan. */ }
    }
    return null;
  }
  async close(): Promise<void> { await this.db.closeAsync(); }
}
