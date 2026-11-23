import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { SCHEMA_SQL } from '../../../tools/pack-builder/src/schema';
import { foodRecordSchema, generateId, normalizeBarcode, nutrientKeys, nutrientProfileSchema } from '../../domain';
import type { DiaryEntrySnapshot, FoodRecord, PackMeta } from '../../domain';
import type { SqlDatabase } from '../driver';
import { migrateDatabase } from '../migrations';
import { createNodeSqliteDriver } from '../nodeDriver';

export const at = '2026-11-23T12:30:00+05:30';
export const meta = (id = 'usda'): PackMeta => ({ pack_id: id, name: id === 'usda' ? 'USDA Reference' : 'Home foods', version: '2026.1', kind: id === 'usda' ? 'reference' : 'custom', region: null, license: 'CC0', attribution_text: 'Test source', attribution_url: null, schema_version: 1 });
export function food(overrides: Partial<FoodRecord> = {}): FoodRecord {
  return foodRecordSchema.parse({ id: 'rice', name: 'Rice', basis: 'per_100g', prep_state: 'cooked', nutrients: nutrientProfileSchema.parse({ kcal: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3, fiber_g: null, sugar_g: 0 }), provenance_kind: 'database', source_pack_id: 'usda', source_id: 'rice', source_version: '2026.1', ...overrides });
}
export function entry(overrides: Partial<DiaryEntrySnapshot> = {}): DiaryEntrySnapshot {
  const record = food();
  return { id: generateId(), idempotency_key: generateId(), date: '2026-11-23', occurred_at: at, time_zone: 'Asia/Kolkata', meal: 'Lunch', food: record, quantity: { amount: 100, unit: 'g' }, nutrients: record.nutrients, provenance_kind: 'database', portion_certainty: 'stated', estimate_range: null, draft_state: 'confirmed', ...overrides };
}
export function resources() {
  const databases = new Set<SqlDatabase>();
  const directories: string[] = [];
  afterEach(async () => {
    for (const db of databases) await db.closeAsync().catch(() => undefined);
    for (const directory of directories) await rm(directory, { recursive: true, force: true });
    databases.clear(); directories.length = 0;
  });
  return {
    open(path = ':memory:', readOnly = false) { const db = createNodeSqliteDriver(path, { readOnly }); databases.add(db); return db; },
    async user(path = ':memory:') { const db = this.open(path); await migrateDatabase(db); return db; },
    async directory() { const directory = await mkdtemp(join(tmpdir(), 'oct-wave2a-')); directories.push(directory); return directory; },
  };
}
export interface PackFood { food: FoodRecord; aliases?: string[]; barcodes?: { rawCode: string; symbology: string }[] }
/** Build the exact pack-builder SQL contract, including a real unicode61 FTS5 index. */
export async function buildFixturePack(db: SqlDatabase, metadata: PackMeta, records: PackFood[]): Promise<void> {
  await db.execAsync(SCHEMA_SQL);
  await db.runAsync('INSERT INTO pack_meta VALUES(?,?,?,?,?,?,?,?,?,?,?)', metadata.pack_id, metadata.name, metadata.version, metadata.kind, metadata.region, metadata.license, metadata.attribution_text, metadata.attribution_url, metadata.schema_version, at, records.length);
  for (const { food: record, aliases = [], barcodes = [] } of records) {
    const columns = ['id', 'name', 'brand', 'category', 'prep_state', 'basis', 'serving_g', 'serving_ml', ...nutrientKeys];
    await db.runAsync(`INSERT INTO foods(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, record.id, record.name, record.brand, record.category, record.prep_state, record.basis, record.serving_g, record.serving_ml, ...nutrientKeys.map((key) => record.nutrients[key]));
    for (const alias of aliases) await db.runAsync('INSERT INTO food_aliases(food_id,alias) VALUES(?,?)', record.id, alias);
    for (const unit of record.units) await db.runAsync('INSERT INTO food_units(food_id,label,grams,ml) VALUES(?,?,?,?)', record.id, unit.label, unit.grams, unit.ml);
    for (const barcode of barcodes) {
      const normalized = normalizeBarcode(barcode.rawCode, barcode.symbology);
      await db.runAsync('INSERT INTO food_barcodes(food_id,raw_code,symbology,gtin14) VALUES(?,?,?,?)', record.id, normalized.rawCode, normalized.symbology, normalized.gtin14);
    }
    await db.runAsync('INSERT INTO foods_fts(food_id,name,brand,aliases) VALUES(?,?,?,?)', record.id, record.name, record.brand, aliases.join(' '));
  }
}
