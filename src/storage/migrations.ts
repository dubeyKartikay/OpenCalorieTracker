import type { SqlDatabase } from './driver';

export const USER_SCHEMA_VERSION = 3;
const migrations = [String.raw`
CREATE TABLE diary_days (date TEXT PRIMARY KEY, completeness TEXT NOT NULL CHECK(completeness IN ('complete','partial','none')), updated_at TEXT NOT NULL);
CREATE TABLE diary_entries (id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE NOT NULL, date TEXT NOT NULL, occurred_at TEXT NOT NULL, time_zone TEXT NOT NULL, meal TEXT NOT NULL, draft_state TEXT NOT NULL CHECK(draft_state IN ('draft','confirmed')), snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX diary_entries_date_meal ON diary_entries(date, meal);
CREATE INDEX diary_entries_draft_state ON diary_entries(draft_state);
CREATE TABLE custom_foods (id TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT, food_json TEXT NOT NULL, barcode_raw TEXT, barcode_symbology TEXT, barcode_gtin14 TEXT, updated_at TEXT NOT NULL);
CREATE INDEX custom_foods_gtin ON custom_foods(barcode_gtin14);
CREATE INDEX custom_foods_raw ON custom_foods(barcode_raw);
CREATE INDEX custom_foods_name ON custom_foods(lower(name));
CREATE TABLE recipes (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, recipe_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE recipe_batches (id TEXT PRIMARY KEY, recipe_id TEXT NOT NULL, recipe_version INTEGER NOT NULL, created_at TEXT NOT NULL, batch_json TEXT NOT NULL);
CREATE TABLE saved_meals (id TEXT PRIMARY KEY, name TEXT NOT NULL, meal_json TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, use_count INTEGER NOT NULL DEFAULT 0, last_used_at TEXT);
CREATE TABLE user_food_units (food_key TEXT NOT NULL, label TEXT NOT NULL, grams REAL, ml REAL, PRIMARY KEY(food_key,label), CHECK(grams IS NOT NULL OR ml IS NOT NULL));
CREATE TABLE learned_portions (food_key TEXT NOT NULL, unit TEXT NOT NULL, amount REAL NOT NULL, use_count INTEGER NOT NULL DEFAULT 1, last_used_at TEXT NOT NULL, PRIMARY KEY(food_key,unit,amount));
CREATE TABLE goal_periods (id TEXT PRIMARY KEY, effective_from_date TEXT NOT NULL, goal_json TEXT NOT NULL);
CREATE INDEX goal_periods_date ON goal_periods(effective_from_date);
CREATE TABLE weigh_ins (id TEXT PRIMARY KEY, date TEXT NOT NULL, measured_at TEXT NOT NULL, source TEXT NOT NULL, external_source_id TEXT UNIQUE, weigh_in_json TEXT NOT NULL);
CREATE TABLE installed_packs (pack_id TEXT PRIMARY KEY, file_path TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 100, meta_json TEXT NOT NULL, installed_at TEXT NOT NULL);
CREATE TABLE preferences (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
`, String.raw`
CREATE TABLE water_logs (id TEXT PRIMARY KEY, date TEXT NOT NULL, occurred_at TEXT NOT NULL, amount_ml REAL NOT NULL CHECK(amount_ml > 0));
CREATE INDEX water_logs_date ON water_logs(date);
CREATE TABLE health_sync_records (entry_id TEXT PRIMARY KEY, platform TEXT NOT NULL CHECK(platform IN ('apple_health','health_connect')), external_record_id TEXT NOT NULL, synced_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('synced','deleted')));
CREATE TABLE offline_photo_drafts (id TEXT PRIMARY KEY, date TEXT NOT NULL, meal TEXT NOT NULL, note TEXT NOT NULL, image_data_url TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX offline_photo_drafts_created ON offline_photo_drafts(created_at DESC);
`, String.raw`
DELETE FROM goal_periods WHERE rowid NOT IN (
  SELECT MAX(rowid) FROM goal_periods GROUP BY effective_from_date
);
DROP INDEX IF EXISTS goal_periods_date;
CREATE UNIQUE INDEX goal_periods_date ON goal_periods(effective_from_date);
`];

export async function migrateDatabase(db: SqlDatabase): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON');
  await db.withTransactionAsync(async (tx) => {
    const version = (await tx.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!.user_version;
    if (version > USER_SCHEMA_VERSION) throw new Error(`Unsupported user database version: ${version}`);
    for (let i = version; i < migrations.length; i++) {
      await tx.execAsync(migrations[i]!);
      await tx.execAsync(`PRAGMA user_version = ${i + 1}`);
    }
  });
}
export const runMigrations = migrateDatabase;
