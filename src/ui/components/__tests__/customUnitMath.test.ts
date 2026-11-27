import { describe, expect, it } from 'vitest';
import { availableUnits } from '../../../app/controller';
import { calculateNutrition, type FoodRecord } from '../../../domain';
import {
  appendFallbackUnits,
  buildCustomFoodUnit,
  buildPortionCandidates,
  defaultBaseUnit,
  formatQuantityLabel,
  mergeSelectedPortion,
  previewCustomUnitKcal,
  pricePortionCandidates,
  supportedBaseUnits,
} from '../customUnitMath';

const baseNutrients = {
  kcal: 200,
  protein_g: 10,
  carbs_g: 25,
  fat_g: 6,
  fiber_g: 3,
  sugar_g: null,
  sat_fat_g: null,
  sodium_mg: null,
  calcium_mg: null,
  iron_mg: null,
  potassium_mg: null,
};

const solidFood: FoodRecord = {
  id: 'food-solid',
  name: 'Cooked Rice',
  brand: null,
  category: null,
  prep_state: 'cooked',
  basis: 'per_100g',
  serving_g: 150,
  serving_ml: null,
  nutrients: baseNutrients,
  units: [],
  provenance_kind: 'user',
  source_pack_id: null,
  source_id: null,
  source_version: null,
};

const liquidFood: FoodRecord = {
  ...solidFood,
  id: 'food-liquid',
  name: 'Whole Milk',
  basis: 'per_100ml',
  serving_g: null,
  serving_ml: 240,
  nutrients: { ...baseNutrients, kcal: 60 },
};

const recipePerServing: FoodRecord = {
  ...solidFood,
  id: 'recipe:dal',
  name: 'Dal chawal',
  basis: 'per_serving',
  serving_g: 300,
  serving_ml: null,
  nutrients: { ...baseNutrients, kcal: 338 },
};

const servingOnlyFood: FoodRecord = {
  ...solidFood,
  id: 'food-serving-only',
  name: 'Restaurant Dish',
  basis: 'per_serving',
  serving_g: null,
  serving_ml: null,
  nutrients: { ...baseNutrients, kcal: 420 },
};

describe('customUnitMath', () => {
  it('lists valid base units in priority order per food basis', () => {
    expect(supportedBaseUnits(solidFood)).toEqual(['g', 'oz', 'serving']);
    expect(defaultBaseUnit(solidFood)).toBe('g');

    expect(supportedBaseUnits(liquidFood)).toEqual(['ml', 'l', 'serving']);
    expect(defaultBaseUnit(liquidFood)).toBe('ml');

    expect(supportedBaseUnits(recipePerServing)).toEqual(['g', 'oz', 'serving']);
    expect(defaultBaseUnit(recipePerServing)).toBe('g');

    expect(supportedBaseUnits(servingOnlyFood)).toEqual([]);
    expect(defaultBaseUnit(servingOnlyFood)).toBeNull();
  });

  it('converts g, oz, ml, l, and serving cleanly into FoodUnit records', () => {
    const bowlGrams = buildCustomFoodUnit(solidFood, 'bowl', 250, 'g');
    expect(bowlGrams.unit).toEqual({ label: 'bowl', grams: 250, ml: null });
    expect(bowlGrams.previewKcal).toBeCloseTo(500, 4);

    const scoopOz = buildCustomFoodUnit(solidFood, 'scoop', 2, 'oz');
    expect(scoopOz.unit.grams).toBeCloseTo(56.699, 3);
    expect(scoopOz.unit.ml).toBeNull();

    const glassMl = buildCustomFoodUnit(liquidFood, 'glass', 250, 'ml');
    expect(glassMl.unit).toEqual({ label: 'glass', grams: null, ml: 250 });
    expect(glassMl.previewKcal).toBeCloseTo(150, 4);

    const pitcherL = buildCustomFoodUnit(liquidFood, 'pitcher', 1.5, 'l');
    expect(pitcherL.unit).toEqual({ label: 'pitcher', grams: null, ml: 1500 });
    expect(pitcherL.previewKcal).toBeCloseTo(900, 4);

    const halfServingBowl = buildCustomFoodUnit(recipePerServing, 'katori', 0.5, 'serving');
    expect(halfServingBowl.unit).toEqual({ label: 'katori', grams: 150, ml: null });
    expect(halfServingBowl.previewKcal).toBeCloseTo(169, 4);
  });

  it('rejects empty names, reserved names, and non-positive amounts', () => {
    expect(() => buildCustomFoodUnit(solidFood, '   ', 100, 'g')).toThrow(/unit name/i);
    expect(() => buildCustomFoodUnit(solidFood, 'g', 100, 'g')).toThrow(/bowl/i);
    expect(() => buildCustomFoodUnit(solidFood, 'Serving', 1, 'serving')).toThrow(/bowl/i);
    expect(() => buildCustomFoodUnit(solidFood, 'bowl', 0, 'g')).toThrow(/positive/i);
    expect(() => buildCustomFoodUnit(solidFood, 'bowl', -10, 'g')).toThrow(/positive/i);
  });

  it('computes live preview kcal even before a custom label is typed', () => {
    expect(previewCustomUnitKcal(recipePerServing, '', '150', 'g')).toBeCloseTo(169, 4);
    expect(previewCustomUnitKcal(recipePerServing, 'bowl', '0.5', 'serving')).toBeCloseTo(169, 4);
    expect(previewCustomUnitKcal(recipePerServing, 'bowl', '', 'g')).toBeNull();
    expect(previewCustomUnitKcal(recipePerServing, 'g', '150', 'g')).toBeNull();
  });

  it('supports the full custom-unit user story across base-unit dropdown changes and subsequent logging', () => {
    // 1. User opens Dal chawal (per_serving, 300g = 338 kcal) and sees g / oz / serving
    expect(availableUnits(recipePerServing)).toEqual(['g', 'oz', 'serving']);
    expect(supportedBaseUnits(recipePerServing)).toEqual(['g', 'oz', 'serving']);
    expect(defaultBaseUnit(recipePerServing)).toBe('g');

    // 2. User taps +, starts typing 1 bowl = 150 g -> live preview shows 169 kcal
    expect(previewCustomUnitKcal(recipePerServing, 'bowl', '150', 'g')).toBeCloseTo(169, 4);

    // 3. User switches the base-unit dropdown from g -> serving and enters 0.5 serving
    expect(previewCustomUnitKcal(recipePerServing, 'bowl', '0.5', 'serving')).toBeCloseTo(169, 4);

    // 4. User saves -> updated food immediately exposes 'bowl' in availableUnits and calculates 1 bowl / 2 bowls
    const saved = buildCustomFoodUnit(recipePerServing, 'bowl', 0.5, 'serving');
    expect(saved.unit).toEqual({ label: 'bowl', grams: 150, ml: null });
    expect(availableUnits(saved.updatedFood)).toContain('bowl');
    expect(calculateNutrition(saved.updatedFood, { amount: 1, unit: 'bowl' }).kcal).toBeCloseTo(169, 4);
    expect(calculateNutrition(saved.updatedFood, { amount: 2, unit: 'bowl' }).kcal).toBeCloseTo(338, 4);

    // 5. Same flow on a liquid food defaults to ml and supports switching to l
    expect(defaultBaseUnit(liquidFood)).toBe('ml');
    const savedJug = buildCustomFoodUnit(liquidFood, 'jug', 0.5, 'l');
    expect(savedJug.unit).toEqual({ label: 'jug', grams: null, ml: 500 });
    expect(availableUnits(savedJug.updatedFood)).toContain('jug');
    expect(calculateNutrition(savedJug.updatedFood, { amount: 1, unit: 'jug' }).kcal).toBeCloseTo(300, 4);
  });

  it('builds deduplicated portion candidates and injects non-listed selections cleanly', () => {
    const withBowl = buildCustomFoodUnit(solidFood, 'bowl', 250, 'g').updatedFood;
    const candidates = buildPortionCandidates(
      withBowl,
      { amount: 150, unit: 'g' },
      availableUnits(withBowl),
      [{ amount: 150, unit: 'g' }, { amount: 1, unit: 'invalid' }],
    );
    expect(candidates).toEqual([
      { amount: 150, unit: 'g' },
      { amount: 1, unit: 'bowl' },
      { amount: 75, unit: 'g' },
    ]);

    const priced = pricePortionCandidates(withBowl, candidates);
    expect(priced[0]?.kcal).toBeCloseTo(300, 4);
    expect(priced[1]?.kcal).toBeCloseTo(500, 4);

    // Selecting an already-listed portion preserves the list
    expect(mergeSelectedPortion(priced, withBowl, { amount: 1, unit: 'bowl' })).toEqual(priced);

    // Selecting a new custom quantity puts it at the front of the 3 chips
    const merged = mergeSelectedPortion(priced, withBowl, { amount: 2, unit: 'bowl' });
    expect(merged).toHaveLength(3);
    expect(merged[0]).toEqual({ amount: 2, unit: 'bowl', kcal: 1000 });
  });

  it('formats recipe serving labels as whole recipe and appends fallback units after food-specific units', () => {
    expect(formatQuantityLabel({ amount: 1, unit: 'serving' }, recipePerServing)).toBe('1 whole recipe');
    expect(formatQuantityLabel({ amount: 2, unit: 'serving' }, recipePerServing)).toBe('2 whole recipes');
    expect(formatQuantityLabel({ amount: 1, unit: 'portion' }, recipePerServing)).toBe('1 portion');
    expect(formatQuantityLabel({ amount: 1, unit: 'serving' }, servingOnlyFood)).toBe('1 serving');

    const withDensity: FoodRecord = {
      ...solidFood,
      units: [{ label: 'cup', grams: 100, ml: 100 }],
    };
    const merged = appendFallbackUnits(withDensity, [
      { label: 'cup', grams: 250, ml: 250 },
      { label: 'global-cup', grams: 200, ml: 100 },
    ]);
    expect(merged.units).toEqual([
      { label: 'cup', grams: 100, ml: 100 },
      { label: 'global-cup', grams: 200, ml: 100 },
    ]);
    // Food-specific density (1 g/ml) wins over fallback global density (2 g/ml)
    expect(calculateNutrition(merged, { amount: 100, unit: 'ml' }).kcal).toBe(200);
  });
});
