import type { DiaryDay, NutrientKey } from './types';
import type { WeightTrendPoint } from './weightTrend';

const nutrientColumns = [
  'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sat_fat_g',
  'sodium_mg', 'calcium_mg', 'iron_mg', 'potassium_mg',
] as const satisfies readonly NutrientKey[];
type CsvField = string | number | null | undefined;

function escapeField(value: CsvField): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(Number(value.toFixed(4)));
  // Only text is neutralized; negative numeric values remain numbers.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[,"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function formatCsv(rows: CsvField[][]): string {
  return rows.map((row) => row.map(escapeField).join(',')).join('\r\n') + '\r\n';
}

/** Exports frozen confirmed nutrition snapshots without changing diary ordering. */
export function formatDiaryCsv(days: DiaryDay[]): string {
  const entries = days.flatMap((day) => day.entries)
    .filter((entry) => entry.draft_state === 'confirmed')
    .sort((a, b) => a.date.localeCompare(b.date) || Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  return formatCsv([
    ['date', 'meal', 'occurred_at', 'time_zone', 'food_name', 'brand', 'provenance_kind',
      'source_pack_id', 'portion_certainty', 'quantity_amount', 'quantity_unit', ...nutrientColumns],
    ...entries.map((entry) => [
      entry.date, entry.meal, entry.occurred_at, entry.time_zone, entry.food.name, entry.food.brand,
      entry.provenance_kind, entry.food.source_pack_id, entry.portion_certainty,
      entry.quantity.amount, entry.quantity.unit, ...nutrientColumns.map((key) => entry.nutrients[key]),
    ]),
  ]);
}

/** Preserves the supplied trend observations and their precomputed EWMA values. */
export function formatWeightTrendsCsv(trend: WeightTrendPoint[]): string {
  return formatCsv([
    ['date', 'measured_at', 'weight_kg', 'trend_kg', 'source'],
    ...trend.map(({ weighIn, trendKg }) => [
      weighIn.date, weighIn.measured_at, weighIn.weight_kg, trendKg, weighIn.source,
    ]),
  ]);
}
