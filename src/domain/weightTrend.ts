import { weighInSchema } from './schemas';
import type { WeighIn } from './types';

export const WEIGHT_TREND_ALPHA = 0.10;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export interface WeightTrendPoint { weighIn: WeighIn; trendKg: number }

/** One EWMA step per observation, not per elapsed day. Input is sorted without mutation. */
export function calculateWeightTrend(weighIns: readonly WeighIn[]): WeightTrendPoint[] {
  const sorted = weighIns.map((entry) => weighInSchema.parse(entry))
    .sort((a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at) || a.id.localeCompare(b.id));
  const seenIds = new Set<string>();
  const seenExternal = new Set<string>();
  let trend: number | undefined;
  return sorted.map((weighIn) => {
    if (seenIds.has(weighIn.id) || (weighIn.external_source_id !== null && seenExternal.has(weighIn.external_source_id))) {
      throw new RangeError('Duplicate weigh-in; deduplicate health imports before calculating a trend');
    }
    seenIds.add(weighIn.id);
    if (weighIn.external_source_id !== null) seenExternal.add(weighIn.external_source_id);
    trend = trend === undefined ? weighIn.weight_kg : trend + WEIGHT_TREND_ALPHA * (weighIn.weight_kg - trend);
    return { weighIn, trendKg: trend };
  });
}

/** Signed kg/week between the first and last EWMA points; unknown for fewer than two distinct instants. */
export function calculateWeeklyRate(points: readonly WeightTrendPoint[]): number | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || points.length < 2) return null;
  const elapsed = Date.parse(last.weighIn.measured_at) - Date.parse(first.weighIn.measured_at);
  if (elapsed <= 0) return null;
  return (last.trendKg - first.trendKg) * WEEK_MS / elapsed;
}
