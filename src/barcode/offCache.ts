import { z } from 'zod';
import { foodRecordSchema } from '../domain';
import type { FoodRecord, NormalizedBarcode } from '../domain';
import type { SqlDatabase } from '../storage/driver';
import type { BarcodeAttribution, OffProduct } from './types';

const attributionSchema = z.strictObject({ name: z.string().trim().min(1), license: z.string().trim().min(1), url: z.url().nullable() });

/** Supply a dedicated off_cache.sqlite handle. Never initialize this schema in user.db. */
export async function initOffCache(db: SqlDatabase): Promise<void> {
  const userTable = await db.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('custom_foods','diary_entries','foods') LIMIT 1");
  if (userTable) throw new Error('OFF cache requires an isolated database, separate from user.db and food packs');
  await db.execAsync(`CREATE TABLE IF NOT EXISTS off_products (
    gtin14 TEXT PRIMARY KEY, raw_code TEXT NOT NULL, symbology TEXT NOT NULL,
    food_json TEXT NOT NULL, attribution_json TEXT NOT NULL, fetched_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS off_products_raw_code ON off_products(raw_code);`);
}

export async function getCachedOffProduct(db: SqlDatabase, normalized: NormalizedBarcode): Promise<OffProduct | null> {
  const row = await db.getFirstAsync<{ food_json: string; attribution_json: string }>('SELECT food_json,attribution_json FROM off_products WHERE gtin14=?', normalized.gtin14);
  return row ? { food: foodRecordSchema.parse(JSON.parse(row.food_json)), attribution: attributionSchema.parse(JSON.parse(row.attribution_json)) } : null;
}

export async function putCachedOffProduct(db: SqlDatabase, normalized: NormalizedBarcode, input: FoodRecord, attribution: BarcodeAttribution): Promise<void> {
  const food = foodRecordSchema.parse(input);
  const credit = attributionSchema.parse(attribution);
  await db.runAsync(`INSERT INTO off_products(gtin14,raw_code,symbology,food_json,attribution_json,fetched_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(gtin14) DO UPDATE SET raw_code=excluded.raw_code,symbology=excluded.symbology,
    food_json=excluded.food_json,attribution_json=excluded.attribution_json,fetched_at=excluded.fetched_at`,
  normalized.gtin14, normalized.rawCode, normalized.symbology, JSON.stringify(food), JSON.stringify(credit), new Date().toISOString());
}
