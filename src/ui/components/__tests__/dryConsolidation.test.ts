import { describe, expect, it } from 'vitest';
import { applyKeypadKey, formatDraftNumber, paginateList, toCanonicalKcal } from '../../format';
import { parseCustomFoodNutrients } from '../capture/customFoodForm';
import { canUndoMealAdd, defaultQuantity, mealsForDay, parseRouteDate, type UndoAction } from '../../../app/controller';
import { calculateNutrition, KJ_PER_KCAL, MAX_BATCH_FRACTION, type DiaryEntrySnapshot, type FoodRecord } from '../../../domain';

describe('DRY shared helpers', () => {
  it('applyKeypadKey preserves leading zeros in digitString mode and clears cleanly when allowEmpty', () => {
    expect(applyKeypadKey('', '0', false, true, true)).toBe('0');
    expect(applyKeypadKey('0', '0', false, true, true)).toBe('00');
    expect(applyKeypadKey('0042', '⌫', false, true, true)).toBe('004');
    expect(applyKeypadKey('0', '⌫', false, true, true)).toBe('');
    expect(applyKeypadKey('5', '⌫', false, true, false)).toBe('');
    expect(applyKeypadKey('5', '⌫', false, false, false)).toBe('0');
  });

  it('formatDraftNumber formats integer groups while preserving trailing decimal points', () => {
    expect(formatDraftNumber('')).toBe('0');
    expect(formatDraftNumber('1250')).toBe('1,250');
    expect(formatDraftNumber('1250.')).toBe('1,250.');
    expect(formatDraftNumber('1250.5')).toBe('1,250.5');
  });

  it('parseCustomFoodNutrients converts kJ via domain kjToKcal and leaves optional fiber null', () => {
    const parsed = parseCustomFoodNutrients({
      kcal: String(100 * KJ_PER_KCAL),
      proteinG: '10',
      carbsG: '20',
      fatG: '5',
      fiberG: '',
    }, 'kJ');
    expect(parsed.kcal).toBeCloseTo(100, 6);
    expect(parsed.protein_g).toBe(10);
    expect(parsed.fiber_g).toBeNull();
    expect(toCanonicalKcal(418.4, 'kJ')).toBeCloseTo(100, 6);
  });

  it('mealsForDay appends logged and extra active meal names missing from configured sections', () => {
    const stubEntry = { meal: 'Pre-workout' } as DiaryEntrySnapshot;
    expect(mealsForDay(['Breakfast', 'Lunch', 'Dinner'], [stubEntry], ['Late snack', 'Lunch', null, ''])).toEqual([
      'Breakfast',
      'Lunch',
      'Dinner',
      'Pre-workout',
      'Late snack',
    ]);
  });

  it('canUndoMealAdd scopes meal-row undo strictly to matching add action, date, and meal', () => {
    const addUndo: UndoAction = {
      label: 'Added Oats to Breakfast',
      kind: 'add',
      date: '2026-11-26',
      meal: 'Breakfast',
      run: async () => {},
    };
    const moveUndo: UndoAction = {
      label: 'Moved Oats to Breakfast',
      kind: 'move',
      date: '2026-11-26',
      meal: 'Breakfast',
      run: async () => {},
    };
    expect(canUndoMealAdd(addUndo, '2026-11-26', 'Breakfast')).toBe(true);
    expect(canUndoMealAdd(addUndo, '2026-11-25', 'Breakfast')).toBe(false);
    expect(canUndoMealAdd(addUndo, '2026-11-26', 'Lunch')).toBe(false);
    expect(canUndoMealAdd(moveUndo, '2026-11-26', 'Breakfast')).toBe(false);
    expect(canUndoMealAdd(null, '2026-11-26', 'Breakfast')).toBe(false);
  });

  it('defaultQuantity stays basis-aware for per_100ml foods even when serving_g is set', () => {
    const milk: FoodRecord = {
      id: 'milk-1',
      name: 'Oat Milk',
      brand: null,
      category: null,
      prep_state: 'unknown',
      basis: 'per_100ml',
      serving_g: 240,
      serving_ml: null,
      nutrients: {
        kcal: 45,
        protein_g: 1,
        carbs_g: 7,
        fat_g: 1.5,
        fiber_g: null,
        sugar_g: null,
        sat_fat_g: null,
        sodium_mg: null,
        calcium_mg: null,
        iron_mg: null,
        potassium_mg: null,
      },
      units: [],
      provenance_kind: 'user',
      source_pack_id: null,
      source_id: null,
      source_version: null,
    };
    const qty = defaultQuantity(milk);
    expect(qty).toEqual({ amount: 100, unit: 'ml' });
    expect(calculateNutrition(milk, qty).kcal).toBeCloseTo(45, 6);

    const milkWithServingMl: FoodRecord = { ...milk, serving_ml: 250 };
    expect(defaultQuantity(milkWithServingMl)).toEqual({ amount: 250, unit: 'ml' });
  });

  it('parseRouteDate rejects impossible calendar dates and future dates consistently', () => {
    expect(parseRouteDate('2026-02-30', { maxDate: '2026-11-26' })).toBeUndefined();
    expect(parseRouteDate('2026-04-31', { maxDate: '2026-11-26' })).toBeUndefined();
    expect(parseRouteDate('2026-12-01', { maxDate: '2026-11-26' })).toBeUndefined();
    expect(parseRouteDate('2024-02-29', { maxDate: '2026-11-26' })).toBe('2024-02-29');
    expect(parseRouteDate('2026-11-26', { maxDate: '2026-11-26' })).toBe('2026-11-26');
    expect(MAX_BATCH_FRACTION).toBe(1);
  });

  it('paginateList chunks results into fixed-size pages without dropping trailing items', () => {
    expect(paginateList([], 4)).toEqual([]);
    expect(paginateList([1, 2, 3], 4)).toEqual([[1, 2, 3]]);
    expect(paginateList([1, 2, 3, 4, 5, 6, 7, 8, 9], 4)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
  });
});
