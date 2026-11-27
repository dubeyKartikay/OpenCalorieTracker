import type { Recipe, RecipeIngredient } from '../../../domain';
import { energyValue, number } from '../../format';

export interface RecipeDraftShape {
  name: string;
  ingredients: RecipeIngredient[];
  cooked_weight_g: number | null;
  servings_count: number | null;
}

/** True when a draft has a non-empty name and at least one ingredient. */
export function isValidRecipeDraft(draft: RecipeDraftShape): boolean {
  return draft.name.trim().length > 0 && draft.ingredients.length > 0;
}

/** True when the recipe draft diverges from the saved recipe snapshot. */
export function isRecipeDraftDirty(draft: RecipeDraftShape, saved: Pick<Recipe, 'name' | 'ingredients' | 'cooked_weight_g' | 'servings_count'>): boolean {
  if (draft.name.trim() !== saved.name) return true;
  if (draft.cooked_weight_g !== saved.cooked_weight_g) return true;
  if (draft.servings_count !== saved.servings_count) return true;
  if (draft.ingredients.length !== saved.ingredients.length) return true;
  for (let i = 0; i < draft.ingredients.length; i++) {
    const a = draft.ingredients[i]!;
    const b = saved.ingredients[i]!;
    if (
      a.food.id !== b.food.id
      || (a.food.source_pack_id ?? null) !== (b.food.source_pack_id ?? null)
      || a.quantity.amount !== b.quantity.amount
      || a.quantity.unit !== b.quantity.unit
    ) {
      return true;
    }
  }
  return false;
}

/** Concise one-line metadata summary for recipe cards — never shows "not set" boilerplate. */
export function formatRecipeCardMeta(recipe: Pick<Recipe, 'ingredients' | 'cooked_weight_g' | 'servings_count'>): string {
  const parts: string[] = [];
  if (recipe.servings_count != null && recipe.servings_count > 0) {
    parts.push(`${number(recipe.servings_count, 1)} ${recipe.servings_count === 1 ? 'serving' : 'servings'}`);
  }
  if (recipe.cooked_weight_g != null && recipe.cooked_weight_g > 0) {
    parts.push(`${number(recipe.cooked_weight_g, 0)} g`);
  }
  if (parts.length === 0) {
    const count = recipe.ingredients.length;
    parts.push(`${count} ${count === 1 ? 'ingredient' : 'ingredients'}`);
  }
  return parts.join(' · ');
}

/** Format energy density per 100 g when cooked weight is known, else null. */
export function formatEnergyDensity(
  totalKcal: number | null | undefined,
  cookedWeightG: number | null | undefined,
  energyUnit: 'kcal' | 'kJ',
): string | null {
  if (totalKcal == null || !Number.isFinite(totalKcal) || cookedWeightG == null || cookedWeightG <= 0) return null;
  const per100 = energyValue((totalKcal / cookedWeightG) * 100, energyUnit);
  if (per100 == null) return null;
  return `${number(per100)} ${energyUnit}/100g`;
}

/** Compact delta indicator when a batch ingredient differs from the base recipe ingredient. */
export function formatIngredientDelta(
  current: RecipeIngredient,
  original: RecipeIngredient | undefined,
): string | null {
  if (!original) return null;
  if (original.quantity.unit !== current.quantity.unit) {
    return `was ${number(original.quantity.amount, 2)} ${original.quantity.unit}`;
  }
  const diff = current.quantity.amount - original.quantity.amount;
  if (Math.abs(diff) < 0.005) return null;
  const sign = diff > 0 ? '+' : '−';
  return `${sign}${number(Math.abs(diff), 2)} ${current.quantity.unit}`;
}
