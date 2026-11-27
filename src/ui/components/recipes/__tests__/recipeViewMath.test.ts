import { describe, expect, it } from 'vitest';
import { foodRecordSchema } from '../../../../domain';
import { macroShare } from '../../../format';
import {
  formatEnergyDensity,
  formatIngredientDelta,
  formatRecipeCardMeta,
  isRecipeDraftDirty,
  isValidRecipeDraft,
} from '../recipeViewMath';

const flour = foodRecordSchema.parse({
  id: 'flour',
  name: 'Whole wheat flour',
  prep_state: 'raw',
  basis: 'per_100g',
  nutrients: { kcal: 340, protein_g: 13, carbs_g: 72, fat_g: 2.5 },
  provenance_kind: 'database',
});

describe('recipeViewMath', () => {
  it('validates recipe drafts cleanly', () => {
    expect(isValidRecipeDraft({ name: '', ingredients: [{ food: flour, quantity: { amount: 100, unit: 'g' } }], cooked_weight_g: null, servings_count: null })).toBe(false);
    expect(isValidRecipeDraft({ name: 'Roti', ingredients: [], cooked_weight_g: null, servings_count: null })).toBe(false);
    expect(isValidRecipeDraft({ name: 'Roti', ingredients: [{ food: flour, quantity: { amount: 100, unit: 'g' } }], cooked_weight_g: null, servings_count: null })).toBe(true);
  });

  it('detects dirty changes across name, yield, and ingredients', () => {
    const base = {
      name: 'Pasta',
      ingredients: [{ food: flour, quantity: { amount: 120, unit: 'g' } }],
      cooked_weight_g: 500,
      servings_count: 2,
    };
    expect(isRecipeDraftDirty({ ...base, name: ' Pasta ' }, base)).toBe(false);
    expect(isRecipeDraftDirty({ ...base, servings_count: 3 }, base)).toBe(true);
    expect(isRecipeDraftDirty({ ...base, ingredients: [{ food: flour, quantity: { amount: 150, unit: 'g' } }] }, base)).toBe(true);
  });

  it('formats concise recipe card metadata without "not set" clutter', () => {
    expect(formatRecipeCardMeta({ ingredients: [{ food: flour, quantity: { amount: 100, unit: 'g' } }], cooked_weight_g: null, servings_count: null })).toBe('1 ingredient');
    expect(formatRecipeCardMeta({ ingredients: [{ food: flour, quantity: { amount: 100, unit: 'g' } }], cooked_weight_g: 1000, servings_count: 2 })).toBe('2 servings · 1,000 g');
    expect(formatRecipeCardMeta({ ingredients: [{ food: flour, quantity: { amount: 100, unit: 'g' } }], cooked_weight_g: null, servings_count: 1 })).toBe('1 serving');
  });

  it('formats energy density and batch ingredient deltas cleanly', () => {
    expect(formatEnergyDensity(696, 1000, 'kcal')).toBe('70 kcal/100g');
    expect(formatEnergyDensity(696, null, 'kcal')).toBeNull();
    const orig = { food: flour, quantity: { amount: 120, unit: 'g' } };
    expect(formatIngredientDelta(orig, orig)).toBeNull();
    expect(formatIngredientDelta({ food: flour, quantity: { amount: 140, unit: 'g' } }, orig)).toBe('+20 g');
    expect(formatIngredientDelta({ food: flour, quantity: { amount: 100, unit: 'g' } }, orig)).toBe('−20 g');
    expect(formatIngredientDelta({ food: flour, quantity: { amount: 1, unit: 'serving' } }, orig)).toBe('was 120 g');
  });

  it('computes shared macro shares accurately', () => {
    expect(macroShare(0, 0, 0)).toEqual({ protein: 0, carbs: 0, fat: 0 });
    expect(macroShare(25, 25, 0)).toEqual({ protein: 50, carbs: 50, fat: 0 });
  });
});
