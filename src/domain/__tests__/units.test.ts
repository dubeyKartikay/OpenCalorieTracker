import { describe, expect, it } from 'vitest';
import { GRAMS_PER_OUNCE, resolveQuantityToBasis, UnitConversionError } from '../units';
import { food } from './fixtures';

describe('resolveQuantityToBasis', () => {
  it.each([[100, 'g', 1], [250, 'g', 2.5], [1, 'oz', GRAMS_PER_OUNCE / 100], [0, 'g', 0]])('converts %s %s on a mass basis', (amount, unit, factor) => {
    expect(resolveQuantityToBasis(food(), { amount, unit }).factor).toBe(factor);
  });
  it.each([[250, 'ml', 2.5], [1.5, 'l', 15]])('converts %s %s on a volume basis', (amount, unit, factor) => {
    expect(resolveQuantityToBasis(food({ basis: 'per_100ml' }), { amount, unit }).factor).toBe(factor);
  });
  it('converts a food-specific household unit', () => {
    const source = food({ units: [{ label: 'katori', grams: 150, ml: null }] });
    expect(resolveQuantityToBasis(source, { amount: 2, unit: 'katori' })).toEqual({ amount: 300, unit: 'g', factor: 3 });
  });
  it('converts servings using the food serving weight', () => {
    expect(resolveQuantityToBasis(food({ serving_g: 40 }), { amount: 2, unit: 'serving' }).factor).toBe(0.8);
  });
  it('scales a per-serving food by servings or grams', () => {
    const source = food({ basis: 'per_serving', serving_g: 40 });
    expect(resolveQuantityToBasis(source, { amount: 2, unit: 'serving' }).factor).toBe(2);
    expect(resolveQuantityToBasis(source, { amount: 100, unit: 'g' }).factor).toBe(2.5);
  });
  it('supports per-serving liquids and food units in ml', () => {
    const source = food({ basis: 'per_serving', serving_ml: 200, units: [{ label: 'glass', grams: null, ml: 250 }] });
    expect(resolveQuantityToBasis(source, { amount: 0.5, unit: 'l' }).factor).toBe(2.5);
    expect(resolveQuantityToBasis(source, { amount: 1, unit: 'glass' }).factor).toBe(1.25);
  });
  it.each([['per_100g', 'ml'], ['per_100g', 'l'], ['per_100ml', 'g'], ['per_100ml', 'oz']] as const)('refuses %s from %s without a food mapping', (basis, unit) => {
    expect(() => resolveQuantityToBasis(food({ basis }), { amount: 100, unit })).toThrow(UnitConversionError);
  });
  it('uses paired food-unit measurements for food-specific density', () => {
    const source = food({ units: [{ label: 'cup', grams: 80, ml: 100 }] });
    expect(resolveQuantityToBasis(source, { amount: 100, unit: 'ml' }).factor).toBe(0.8);
    expect(resolveQuantityToBasis({ ...source, basis: 'per_100ml' }, { amount: 80, unit: 'g' }).factor).toBe(1);
  });
  it('uses paired serving measurements for food-specific density', () => {
    expect(resolveQuantityToBasis(food({ serving_g: 80, serving_ml: 100 }), { amount: 100, unit: 'ml' }).factor).toBe(0.8);
  });
  it('refuses an unmeasured serving and unknown household unit', () => {
    expect(() => resolveQuantityToBasis(food(), { amount: 1, unit: 'serving' })).toThrow(UnitConversionError);
    expect(() => resolveQuantityToBasis(food(), { amount: 1, unit: 'bowl' })).toThrow(UnitConversionError);
    expect(() => resolveQuantityToBasis(food({ basis: 'per_serving' }), { amount: 10, unit: 'g' })).toThrow(UnitConversionError);
  });
  it.each([-1, NaN, Infinity])('rejects invalid amount %s', (amount) => {
    expect(() => resolveQuantityToBasis(food(), { amount, unit: 'g' })).toThrow();
  });
  it('rejects conversion overflow', () => {
    expect(() => resolveQuantityToBasis(food(), { amount: Number.MAX_VALUE, unit: 'oz' })).toThrow(UnitConversionError);
  });
});
