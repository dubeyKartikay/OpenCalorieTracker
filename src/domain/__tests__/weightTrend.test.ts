import { describe, expect, it } from 'vitest';
import { calculateWeeklyRate, calculateWeightTrend } from '../weightTrend';
import { weighIn } from './fixtures';

describe('weight trend', () => {
  it('starts at the first observation and applies α = 0.10 per weigh-in', () => {
    const trend = calculateWeightTrend([weighIn('2026-11-01', 80), weighIn('2026-11-02', 79), weighIn('2026-11-03', 78)]);
    expect(trend[0]?.trendKg).toBe(80);
    expect(trend[1]?.trendKg).toBeCloseTo(79.9, 12);
    expect(trend[2]?.trendKg).toBeCloseTo(79.71, 12);
  });
  it('applies one step after a gap, without fabricating daily readings', () => {
    const trend = calculateWeightTrend([weighIn('2026-11-01', 80), weighIn('2026-11-22', 70)]);
    expect(trend).toHaveLength(2);
    expect(trend[1]?.trendKg).toBe(79);
  });
  it('sorts observations chronologically without mutating input', () => {
    const readings = [weighIn('2026-11-03', 78), weighIn('2026-11-01', 80)];
    const before = structuredClone(readings);
    expect(calculateWeightTrend(readings).map((point) => point.trendKg)).toEqual([80, 79.8]);
    expect(readings).toEqual(before);
  });
  it('calculates signed kg per elapsed week from the smoothed trend', () => {
    expect(calculateWeeklyRate(calculateWeightTrend([weighIn('2026-11-01', 80), weighIn('2026-11-08', 78)]))).toBeCloseTo(-0.2, 12);
    expect(calculateWeeklyRate(calculateWeightTrend([weighIn('2026-11-01', 80), weighIn('2026-11-15', 82)]))).toBeCloseTo(0.1, 12);
  });
  it('uses instants with explicit offsets through daylight saving changes', () => {
    const trend = calculateWeightTrend([
      weighIn('2026-03-07', 80, { measured_at: '2026-03-07T08:00:00-05:00' }),
      weighIn('2026-03-14', 78, { measured_at: '2026-03-14T08:00:00-04:00' }),
    ]);
    expect(calculateWeeklyRate(trend)).toBeCloseTo(-0.2 * 168 / 167, 12);
  });
  it('returns unknown weekly rate without two different timestamps', () => {
    expect(calculateWeightTrend([])).toEqual([]);
    expect(calculateWeeklyRate([])).toBeNull();
    expect(calculateWeeklyRate(calculateWeightTrend([weighIn('2026-11-01', 80)]))).toBeNull();
    expect(calculateWeeklyRate(calculateWeightTrend([weighIn('2026-11-01', 80), weighIn('2026-11-01', 81)]))).toBeNull();
  });
  it('rejects duplicate health records and duplicate local ids', () => {
    const first = weighIn('2026-11-01', 80, { source: 'health', external_source_id: 'health-connect:record-1' });
    expect(() => calculateWeightTrend([first, { ...first }])).toThrow('Duplicate');
    expect(() => calculateWeightTrend([first, { ...weighIn('2026-11-02', 79), source: 'health', external_source_id: first.external_source_id }])).toThrow('Duplicate');
  });
  it('rejects invalid weights, dates, and health imports without dedup ids', () => {
    expect(() => calculateWeightTrend([weighIn('2026-11-01', 0)])).toThrow();
    expect(() => calculateWeightTrend([weighIn('2026-02-30', 80)])).toThrow();
    expect(() => calculateWeightTrend([weighIn('2026-11-01', 80, { source: 'health' })])).toThrow();
  });
});
