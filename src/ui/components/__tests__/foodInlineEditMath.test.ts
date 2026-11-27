import { describe, expect, it } from 'vitest';
import { calculateNutrition, foodRecordSchema, kcalToKj } from '../../../domain';
import {
  applyInlineFoodDraft,
  buildLivePreviewFood,
  createInlineFoodDraft,
  formatEditedFieldsSummary,
  getReadOnlyEditHint,
  INITIAL_INLINE_EDIT_STATE,
  tapEditableTarget,
  targetToField,
  updateInlineFoodDraft,
} from '../foodInlineEditMath';

const baseFood = foodRecordSchema.parse({
  id: 'custom-oats',
  name: 'Overnight Oats',
  brand: 'Homemade',
  prep_state: 'unknown',
  basis: 'per_100g',
  serving_g: 50,
  nutrients: {
    kcal: 380,
    protein_g: 14,
    carbs_g: 62,
    fat_g: 8,
    fiber_g: 9,
    sugar_g: 6,
    sat_fat_g: 1.5,
    sodium_mg: 40,
    potassium_mg: 320,
    calcium_mg: null,
    iron_mg: null,
  },
  provenance_kind: 'user',
});

describe('foodInlineEditMath', () => {
  describe('Vim-style modal tap transitions', () => {
    it('arms on first tap and enters edit mode on second tap of the same target', () => {
      const first = tapEditableTarget(INITIAL_INLINE_EDIT_STATE, 'name');
      expect(first.transition).toBe('armed');
      expect(first.next).toEqual({ mode: 'normal', armedTarget: 'name' });

      const second = tapEditableTarget(first.next, 'name');
      expect(second.transition).toBe('enter-edit');
      expect(second.next).toEqual({ mode: 'edit', activeTarget: 'name' });
    });

    it('re-arms when tapping a different target in normal mode', () => {
      const armedName = tapEditableTarget(INITIAL_INLINE_EDIT_STATE, 'name').next;
      const armedKcal = tapEditableTarget(armedName, 'kcal');
      expect(armedKcal.transition).toBe('armed');
      expect(armedKcal.next).toEqual({ mode: 'normal', armedTarget: 'kcal' });
    });

    it('switches immediately to another target with a single tap while in edit mode', () => {
      const editingKcal = { mode: 'edit' as const, activeTarget: 'hero_kcal' as const };
      const switched = tapEditableTarget(editingKcal, 'protein_g');
      expect(switched.transition).toBe('switch-field');
      expect(switched.next).toEqual({ mode: 'edit', activeTarget: 'protein_g' });

      const same = tapEditableTarget(switched.next, 'protein_g');
      expect(same.transition).toBe('noop');
      expect(same.next).toBe(switched.next);
    });

    it('maps hero_kcal target to the canonical kcal field', () => {
      expect(targetToField('hero_kcal')).toBe('kcal');
      expect(targetToField('protein_g')).toBe('protein_g');
    });
  });

  describe('draft initialization and saving', () => {
    it('edits name, brand, and multiple nutrients in one edit session and reports exact changed fields', () => {
      let draft = createInlineFoodDraft(baseFood, baseFood.nutrients, 'kcal');
      draft = updateInlineFoodDraft(draft, 'name', 'Protein Overnight Oats');
      draft = updateInlineFoodDraft(draft, 'brand', '');
      draft = updateInlineFoodDraft(draft, 'protein_g', '22');
      draft = updateInlineFoodDraft(draft, 'iron_mg', '3.2');

      const result = applyInlineFoodDraft(baseFood, draft, 1, 'kcal');
      expect(result.changed).toBe(true);
      expect(result.changedFields).toEqual(['Name', 'Brand', 'Protein', 'Iron']);
      expect(result.updated.name).toBe('Protein Overnight Oats');
      expect(result.updated.brand).toBeNull();
      expect(result.updated.nutrients.protein_g).toBe(22);
      expect(result.updated.nutrients.iron_mg).toBe(3.2);
      expect(result.updated.nutrients.kcal).toBe(380);
    });

    it('scales edited portion values back to canonical basis without drifting untouched nutrients', () => {
      // Viewing 50 g portion (factor = 0.5): displayed Energy is 190 kcal, Protein is 7 g
      const displayed = calculateNutrition(baseFood, { amount: 50, unit: 'g' });
      let draft = createInlineFoodDraft(baseFood, displayed, 'kcal');
      expect(draft.nutrients.kcal).toBe('190');
      expect(draft.nutrients.protein_g).toBe('7');

      // User edits Energy from 190 -> 200 kcal for the 50 g portion
      draft = updateInlineFoodDraft(draft, 'kcal', '200');
      const result = applyInlineFoodDraft(baseFood, draft, 0.5, 'kcal');

      expect(result.changed).toBe(true);
      expect(result.changedFields).toEqual(['Energy']);
      expect(result.updated.nutrients.kcal).toBe(400);
      expect(result.updated.nutrients.protein_g).toBe(baseFood.nutrients.protein_g);
      expect(result.updated.nutrients.sat_fat_g).toBe(baseFood.nutrients.sat_fat_g);
    });

    it('converts kJ edits back to canonical kcal', () => {
      let draft = createInlineFoodDraft(baseFood, baseFood.nutrients, 'kJ');
      expect(Number(draft.nutrients.kcal)).toBeCloseTo(kcalToKj(380), 0);

      draft = updateInlineFoodDraft(draft, 'kcal', String(Math.round(kcalToKj(420))));
      const result = applyInlineFoodDraft(baseFood, draft, 1, 'kJ');
      expect(result.changed).toBe(true);
      expect(result.changedFields).toEqual(['Energy']);
      expect(result.updated.nutrients.kcal).toBeCloseTo(420, 0);
    });

    it('allows clearing optional nutrients back to null and rejects blank required fields', () => {
      let draft = createInlineFoodDraft(baseFood, baseFood.nutrients, 'kcal');
      draft = updateInlineFoodDraft(draft, 'fiber_g', '');
      const cleared = applyInlineFoodDraft(baseFood, draft, 1, 'kcal');
      expect(cleared.changed).toBe(true);
      expect(cleared.changedFields).toEqual(['Fiber']);
      expect(cleared.updated.nutrients.fiber_g).toBeNull();

      const blankName = updateInlineFoodDraft(createInlineFoodDraft(baseFood, baseFood.nutrients, 'kcal'), 'name', '   ');
      expect(() => applyInlineFoodDraft(baseFood, blankName, 1, 'kcal')).toThrow(/food name/i);

      const negativeProtein = updateInlineFoodDraft(createInlineFoodDraft(baseFood, baseFood.nutrients, 'kcal'), 'protein_g', '-5');
      expect(() => applyInlineFoodDraft(baseFood, negativeProtein, 1, 'kcal')).toThrow(/non-negative/i);
    });

    it('treats edits reverted to original values as a no-op', () => {
      let draft = createInlineFoodDraft(baseFood, baseFood.nutrients, 'kcal');
      draft = updateInlineFoodDraft(draft, 'name', 'Temp');
      draft = updateInlineFoodDraft(draft, 'name', 'Overnight Oats');
      const result = applyInlineFoodDraft(baseFood, draft, 1, 'kcal');
      expect(result.changed).toBe(false);
      expect(result.changedFields).toEqual([]);
      expect(result.updated).toBe(baseFood);
    });

    it('live-previews partial inputs safely without throwing', () => {
      let draft = createInlineFoodDraft(baseFood, baseFood.nutrients, 'kcal');
      draft = updateInlineFoodDraft(draft, 'kcal', '');
      draft = updateInlineFoodDraft(draft, 'protein_g', '20');
      const preview = buildLivePreviewFood(baseFood, draft, 1, 'kcal');
      expect(preview.nutrients.kcal).toBe(380);
      expect(preview.nutrients.protein_g).toBe(20);
    });
  });

  describe('formatEditedFieldsSummary', () => {
    it('formats concise summaries for 1, 2, 3, and 4+ fields', () => {
      expect(formatEditedFieldsSummary([])).toBe('No changes');
      expect(formatEditedFieldsSummary(['Name'])).toBe('Edited Name');
      expect(formatEditedFieldsSummary(['Name', 'Energy'])).toBe('Edited Name and Energy');
      expect(formatEditedFieldsSummary(['Name', 'Energy', 'Protein'])).toBe('Edited Name, Energy, and Protein');
      expect(formatEditedFieldsSummary(['Name', 'Energy', 'Protein', 'Fat'])).toBe('Edited Name, Energy, and 2 more');
    });
  });

  describe('getReadOnlyEditHint', () => {
    it('returns subtle contextual hints with direct actions for non-editable items and null for custom foods', () => {
      expect(getReadOnlyEditHint('food', false)).toBeNull();
      expect(getReadOnlyEditHint('food', true)).toEqual({
        message: 'Copy to edit food',
        actionLabel: 'Copy & edit',
        actionKind: 'copy-custom',
      });
      expect(getReadOnlyEditHint('recipe', false)).toEqual({
        message: 'Edit via ingredients',
        actionLabel: 'Edit recipe',
        actionKind: 'edit-recipe',
      });
      expect(getReadOnlyEditHint('meal', false)).toEqual({
        message: 'Sum of logged items',
        actionLabel: null,
        actionKind: null,
      });
    });
  });
});
