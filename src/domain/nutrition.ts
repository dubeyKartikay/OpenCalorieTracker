import { nutrientKeys, nutrientProfileSchema, nutrientUnknownCountsSchema } from './schemas';
import type { DiaryEntrySnapshot, FoodRecord, NutrientAggregate, NutrientKey, NutrientProfile, Quantity } from './types';
import { resolveQuantityToBasis } from './units';

/** Do not round intermediate values or replace published energy with macro arithmetic. */
export function scaleNutrients(profile: NutrientProfile, factor: number): NutrientProfile {
  if (!Number.isFinite(factor) || factor < 0) throw new RangeError('Nutrition factor must be finite and nonnegative');
  const source = nutrientProfileSchema.parse(profile);
  return nutrientProfileSchema.parse(Object.fromEntries(nutrientKeys.map((key) => [key, source[key] === null ? null : source[key] * factor])));
}

export function calculateNutrition(food: FoodRecord, quantity: Quantity): NutrientProfile {
  return scaleNutrients(food.nutrients, resolveQuantityToBasis(food, quantity).factor);
}

/** Empty input has no totals. Draft entries do not count. Known subtotal + unknownCount is partial coverage. */
export function sumNutrients(entries: readonly (NutrientProfile | DiaryEntrySnapshot)[]): NutrientAggregate {
  const contributions = entries.flatMap((entry) => 'draft_state' in entry
    ? entry.draft_state === 'confirmed' ? [{ nutrients: entry.nutrients, unknownCount: entry.unknown_nutrient_counts }] : []
    : [{ nutrients: entry, unknownCount: undefined }]);
  const profiles = contributions.map((entry) => ({
    nutrients: nutrientProfileSchema.parse(entry.nutrients),
    unknownCount: entry.unknownCount === undefined ? undefined : nutrientUnknownCountsSchema.parse(entry.unknownCount),
  }));
  const unknownCount = Object.fromEntries(nutrientKeys.map((key) => [key, 0])) as Record<NutrientKey, number>;
  if (profiles.length === 0) return { nutrients: null, unknownCount, entryCount: 0 };
  const values: Record<string, number | null> = {};
  for (const key of nutrientKeys) {
    let total = 0;
    for (const profile of profiles) {
      const value = profile.nutrients[key];
      unknownCount[key] += Math.max(value === null ? 1 : 0, profile.unknownCount?.[key] ?? 0);
      if (value !== null) total += value;
    }
    values[key] = profiles.every((profile) => profile.nutrients[key] === null) ? null : total;
  }
  return { nutrients: nutrientProfileSchema.parse(values), unknownCount, entryCount: profiles.length };
}
