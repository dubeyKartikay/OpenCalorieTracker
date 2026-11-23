import { describe, expect, it } from 'vitest';
import {
  diaryDaySchema, diaryEntrySnapshotSchema, exportBundleV1Schema, foodRecordSchema,
  foodUnitSchema, goalPeriodSchema, nutrientProfileSchema, packMetaSchema, recipeSchema,
} from '../schemas';
import { batch, entry, food, goal, nextId, nutrients, weighIn } from './fixtures';

describe('canonical schemas', () => {
  it('normalizes missing optional source nutrients to null, preserving explicit zero', () => {
    const profile = nutrientProfileSchema.parse({ kcal: 100, protein_g: 1, carbs_g: 20, fat_g: 2, fiber_g: 0 });
    expect(profile.fiber_g).toBe(0);
    expect(profile.iron_mg).toBeNull();
    expect(profile.sodium_mg).toBeNull();
  });
  it.each(['fiber_g', 'sugar_g', 'sat_fat_g', 'sodium_mg', 'calcium_mg', 'iron_mg', 'potassium_mg'] as const)('preserves null and zero for %s', (key) => {
    expect(nutrientProfileSchema.parse(nutrients({ [key]: null }))[key]).toBeNull();
    expect(nutrientProfileSchema.parse(nutrients({ [key]: 0 }))[key]).toBe(0);
  });
  it('rejects nonfinite, negative, or silently misspelled nutrients', () => {
    expect(() => nutrientProfileSchema.parse(nutrients({ kcal: NaN }))).toThrow();
    expect(() => nutrientProfileSchema.parse({ ...nutrients(), protein_g: -1 })).toThrow();
    expect(() => nutrientProfileSchema.parse({ ...nutrients(), fibre_g: 1 })).toThrow();
  });
  it('validates provenance and preparation independently of portion certainty', () => {
    const snapshot = entry({ food: food({ prep_state: 'cooked', provenance_kind: 'database' }), portion_certainty: 'estimated', estimate_range: { min_g: 150, max_g: 250 } });
    expect(diaryEntrySnapshotSchema.parse(snapshot)).toMatchObject({ food: { prep_state: 'cooked', provenance_kind: 'database' }, portion_certainty: 'estimated' });
    expect(() => diaryEntrySnapshotSchema.parse({ ...snapshot, estimate_range: { min_g: 250, max_g: 150 } })).toThrow();
  });
  it('keeps none, partial and complete as distinct day states', () => {
    for (const completeness of ['none', 'partial', 'complete'] as const) {
      expect(diaryDaySchema.parse({ date: '2026-11-23', completeness, entries: [] }).completeness).toBe(completeness);
    }
  });
  it('rejects mismatched diary dates without interpreting them as UTC dates', () => {
    expect(() => diaryDaySchema.parse({ date: '2026-11-22', completeness: 'partial', entries: [entry()] })).toThrow('diary date');
    expect(diaryEntrySnapshotSchema.parse(entry()).occurred_at).toBe('2026-11-23T12:30:00+05:30');
  });
  it('requires positive, food-specific unit measurements', () => {
    expect(() => foodUnitSchema.parse({ label: 'bowl' })).toThrow();
    expect(() => foodUnitSchema.parse({ label: 'bowl', grams: 0 })).toThrow();
    expect(foodUnitSchema.parse({ label: 'bowl', grams: 150 })).toEqual({ label: 'bowl', grams: 150, ml: null });
  });
  it('rejects unsupported bases, preparation states and undocumented zero servings', () => {
    expect(() => foodRecordSchema.parse({ ...food(), basis: 'per_cup' })).toThrow();
    expect(() => foodRecordSchema.parse({ ...food(), prep_state: 'fried' })).toThrow();
    expect(() => foodRecordSchema.parse({ ...food(), serving_g: 0 })).toThrow();
  });
  it('does not assign a calorie target in observe mode', () => {
    expect(() => goalPeriodSchema.parse({ ...goal('2026-11-23'), mode: 'observe' })).toThrow();
  });
  it('round-trips all documented bundle fields, frozen history, nulls and attribution', () => {
    const cookedBatch = batch();
    const recipe = recipeSchema.parse({ id: cookedBatch.recipe_id, name: 'My recipe', version: 1, ingredients: cookedBatch.ingredients, cooked_weight_g: 1600, servings_count: 4, notes: 'Private note' });
    const pack = packMetaSchema.parse({ pack_id: 'usda', name: 'USDA', version: '2026.1', kind: 'reference', region: 'US', license: 'CC0', attribution_text: 'USDA FoodData Central', attribution_url: 'https://fdc.nal.usda.gov/', schema_version: 1 });
    const bundle = exportBundleV1Schema.parse({
      schema_version: 1, exported_at: '2026-11-23T12:00:00Z',
      diary_days: [{ date: '2026-11-23', completeness: 'partial', entries: [entry()] }],
      custom_foods: [food({ id: nextId(), provenance_kind: 'user' })], recipes: [recipe], recipe_batches: [cookedBatch],
      goal_periods: [goal('2026-11-23')], weigh_ins: [weighIn('2026-11-23', 80)], packs: [pack],
    });
    expect(exportBundleV1Schema.parse(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle);
    expect(() => exportBundleV1Schema.parse({ ...bundle, schema_version: 2 })).toThrow();
    expect(() => exportBundleV1Schema.parse({ ...bundle, token: 'credentials must not be exported' })).toThrow();
  });
});
