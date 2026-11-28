import { describe, expect, it } from 'vitest';
import { calculateBatchServing, calculateRecipeTotal } from '../recipeBatch';
import { recipeBatchSchema } from '../schemas';
import { batch, food, nutrients } from './fixtures';

describe('recipe batches', () => {
  it('uses cooked yield: 2400 kcal / 1600 g × 300 g = 450 kcal', () => {
    expect(calculateBatchServing(batch(), 300).nutrients?.kcal).toBe(450);
  });
  it('retains precision: 1033 kcal / 1180 g × 150 g = 131.31 kcal at presentation', () => {
    const kcal = calculateBatchServing(batch(1033, 1180), { grams: 150 }).nutrients?.kcal;
    expect(kcal).toBeCloseTo(131.3135593220339, 10);
    expect(kcal?.toFixed(2)).toBe('131.31');
  });
  it('accepts an explicit fraction independently of cooked weight', () => {
    expect(calculateBatchServing(batch(2400, null), { fraction: 0.25 }).nutrients?.kcal).toBe(600);
  });
  it('refuses gram portions without cooked weight', () => {
    expect(() => calculateBatchServing(batch(2400, null), 100)).toThrow('Cooked batch weight');
  });
  it('keeps partial coverage across ingredient totals and portions', () => {
    const source = batch();
    source.ingredients.push({ food: food({ nutrients: nutrients({ kcal: 100, fiber_g: 0 }) }), quantity: { amount: 100, unit: 'g' } });
    expect(calculateRecipeTotal(source.ingredients)).toMatchObject({ nutrients: { kcal: 2500, fiber_g: 0 }, unknownCount: { fiber_g: 1 } });
    expect(calculateBatchServing(source, { fraction: 0.5 })).toMatchObject({ nutrients: { kcal: 1250, fiber_g: 0 }, unknownCount: { fiber_g: 1 } });
  });
  it('freezes a cooked event independently of later ingredient edits', () => {
    const original = batch();
    const frozen = recipeBatchSchema.parse(original);
    original.ingredients[0]!.food.nutrients.kcal = 1;
    expect(calculateBatchServing(frozen, 300).nutrients?.kcal).toBe(450);
  });
  it('does not mutate a batch during calculation', () => {
    const source = batch();
    const before = structuredClone(source);
    calculateBatchServing(source, 300);
    expect(source).toEqual(before);
  });
  it.each([-1, Infinity, NaN])('rejects invalid portions %s', (amount) => {
    expect(() => calculateBatchServing(batch(), amount)).toThrow();
  });
  it('rejects fractions greater than a whole batch', () => {
    expect(() => calculateBatchServing(batch(), { fraction: 1.1 })).toThrow();
  });
  it('rejects gram portions greater than the cooked batch weight', () => {
    expect(() => calculateBatchServing(batch(600, 75), { grams: 150 })).toThrow(/cooked batch weight/i);
  });
});
