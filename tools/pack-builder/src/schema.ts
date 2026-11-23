export const SCHEMA_VERSION = 1;
export const SCHEMA_SQL = `
CREATE TABLE pack_meta (
  pack_id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('reference','branded','regional','custom')),
  region TEXT, license TEXT NOT NULL, attribution_text TEXT NOT NULL, attribution_url TEXT,
  schema_version INTEGER NOT NULL, built_at TEXT NOT NULL, food_count INTEGER NOT NULL
);
CREATE TABLE foods (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT, category TEXT,
  prep_state TEXT NOT NULL CHECK(prep_state IN ('raw','cooked','prepared','unknown')),
  basis TEXT NOT NULL CHECK(basis IN ('per_100g','per_100ml','per_serving')),
  serving_g REAL, serving_ml REAL, kcal REAL NOT NULL, protein_g REAL NOT NULL,
  carbs_g REAL NOT NULL, fat_g REAL NOT NULL, fiber_g REAL, sugar_g REAL, sat_fat_g REAL,
  sodium_mg REAL, calcium_mg REAL, iron_mg REAL, potassium_mg REAL, quality_score REAL
);
CREATE TABLE food_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT, food_id TEXT NOT NULL REFERENCES foods(id),
  alias TEXT NOT NULL, lang TEXT
);
CREATE INDEX food_aliases_food_id ON food_aliases(food_id);
CREATE INDEX food_aliases_lower_alias ON food_aliases(lower(alias));
CREATE TABLE food_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT, food_id TEXT NOT NULL REFERENCES foods(id),
  label TEXT NOT NULL, grams REAL, ml REAL, CHECK(grams IS NOT NULL OR ml IS NOT NULL)
);
CREATE INDEX food_units_food_id ON food_units(food_id);
CREATE TABLE food_barcodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, raw_code TEXT NOT NULL, symbology TEXT NOT NULL,
  gtin14 TEXT, food_id TEXT NOT NULL REFERENCES foods(id)
);
CREATE INDEX food_barcodes_gtin14 ON food_barcodes(gtin14);
CREATE INDEX food_barcodes_raw_code ON food_barcodes(raw_code);
CREATE INDEX food_barcodes_food_id ON food_barcodes(food_id);
CREATE VIRTUAL TABLE foods_fts USING fts5(
  food_id UNINDEXED, name, brand, aliases, tokenize='unicode61 remove_diacritics 2'
);
`;
