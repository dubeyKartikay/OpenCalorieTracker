import { z } from 'zod';

const nonNegative = z.number().finite().nonnegative();
const positive = z.number().finite().positive();
const id = z.uuid();
export const idSchema = id;
const text = z.string().trim().min(1);
export const isoDateSchema = z.iso.date();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
export const foodBasisSchema = z.enum(['per_100g', 'per_100ml', 'per_serving']);
export const prepStateSchema = z.enum(['raw', 'cooked', 'prepared', 'unknown']);
export const provenanceKindSchema = z.enum(['database', 'label', 'user', 'ai_estimate', 'recipe_batch']);
export const portionCertaintySchema = z.enum(['stated', 'estimated']);

/** Optional source fields are normalized to null; an explicit zero stays zero. */
export const nutrientProfileSchema = z.strictObject({
  kcal: nonNegative,
  protein_g: nonNegative,
  carbs_g: nonNegative,
  fat_g: nonNegative,
  fiber_g: nonNegative.nullable().default(null),
  sugar_g: nonNegative.nullable().default(null),
  sat_fat_g: nonNegative.nullable().default(null),
  sodium_mg: nonNegative.nullable().default(null),
  calcium_mg: nonNegative.nullable().default(null),
  iron_mg: nonNegative.nullable().default(null),
  potassium_mg: nonNegative.nullable().default(null),
});
export const nutrientKeys = Object.keys(nutrientProfileSchema.shape) as (keyof z.infer<typeof nutrientProfileSchema>)[];
export const nutrientUnknownCountsSchema = z.strictObject({
  kcal: z.int().nonnegative(), protein_g: z.int().nonnegative(), carbs_g: z.int().nonnegative(),
  fat_g: z.int().nonnegative(), fiber_g: z.int().nonnegative(), sugar_g: z.int().nonnegative(),
  sat_fat_g: z.int().nonnegative(), sodium_mg: z.int().nonnegative(), calcium_mg: z.int().nonnegative(),
  iron_mg: z.int().nonnegative(), potassium_mg: z.int().nonnegative(),
});
export const nutrientAggregateSchema = z.strictObject({
  nutrients: nutrientProfileSchema.nullable(),
  unknownCount: nutrientUnknownCountsSchema,
  entryCount: z.int().nonnegative(),
});
export const foodUnitSchema = z.strictObject({
  label: text,
  grams: positive.nullable().default(null),
  ml: positive.nullable().default(null),
}).refine((unit) => unit.grams !== null || unit.ml !== null, 'A food unit needs grams or ml');

export const packMetaSchema = z.strictObject({
  pack_id: text, name: text, version: text, kind: text, region: text.nullable(),
  license: text, attribution_text: text, attribution_url: z.url().nullable(),
  schema_version: z.int().positive(),
});
export const foodRecordSchema = z.strictObject({
  id: text,
  name: text,
  brand: text.nullable().default(null),
  category: text.nullable().default(null),
  prep_state: prepStateSchema,
  basis: foodBasisSchema,
  serving_g: positive.nullable().default(null),
  serving_ml: positive.nullable().default(null),
  nutrients: nutrientProfileSchema,
  units: z.array(foodUnitSchema).default([]),
  provenance_kind: provenanceKindSchema,
  source_pack_id: text.nullable().default(null),
  source_id: text.nullable().default(null),
  source_version: text.nullable().default(null),
});
export const quantitySchema = z.strictObject({ amount: nonNegative, unit: text });
export const diaryEntrySnapshotSchema = z.strictObject({
  id, idempotency_key: text,
  date: isoDateSchema, occurred_at: z.iso.datetime({ offset: true }),
  time_zone: text, meal: text,
  food: foodRecordSchema,
  quantity: quantitySchema,
  nutrients: nutrientProfileSchema,
  provenance_kind: provenanceKindSchema,
  portion_certainty: portionCertaintySchema,
  /** Carries missing ingredient counts through a partially known recipe snapshot. */
  unknown_nutrient_counts: nutrientUnknownCountsSchema.optional(),
  estimate_range: z.strictObject({ min_g: nonNegative, max_g: nonNegative })
    .refine((range) => range.min_g <= range.max_g, 'Invalid estimate range').nullable(),
  draft_state: z.enum(['draft', 'confirmed']),
});
export const diaryDaySchema = z.strictObject({
  date: isoDateSchema,
  completeness: z.enum(['complete', 'partial', 'none']),
  entries: z.array(diaryEntrySnapshotSchema),
}).refine((day) => day.entries.every((entry) => entry.date === day.date), 'Entries must belong to the diary date');
export const recipeIngredientSchema = z.strictObject({ food: foodRecordSchema, quantity: quantitySchema });
export const recipeSchema = z.strictObject({
  id, name: text, version: z.int().positive(),
  ingredients: z.array(recipeIngredientSchema).min(1),
  cooked_weight_g: positive.nullable(), servings_count: positive.nullable(),
  notes: z.string().nullable(),
});
/** Ingredients are frozen food records, independent of subsequent recipe/catalog edits. */
export const recipeBatchSchema = z.strictObject({
  id, recipe_id: id, recipe_version: z.int().positive(),
  created_at: z.iso.datetime({ offset: true }),
  ingredients: z.array(recipeIngredientSchema).min(1),
  cooked_weight_g: positive.nullable(), servings_count: positive.nullable(),
  notes: z.string().nullable(),
});
export const goalPeriodSchema = z.strictObject({
  id, effective_from_date: isoDateSchema,
  mode: z.enum(['lose', 'maintain', 'gain', 'observe']),
  target_kcal: positive.nullable(),
  protein_g: nonNegative.nullable(), carbs_g: nonNegative.nullable(), fat_g: nonNegative.nullable(),
  fiber_g: nonNegative.nullable(),
}).refine((goal) => goal.mode !== 'observe' || goal.target_kcal === null, 'Observe mode has no calorie target');
export const weighInSchema = z.strictObject({
  id, measured_at: z.iso.datetime({ offset: true }), date: isoDateSchema,
  weight_kg: positive, source: z.enum(['manual', 'health', 'apple_health', 'health_connect']),
  external_source_id: text.nullable(),
}).refine((entry) => entry.source !== 'health' || entry.external_source_id !== null, 'Health imports need a deduplication id');
export const waterLogSchema = z.strictObject({
  id: idSchema, date: isoDateSchema, occurred_at: isoDateTimeSchema, amount_ml: positive,
});
export const offlinePhotoDraftSchema = z.strictObject({
  id: idSchema, date: isoDateSchema, meal: z.string().trim().min(1),
  note: z.string().default(''), image_data_url: z.string().min(1), created_at: isoDateTimeSchema,
});
export const healthSyncRecordSchema = z.strictObject({
  entry_id: idSchema, platform: z.enum(['apple_health', 'health_connect']),
  external_record_id: z.string().min(1), synced_at: isoDateTimeSchema,
  status: z.enum(['synced', 'deleted']),
});
export const savedMealExportSchema = z.strictObject({
  id, name: text, items: z.array(recipeIngredientSchema).min(1),
  pinned: z.boolean().default(false), use_count: z.int().nonnegative().default(0),
  last_used_at: isoDateTimeSchema.nullable().default(null),
});
export const userFoodUnitExportSchema = z.strictObject({
  food_key: text, label: text, grams: positive.nullable(), ml: positive.nullable(),
}).refine((unit) => unit.grams !== null || unit.ml !== null, 'Food unit needs grams or ml');
export const customFoodBarcodeExportSchema = z.strictObject({
  food_id: text, raw_code: text, symbology: text, gtin14: text.nullable(),
});
export const learnedPortionExportSchema = z.strictObject({
  food_key: text, unit: text, amount: positive, use_count: z.int().positive(), last_used_at: isoDateTimeSchema,
});
export const exportBundleV1Schema = z.strictObject({
  schema_version: z.literal(1), exported_at: z.iso.datetime({ offset: true }),
  diary_days: z.array(diaryDaySchema), custom_foods: z.array(foodRecordSchema),
  recipes: z.array(recipeSchema), recipe_batches: z.array(recipeBatchSchema),
  goal_periods: z.array(goalPeriodSchema), weigh_ins: z.array(weighInSchema),
  packs: z.array(packMetaSchema),
  water_logs: z.array(waterLogSchema).default([]),
  saved_meals: z.array(savedMealExportSchema).optional(),
  user_food_units: z.array(userFoodUnitExportSchema).optional(),
  custom_food_barcodes: z.array(customFoodBarcodeExportSchema).optional(),
  learned_portions: z.array(learnedPortionExportSchema).optional(),
});
