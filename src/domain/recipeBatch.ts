import { calculateNutrition, scaleNutrients, sumNutrients } from './nutrition';
import { recipeBatchSchema, recipeIngredientSchema } from './schemas';
import type { NutrientAggregate, RecipeBatch, RecipeIngredient } from './types';

export function calculateRecipeTotal(ingredients: readonly RecipeIngredient[]): NutrientAggregate {
  return sumNutrients(ingredients.map((input) => {
    const ingredient = recipeIngredientSchema.parse(input);
    return calculateNutrition(ingredient.food, ingredient.quantity);
  }));
}

export const MAX_BATCH_FRACTION = 1;
export type BatchPortion = { grams: number } | { fraction: number };
/** A numeric amount is grams; fractions are explicit to avoid interpreting 0.5 g as half a batch. */
export function calculateBatchServing(batchInput: RecipeBatch, amountGramsOrFraction: number | BatchPortion): NutrientAggregate {
  const batch = recipeBatchSchema.parse(batchInput);
  const portion = typeof amountGramsOrFraction === 'number' ? { grams: amountGramsOrFraction } : amountGramsOrFraction;
  const amount = 'grams' in portion ? portion.grams : portion.fraction;
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError('Batch portion must be finite and nonnegative');
  let fraction: number;
  if ('grams' in portion) {
    if (batch.cooked_weight_g === null) throw new RangeError('Cooked batch weight is required for a gram portion');
    if (amount > batch.cooked_weight_g) throw new RangeError('Batch portion cannot exceed cooked batch weight');
    fraction = amount / batch.cooked_weight_g;
  } else {
    if (amount > MAX_BATCH_FRACTION) throw new RangeError('Batch fraction must be between zero and one');
    fraction = amount;
  }
  const total = calculateRecipeTotal(batch.ingredients);
  return { ...total, nutrients: total.nutrients === null ? null : scaleNutrients(total.nutrients, fraction) };
}
