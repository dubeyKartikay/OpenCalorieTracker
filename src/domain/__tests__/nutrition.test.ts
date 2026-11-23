import { describe, expect, it } from 'vitest';
import { calculateNutrition, scaleNutrients, sumNutrients } from '../nutrition';
import { diaryEntrySnapshotSchema } from '../schemas';
import { entry, food, nutrients } from './fixtures';

describe('nutrition', () => {
  it('preserves label energy instead of recomputing 4P + 4C + 9F', () => {
    const label = food({ provenance_kind: 'label', nutrients: nutrients({ kcal: 137, protein_g: 10, carbs_g: 30, fat_g: 5, fiber_g: 15 }) });
    const result = calculateNutrition(label, { amount: 100, unit: 'g' });
    expect(result.kcal).toBe(137);
    expect(result.kcal).not.toBe(4 * result.protein_g + 4 * result.carbs_g + 9 * result.fat_g);
    expect(calculateNutrition(label, { amount: 50, unit: 'g' }).kcal).toBe(68.5);
  });
  it('keeps unknown nutrients null even for a zero quantity', () => {
    expect(calculateNutrition(food(), { amount: 0, unit: 'g' })).toMatchObject({ kcal: 0, fiber_g: null, iron_mg: null });
  });
  it('does not round intermediate label values', () => {
    const result = calculateNutrition(food({ nutrients: nutrients({ kcal: 1033 }) }), { amount: 150 / 11.8, unit: 'g' });
    expect(result.kcal).toBeCloseTo(131.3135593220339, 10);
  });
  it('keeps raw and cooked sources separate, without changing their provenance', () => {
    const raw = food({ nutrients: nutrients({ kcal: 360 }) });
    const cooked = food({ id: 'rice-cooked', prep_state: 'cooked', nutrients: nutrients({ kcal: 130 }) });
    const before = structuredClone([raw, cooked]);
    expect(calculateNutrition(raw, { amount: 100, unit: 'g' }).kcal).toBe(360);
    expect(calculateNutrition(cooked, { amount: 100, unit: 'g' }).kcal).toBe(130);
    expect([raw, cooked]).toEqual(before);
    const snapshot = diaryEntrySnapshotSchema.parse(entry({ food: cooked, nutrients: calculateNutrition(cooked, { amount: 100, unit: 'g' }) }));
    cooked.nutrients.kcal = 999;
    cooked.source_version = 'later';
    expect(snapshot.food).toMatchObject({ prep_state: 'cooked', source_version: '2026.1', source_pack_id: 'usda', source_id: '123' });
    expect(snapshot.nutrients.kcal).toBe(130);
  });
  it('reports known subtotals and per-nutrient missing coverage', () => {
    const result = sumNutrients([nutrients({ fiber_g: null, sodium_mg: 0 }), nutrients({ fiber_g: 0, sodium_mg: null }), nutrients({ fiber_g: 3, sodium_mg: 10 })]);
    expect(result.nutrients).toMatchObject({ kcal: 600, fiber_g: 3, sodium_mg: 10, iron_mg: null });
    expect(result.unknownCount).toMatchObject({ kcal: 0, fiber_g: 1, sodium_mg: 1, iron_mg: 3 });
    expect(result.entryCount).toBe(3);
  });
  it('distinguishes entirely missing, entirely zero and mixed fiber', () => {
    expect(sumNutrients([nutrients(), nutrients()]).nutrients?.fiber_g).toBeNull();
    const zero = sumNutrients([nutrients({ fiber_g: 0 }), nutrients({ fiber_g: 0 })]);
    expect(zero.nutrients?.fiber_g).toBe(0);
    expect(zero.unknownCount.fiber_g).toBe(0);
    const partial = sumNutrients([nutrients(), nutrients({ fiber_g: 0 })]);
    expect(partial.nutrients?.fiber_g).toBe(0);
    expect(partial.unknownCount.fiber_g).toBe(1);
  });
  it('keeps an unlogged day empty rather than reporting zero kcal', () => {
    expect(sumNutrients([])).toMatchObject({ nutrients: null, entryCount: 0 });
  });
  it('excludes drafts from totals', () => {
    expect(sumNutrients([entry(), entry({ draft_state: 'draft' })])).toMatchObject({ entryCount: 1, nutrients: { kcal: 200 } });
    expect(sumNutrients([entry({ draft_state: 'draft' })]).nutrients).toBeNull();
  });
  it('retains missing ingredient coverage when a recipe becomes a diary snapshot', () => {
    const recipeTotal = sumNutrients([nutrients({ fiber_g: 2 }), nutrients(), nutrients()]);
    const snapshot = entry({ nutrients: recipeTotal.nutrients!, provenance_kind: 'recipe_batch', unknown_nutrient_counts: recipeTotal.unknownCount });
    const total = sumNutrients([snapshot, entry({ nutrients: nutrients({ fiber_g: 0 }) })]);
    expect(total.nutrients?.fiber_g).toBe(2);
    expect(total.unknownCount.fiber_g).toBe(2);
    expect(total.unknownCount.iron_mg).toBe(4);
    expect(total.entryCount).toBe(2);
  });
  it.each([-1, Infinity, NaN])('rejects invalid scale %s', (factor) => {
    expect(() => scaleNutrients(nutrients(), factor)).toThrow();
  });
  it('rejects nutrient overflow', () => {
    expect(() => scaleNutrients(nutrients({ kcal: Number.MAX_VALUE }), 2)).toThrow();
  });
});
