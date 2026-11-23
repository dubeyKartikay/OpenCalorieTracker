import { foodRecordSchema, quantitySchema } from './schemas';
import type { FoodRecord, Quantity } from './types';

export class UnitConversionError extends Error {
  constructor(message: string) { super(message); this.name = 'UnitConversionError'; }
}
export interface ResolvedQuantity {
  /** Grams, ml, or servings, according to the food's canonical basis. */
  amount: number;
  unit: 'g' | 'ml' | 'serving';
  factor: number;
}
export const GRAMS_PER_OUNCE = 28.349523125;

/** Cross-dimension mappings must come from this food, never a global density. */
export function resolveQuantityToBasis(foodInput: FoodRecord, quantityInput: Quantity): ResolvedQuantity {
  const food = foodRecordSchema.parse(foodInput);
  const { amount, unit } = quantitySchema.parse(quantityInput);
  let grams: number | null = null;
  let ml: number | null = null;
  let servings: number | null = null;
  switch (unit) {
    case 'g': grams = amount; break;
    case 'oz': grams = amount * GRAMS_PER_OUNCE; break;
    case 'ml': ml = amount; break;
    case 'l': ml = amount * 1000; break;
    case 'serving':
      servings = amount;
      grams = food.serving_g === null ? null : amount * food.serving_g;
      ml = food.serving_ml === null ? null : amount * food.serving_ml;
      break;
    default: {
      const custom = food.units.find((candidate) => candidate.label === unit);
      if (!custom) throw new UnitConversionError(`Unknown unit: ${unit}`);
      grams = custom.grams === null ? null : amount * custom.grams;
      ml = custom.ml === null ? null : amount * custom.ml;
    }
  }
  const mapping = food.units.find((candidate) => candidate.grams !== null && candidate.ml !== null);
  const density = mapping ? mapping.grams! / mapping.ml!
    : food.serving_g !== null && food.serving_ml !== null ? food.serving_g / food.serving_ml : null;
  if (density !== null) {
    if (grams === null && ml !== null) grams = ml * density;
    if (ml === null && grams !== null) ml = grams / density;
  }
  if (food.basis === 'per_100g' && grams !== null) return checked(grams, 'g', grams / 100);
  if (food.basis === 'per_100ml' && ml !== null) return checked(ml, 'ml', ml / 100);
  if (food.basis === 'per_serving') {
    if (servings === null && grams !== null && food.serving_g !== null) servings = grams / food.serving_g;
    if (servings === null && ml !== null && food.serving_ml !== null) servings = ml / food.serving_ml;
    if (servings !== null) return checked(servings, 'serving', servings);
  }
  throw new UnitConversionError(`Cannot convert ${unit} to ${food.basis} without a food-specific mapping`);
}

function checked(amount: number, unit: ResolvedQuantity['unit'], factor: number): ResolvedQuantity {
  if (!Number.isFinite(amount) || !Number.isFinite(factor)) throw new UnitConversionError('Quantity conversion overflow');
  return { amount, unit, factor };
}
