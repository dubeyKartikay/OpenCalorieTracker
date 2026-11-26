import { toCanonicalKcal } from '../../format';

export type CustomFoodBasis = 'per_100g' | 'per_100ml' | 'per_serving';

export const CUSTOM_FOOD_BASIS_OPTIONS: { value: CustomFoodBasis; label: string }[] = [
  { value: 'per_100g', label: 'per 100 g' },
  { value: 'per_100ml', label: 'per 100 ml' },
  { value: 'per_serving', label: 'per serving' },
];

export type CustomFoodNutrientKey = 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'fiberG' | 'sugarG';

export function customFoodNutrientFields(energyUnit: 'kcal' | 'kJ', includeSugar = true): {
  key: CustomFoodNutrientKey;
  label: string;
  unit: string;
  required: boolean;
}[] {
  const base: { key: CustomFoodNutrientKey; label: string; unit: string; required: boolean }[] = [
    { key: 'kcal', label: 'Energy', unit: energyUnit, required: true },
    { key: 'proteinG', label: 'Protein', unit: 'g', required: true },
    { key: 'carbsG', label: 'Carbs', unit: 'g', required: true },
    { key: 'fatG', label: 'Fat', unit: 'g', required: true },
    { key: 'fiberG', label: 'Fiber', unit: 'g', required: false },
  ];
  if (includeSugar) base.push({ key: 'sugarG', label: 'Sugar', unit: 'g', required: false });
  return base;
}

export function parseNonNegativeNumber(value: string, label: string, required = false): number | null {
  if (!value.trim()) {
    if (required) throw new Error(`Enter ${label} before saving.`);
    return null;
  }
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Enter a valid non-negative ${label}.`);
  return parsed;
}

export interface CustomFoodNutrientInputs {
  kcal: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  fiberG?: string;
  sugarG?: string;
}

/** Parse and validate custom-food nutrient strings into canonical kcal/gram numbers. */
export function parseCustomFoodNutrients(
  inputs: CustomFoodNutrientInputs,
  energyUnit: 'kcal' | 'kJ',
  isAlreadyCanonicalKcal = false,
) {
  const rawEnergy = parseNonNegativeNumber(inputs.kcal, 'energy', true);
  const kcal = rawEnergy == null ? null : isAlreadyCanonicalKcal ? rawEnergy : toCanonicalKcal(rawEnergy, energyUnit);
  return {
    kcal,
    protein_g: parseNonNegativeNumber(inputs.proteinG, 'protein', true),
    carbs_g: parseNonNegativeNumber(inputs.carbsG, 'carbs', true),
    fat_g: parseNonNegativeNumber(inputs.fatG, 'fat', true),
    fiber_g: parseNonNegativeNumber(inputs.fiberG ?? '', 'fiber', false),
    ...(inputs.sugarG !== undefined ? { sugar_g: parseNonNegativeNumber(inputs.sugarG, 'sugar', false) } : {}),
  };
}
