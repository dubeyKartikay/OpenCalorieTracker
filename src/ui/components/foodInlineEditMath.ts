import { foodRecordSchema } from '../../domain';
import type { FoodRecord, NutrientKey, NutrientProfile } from '../../domain';
import { energyValue, toCanonicalKcal } from '../format';
import { parseNonNegativeNumber, type CustomFoodBasis } from './capture/customFoodForm';

export type EditableFoodField = 'name' | 'brand' | 'basis' | NutrientKey;
export type EditableTarget = EditableFoodField | 'hero_kcal';

export type InlineEditModeState =
  | { mode: 'normal'; armedTarget: EditableTarget | null }
  | { mode: 'edit'; activeTarget: EditableTarget };

export type InlineEditTapTransition = 'armed' | 'enter-edit' | 'switch-field' | 'noop';

export interface NutrientRowDescriptor {
  key: NutrientKey;
  label: string;
  shortLabel: string;
  unit: (energyUnit: 'kcal' | 'kJ') => string;
  required: boolean;
  sub?: boolean;
  bold?: boolean;
  ruleAfter?: boolean;
  digits: number;
}

/** Single source of truth for the Food Detail nutrition table and inline editing. */
export const NUTRIENT_ROWS: readonly NutrientRowDescriptor[] = [
  { key: 'kcal', label: 'Energy', shortLabel: 'Energy', unit: energyUnit => energyUnit, required: true, bold: true, ruleAfter: true, digits: 0 },
  { key: 'protein_g', label: 'Protein', shortLabel: 'Protein', unit: () => 'g', required: true, bold: true, digits: 1 },
  { key: 'carbs_g', label: 'Carbohydrates', shortLabel: 'Carbs', unit: () => 'g', required: true, bold: true, digits: 1 },
  { key: 'fiber_g', label: 'Fiber', shortLabel: 'Fiber', unit: () => 'g', required: false, sub: true, digits: 1 },
  { key: 'sugar_g', label: 'Sugar', shortLabel: 'Sugar', unit: () => 'g', required: false, sub: true, digits: 1 },
  { key: 'fat_g', label: 'Fat', shortLabel: 'Fat', unit: () => 'g', required: true, bold: true, digits: 1 },
  { key: 'sat_fat_g', label: 'Saturated fat', shortLabel: 'Saturated fat', unit: () => 'g', required: false, sub: true, ruleAfter: true, digits: 1 },
  { key: 'sodium_mg', label: 'Sodium', shortLabel: 'Sodium', unit: () => 'mg', required: false, digits: 0 },
  { key: 'potassium_mg', label: 'Potassium', shortLabel: 'Potassium', unit: () => 'mg', required: false, digits: 0 },
  { key: 'calcium_mg', label: 'Calcium', shortLabel: 'Calcium', unit: () => 'mg', required: false, digits: 0 },
  { key: 'iron_mg', label: 'Iron', shortLabel: 'Iron', unit: () => 'mg', required: false, digits: 1 },
];

export const INITIAL_INLINE_EDIT_STATE: InlineEditModeState = {
  mode: 'normal',
  armedTarget: null,
};

export function targetToField(target: EditableTarget): EditableFoodField {
  return target === 'hero_kcal' ? 'kcal' : target;
}

/**
 * Vim-inspired modal tap transition:
 * - Normal mode: first tap arms a target (shows edit icon), second tap on the same target enters edit mode.
 * - Edit mode: tapping any other editable target switches directly to editing it.
 */
export function tapEditableTarget(
  state: InlineEditModeState,
  target: EditableTarget,
): { next: InlineEditModeState; transition: InlineEditTapTransition } {
  if (state.mode === 'normal') {
    if (state.armedTarget === target) {
      return { next: { mode: 'edit', activeTarget: target }, transition: 'enter-edit' };
    }
    return { next: { mode: 'normal', armedTarget: target }, transition: 'armed' };
  }
  if (state.activeTarget === target) {
    return { next: state, transition: 'noop' };
  }
  return { next: { mode: 'edit', activeTarget: target }, transition: 'switch-field' };
}

export interface InlineFoodDraft {
  name: string;
  brand: string;
  basis: CustomFoodBasis;
  nutrients: Record<NutrientKey, string>;
  dirtyFields: ReadonlySet<EditableFoodField>;
}

function roundClean(value: number, decimals = 2): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function formatEditableNumber(value: number | null | undefined, digits: number): string {
  if (value == null || !Number.isFinite(value)) return '';
  const rounded = roundClean(value, Math.max(digits, 1));
  return String(rounded);
}

/** Initialize an inline edit draft matching the values currently displayed on screen. */
export function createInlineFoodDraft(
  food: FoodRecord,
  displayedNutrients: NutrientProfile | undefined,
  energyUnit: 'kcal' | 'kJ',
): InlineFoodDraft {
  const source = displayedNutrients ?? food.nutrients;
  const nutrients = {} as Record<NutrientKey, string>;
  for (const row of NUTRIENT_ROWS) {
    const raw = row.key === 'kcal' ? energyValue(source.kcal, energyUnit) : source[row.key];
    nutrients[row.key] = formatEditableNumber(raw, row.digits);
  }
  return {
    name: food.name,
    brand: food.brand ?? '',
    basis: food.basis,
    nutrients,
    dirtyFields: new Set(),
  };
}

export function updateInlineFoodDraft(
  draft: InlineFoodDraft,
  field: EditableFoodField,
  value: string,
): InlineFoodDraft {
  const dirtyFields = new Set(draft.dirtyFields);
  dirtyFields.add(field);
  if (field === 'name') return { ...draft, name: value, dirtyFields };
  if (field === 'brand') return { ...draft, brand: value, dirtyFields };
  if (field === 'basis') return { ...draft, basis: value as CustomFoodBasis, dirtyFields };
  return {
    ...draft,
    nutrients: { ...draft.nutrients, [field]: value },
    dirtyFields,
  };
}

function safeFactor(factor: number): number {
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

function toStoredNutrient(
  row: NutrientRowDescriptor,
  rawDisplayed: number | null,
  basisFactor: number,
  energyUnit: 'kcal' | 'kJ',
): number | null {
  if (rawDisplayed == null) return null;
  const unscaled = rawDisplayed / safeFactor(basisFactor);
  const canonical = row.key === 'kcal' ? toCanonicalKcal(unscaled, energyUnit) : unscaled;
  return roundClean(canonical, 2);
}

function nearlyEqualNullable(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 0.015;
}

function assignNutrient(target: NutrientProfile, key: NutrientKey, value: number | null): void {
  (target as Record<NutrientKey, number | null>)[key] = value;
}

/**
 * Compute an optimistic preview FoodRecord while typing in Edit mode.
 * Incomplete/invalid partial numeric strings are ignored so live bars never crash.
 */
export function buildLivePreviewFood(
  original: FoodRecord,
  draft: InlineFoodDraft,
  basisFactor: number,
  energyUnit: 'kcal' | 'kJ',
): FoodRecord {
  if (draft.dirtyFields.size === 0) return original;
  const nextNutrients: NutrientProfile = { ...original.nutrients };
  for (const row of NUTRIENT_ROWS) {
    if (!draft.dirtyFields.has(row.key)) continue;
    const text = draft.nutrients[row.key].trim();
    if (!text) {
      if (!row.required) assignNutrient(nextNutrients, row.key, null);
      continue;
    }
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    const stored = toStoredNutrient(row, parsed, basisFactor, energyUnit);
    if (stored != null || !row.required) {
      assignNutrient(nextNutrients, row.key, stored);
    }
  }
  return {
    ...original,
    name: draft.name.trim() || original.name,
    brand: draft.dirtyFields.has('brand') ? (draft.brand.trim() || null) : original.brand,
    basis: draft.basis,
    nutrients: nextNutrients,
  };
}

/**
 * Validate and apply all dirty fields in `draft` onto `original`.
 * Untouched fields keep their exact canonical values with zero floating-point drift.
 */
export function applyInlineFoodDraft(
  original: FoodRecord,
  draft: InlineFoodDraft,
  basisFactor: number,
  energyUnit: 'kcal' | 'kJ',
): { updated: FoodRecord; changedFields: string[]; changed: boolean } {
  if (draft.dirtyFields.size === 0) {
    return { updated: original, changedFields: [], changed: false };
  }

  const changedFields: string[] = [];

  let nextName = original.name;
  if (draft.dirtyFields.has('name')) {
    const trimmed = draft.name.trim();
    if (!trimmed) throw new Error('Enter a food name before saving.');
    nextName = trimmed;
    if (nextName !== original.name) changedFields.push('Name');
  }

  let nextBrand = original.brand;
  if (draft.dirtyFields.has('brand')) {
    nextBrand = draft.brand.trim() || null;
    if (nextBrand !== (original.brand ?? null)) changedFields.push('Brand');
  }

  let nextBasis = original.basis;
  if (draft.dirtyFields.has('basis')) {
    nextBasis = draft.basis;
    if (nextBasis !== original.basis) changedFields.push('Reference basis');
  }

  const nextNutrients: NutrientProfile = { ...original.nutrients };
  for (const row of NUTRIENT_ROWS) {
    if (!draft.dirtyFields.has(row.key)) continue;
    const parsed = parseNonNegativeNumber(draft.nutrients[row.key], row.shortLabel.toLowerCase(), row.required);
    const stored = toStoredNutrient(row, parsed, basisFactor, energyUnit);
    if (!nearlyEqualNullable(original.nutrients[row.key], stored)) {
      assignNutrient(nextNutrients, row.key, stored);
      changedFields.push(row.shortLabel);
    }
  }

  if (changedFields.length === 0) {
    return { updated: original, changedFields: [], changed: false };
  }

  const updated = foodRecordSchema.parse({
    ...original,
    name: nextName,
    brand: nextBrand,
    basis: nextBasis,
    nutrients: nextNutrients,
  });

  return { updated, changedFields, changed: true };
}

/** Concise one-line summary for the UndoToast telling the user exactly what was edited. */
export function formatEditedFieldsSummary(changedFields: readonly string[]): string {
  if (changedFields.length === 0) return 'No changes';
  if (changedFields.length === 1) return `Edited ${changedFields[0]}`;
  if (changedFields.length === 2) return `Edited ${changedFields[0]} and ${changedFields[1]}`;
  if (changedFields.length === 3) return `Edited ${changedFields[0]}, ${changedFields[1]}, and ${changedFields[2]}`;
  return `Edited ${changedFields[0]}, ${changedFields[1]}, and ${changedFields.length - 2} more`;
}

export interface ReadOnlyEditHint {
  message: string;
  actionLabel: string | null;
  actionKind: 'copy-custom' | 'edit-recipe' | null;
}

/**
 * Subtle contextual hint shown only when a user taps an otherwise-editable field
 * (name, energy, nutrient) on a read-only food, recipe, or saved meal.
 */
export function getReadOnlyEditHint(
  kind: 'food' | 'recipe' | 'meal',
  isDatabaseFood: boolean,
): ReadOnlyEditHint | null {
  if (isDatabaseFood) {
    return {
      message: 'Copy to edit food',
      actionLabel: 'Copy & edit',
      actionKind: 'copy-custom',
    };
  }
  if (kind === 'recipe') {
    return {
      message: 'Edit via ingredients',
      actionLabel: 'Edit recipe',
      actionKind: 'edit-recipe',
    };
  }
  if (kind === 'meal') {
    return {
      message: 'Sum of logged items',
      actionLabel: null,
      actionKind: null,
    };
  }
  return null;
}
