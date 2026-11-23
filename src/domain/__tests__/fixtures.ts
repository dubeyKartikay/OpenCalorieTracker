import { createIdGenerator } from '../ids';
import { foodRecordSchema, nutrientProfileSchema } from '../schemas';
import type { DiaryEntrySnapshot, FoodRecord, GoalPeriod, NutrientProfile, RecipeBatch, WeighIn } from '../types';

export const nextId = createIdGenerator({ now: () => 1_700_000_000_000, randomBytes: () => new Uint8Array(10) });
export function nutrients(overrides: Partial<NutrientProfile> = {}): NutrientProfile {
  return nutrientProfileSchema.parse({ kcal: 200, protein_g: 10, carbs_g: 20, fat_g: 8, ...overrides });
}
export function food(overrides: Partial<FoodRecord> = {}): FoodRecord {
  return foodRecordSchema.parse({
    id: 'rice-raw', name: 'Rice', prep_state: 'raw', basis: 'per_100g',
    nutrients: nutrients(), provenance_kind: 'database',
    source_pack_id: 'usda', source_id: '123', source_version: '2026.1', ...overrides,
  });
}
export function entry(overrides: Partial<DiaryEntrySnapshot> = {}): DiaryEntrySnapshot {
  return {
    id: nextId(), idempotency_key: nextId(), date: '2026-11-23',
    occurred_at: '2026-11-23T12:30:00+05:30', time_zone: 'Asia/Kolkata', meal: 'Lunch',
    food: food(), quantity: { amount: 100, unit: 'g' }, nutrients: nutrients(),
    provenance_kind: 'database', portion_certainty: 'stated', estimate_range: null,
    draft_state: 'confirmed', ...overrides,
  };
}
export function batch(kcal = 2400, cookedWeight: number | null = 1600): RecipeBatch {
  return {
    id: nextId(), recipe_id: nextId(), recipe_version: 1, created_at: '2026-11-23T00:00:00Z',
    ingredients: [{ food: food({ nutrients: nutrients({ kcal }) }), quantity: { amount: 100, unit: 'g' } }],
    cooked_weight_g: cookedWeight, servings_count: 4, notes: null,
  };
}
export function goal(date: string, kcal: number | null = 2000): GoalPeriod {
  return {
    id: nextId(), effective_from_date: date, mode: kcal === null ? 'observe' : 'maintain',
    target_kcal: kcal, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null,
  };
}
export function weighIn(date: string, weight: number, overrides: Partial<WeighIn> = {}): WeighIn {
  return { id: nextId(), measured_at: `${date}T00:00:00Z`, date, weight_kg: weight, source: 'manual', external_source_id: null, ...overrides };
}
