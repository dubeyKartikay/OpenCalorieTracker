import {
  calculateNutrition,
  GRAMS_PER_OUNCE,
  resolveQuantityToBasis,
  type FoodRecord,
  type FoodUnit,
  type Quantity,
} from '../../domain';

export const CUSTOM_BASE_UNITS = ['g', 'oz', 'ml', 'l', 'serving'] as const;
export type CustomBaseUnit = (typeof CUSTOM_BASE_UNITS)[number];

const RESERVED_UNIT_NAMES = new Set<string>(CUSTOM_BASE_UNITS);

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

export function kindOfFood(food: FoodRecord): 'recipe' | 'meal' | 'food' {
  if (!food.source_pack_id && food.id.startsWith('recipe:')) return 'recipe';
  if (!food.source_pack_id && food.id.startsWith('meal:')) return 'meal';
  return 'food';
}

function formatQuantityAmount(amount: number): string {
  if (Math.abs(amount - 0.5) < 0.001) return '½';
  if (Math.abs(amount - 1.5) < 0.001) return '1½';
  if (!Number.isFinite(amount)) return '—';
  const rounded = Math.round(amount * 100) / 100;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Shared recipe-aware quantity label formatter keeping stored `serving` intact while displaying "whole recipe". */
export function formatQuantityLabel(q: Quantity, food?: FoodRecord | null): string {
  if (food && kindOfFood(food) === 'recipe' && q.unit === 'serving') {
    return `${formatQuantityAmount(q.amount)} ${Math.abs(q.amount - 1) < 0.001 ? 'whole recipe' : 'whole recipes'}`;
  }
  if (q.amount === 1 && /^\d/.test(q.unit)) return q.unit;
  const unit = /^1\s+/.test(q.unit) ? q.unit.replace(/^1\s+/, '') : q.unit;
  return `${formatQuantityAmount(q.amount)} ${unit}`;
}

/** Appends fallback units (e.g. global units) AFTER food-specific units without overriding existing labels or density. */
export function appendFallbackUnits(food: FoodRecord, fallbackUnits: readonly FoodUnit[]): FoodRecord {
  const extras = fallbackUnits.filter(unit => !food.units.some(item => item.label === unit.label));
  return extras.length > 0 ? { ...food, units: [...food.units, ...extras] } : food;
}

function toFoodUnitMeasurement(
  food: FoodRecord,
  amount: number,
  baseUnit: CustomBaseUnit,
): { grams: number | null; ml: number | null } | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  switch (baseUnit) {
    case 'g':
      return { grams: round4(amount), ml: null };
    case 'oz':
      return { grams: round4(amount * GRAMS_PER_OUNCE), ml: null };
    case 'ml':
      return { grams: null, ml: round4(amount) };
    case 'l':
      return { grams: null, ml: round4(amount * 1000) };
    case 'serving': {
      if (food.serving_g == null && food.serving_ml == null) return null;
      return {
        grams: food.serving_g != null ? round4(amount * food.serving_g) : null,
        ml: food.serving_ml != null ? round4(amount * food.serving_ml) : null,
      };
    }
  }
}

/**
 * Returns the base units (`g`, `oz`, `ml`, `l`, `serving`) that can validly
 * convert to this food's nutrition basis when defining a custom unit.
 */
export function supportedBaseUnits(food: FoodRecord): CustomBaseUnit[] {
  const ordered: CustomBaseUnit[] =
    food.basis === 'per_100ml'
      ? ['ml', 'l', 'serving', 'g', 'oz']
      : ['g', 'oz', 'serving', 'ml', 'l'];

  return ordered.filter(baseUnit => {
    const measurement = toFoodUnitMeasurement(food, 1, baseUnit);
    if (!measurement) return false;
    const probeLabel = '__custom_unit_probe__';
    const probeUnit: FoodUnit = { label: probeLabel, ...measurement };
    const probeFood: FoodRecord = {
      ...food,
      units: [...food.units.filter(item => item.label !== probeLabel), probeUnit],
    };
    try {
      resolveQuantityToBasis(probeFood, { amount: 1, unit: probeLabel });
      return true;
    } catch {
      return false;
    }
  });
}

export function defaultBaseUnit(food: FoodRecord): CustomBaseUnit | null {
  return supportedBaseUnits(food)[0] ?? null;
}

export interface BuiltCustomUnit {
  unit: FoodUnit;
  updatedFood: FoodRecord;
  previewKcal: number;
}

/**
 * Validates `1 <label> = <amount> <baseUnit>` and builds a persisted `FoodUnit`
 * plus the updated `FoodRecord` and 1-unit calorie preview.
 */
export function buildCustomFoodUnit(
  food: FoodRecord,
  labelInput: string,
  amountInput: number,
  baseUnit: CustomBaseUnit,
): BuiltCustomUnit {
  const label = labelInput.trim();
  if (!label) {
    throw new Error('Enter a unit name such as bowl or katori.');
  }
  if (RESERVED_UNIT_NAMES.has(label.toLowerCase())) {
    throw new Error('Choose a unit name such as bowl, katori, or scoop.');
  }
  if (!Number.isFinite(amountInput) || amountInput <= 0) {
    throw new Error('Enter a positive amount.');
  }
  const measurement = toFoodUnitMeasurement(food, amountInput, baseUnit);
  if (!measurement) {
    throw new Error(`Cannot define a unit using ${baseUnit} for this food.`);
  }
  const unit: FoodUnit = { label, ...measurement };
  const updatedFood: FoodRecord = {
    ...food,
    units: [...food.units.filter(item => item.label !== label), unit],
  };
  resolveQuantityToBasis(updatedFood, { amount: 1, unit: label });
  const previewKcal = calculateNutrition(updatedFood, { amount: 1, unit: label }).kcal;
  return { unit, updatedFood, previewKcal };
}

export function previewCustomUnitKcal(
  food: FoodRecord,
  labelInput: string,
  amountText: string,
  baseUnit: CustomBaseUnit,
): number | null {
  const trimmedAmount = amountText.trim();
  if (!trimmedAmount) return null;
  const amount = Number(trimmedAmount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  try {
    return buildCustomFoodUnit(food, labelInput.trim() || 'unit', amount, baseUnit).previewKcal;
  } catch {
    return null;
  }
}

export interface PricedPortion extends Quantity {
  kcal: number | undefined;
}

/**
 * Builds up to 3 deduplicated portion candidates combining learned portions,
 * the food's usual portion, an alternate named unit, and ½x / 2x fallbacks.
 */
export function buildPortionCandidates(
  food: FoodRecord,
  basePortion: Quantity,
  validUnits: readonly string[],
  learned: readonly Quantity[] = [],
): Quantity[] {
  const validSet = new Set(validUnits);
  const filteredLearned = learned
    .filter(item => validSet.has(item.unit))
    .map(item => ({ amount: item.amount, unit: item.unit }));
  const alternative = food.units.find(
    unit => unit.label !== basePortion.unit && validSet.has(unit.label),
  );
  const candidates: Quantity[] = [
    ...filteredLearned,
    basePortion,
    ...(alternative ? [{ amount: 1, unit: alternative.label }] : []),
    { ...basePortion, amount: basePortion.amount / 2 },
    { ...basePortion, amount: basePortion.amount * 2 },
  ];
  return candidates
    .filter(
      (item, index) =>
        candidates.findIndex(
          other => other.unit === item.unit && Math.abs(other.amount - item.amount) < 0.0001,
        ) === index,
    )
    .slice(0, 3);
}

/** Computes local kcal previews for portion candidates using `calculateNutrition`. */
export function pricePortionCandidates(
  food: FoodRecord,
  candidates: readonly Quantity[],
): PricedPortion[] {
  return candidates.map(portion => {
    try {
      return { ...portion, kcal: calculateNutrition(food, portion).kcal };
    } catch {
      return { ...portion, kcal: undefined };
    }
  });
}

/** Ensures the currently selected portion appears in the top 3 displayed chips. */
export function mergeSelectedPortion(
  portions: readonly PricedPortion[],
  food: FoodRecord,
  selected: Quantity,
): PricedPortion[] {
  if (
    portions.some(
      portion =>
        portion.unit === selected.unit && Math.abs(portion.amount - selected.amount) < 0.0001,
    )
  ) {
    return [...portions];
  }
  let kcal: number | undefined;
  try {
    kcal = calculateNutrition(food, selected).kcal;
  } catch {
    kcal = undefined;
  }
  return [{ ...selected, kcal }, ...portions].slice(0, 3);
}

/** Toggles a meal in a multi-select destination list, preserving order for remaining items. */
export function toggleMealSelection(selectedMeals: readonly string[], meal: string): string[] {
  return selectedMeals.includes(meal)
    ? selectedMeals.filter(item => item !== meal)
    : [...selectedMeals, meal];
}

/** Orders selected meals according to the day's meal list, preserving any extra meals at the end. */
export function orderSelectedMeals(
  selectedMeals: readonly string[],
  availableMeals: readonly string[],
): string[] {
  const unique = [...new Set(selectedMeals.map(meal => meal.trim()).filter(Boolean))];
  const selectedSet = new Set(unique);
  const ordered = availableMeals.filter(meal => selectedSet.has(meal));
  const orderedSet = new Set(ordered);
  for (const meal of unique) {
    if (!orderedSet.has(meal)) ordered.push(meal);
  }
  return ordered;
}

/** Formats the primary Add CTA label for one or more selected meal destinations. */
export function formatAddToMealsLabel(
  selectedMeals: readonly string[],
  energyText?: string | null,
): string {
  if (selectedMeals.length === 0) return 'Select a meal';
  const suffix = energyText ? ` · ${energyText}` : '';
  if (selectedMeals.length === 1) {
    return `Add to ${selectedMeals[0]}${suffix}`;
  }
  if (selectedMeals.length === 2) {
    return `Add to ${selectedMeals[0]} & ${selectedMeals[1]}${suffix}`;
  }
  return `Add to ${selectedMeals.length} meals${energyText ? ` · ${energyText} each` : ''}`;
}

/** Computes how many search result rows fit cleanly inside an available results tray height. */
export function computeResultsPerPage(
  containerHeight: number,
  rowHeight = 56,
  footerHeight = 36,
  minRows = 4,
  maxRows = 12,
): number {
  if (!Number.isFinite(containerHeight) || containerHeight <= 0 || rowHeight <= 0) {
    return minRows;
  }
  const bodyHeight = Math.max(0, containerHeight - footerHeight);
  const fit = Math.floor(bodyHeight / rowHeight);
  return Math.max(minRows, Math.min(maxRows, fit));
}
