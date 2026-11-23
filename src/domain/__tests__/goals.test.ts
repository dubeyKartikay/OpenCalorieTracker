import { describe, expect, it } from 'vitest';
import { estimateDailyTarget, getActiveGoalForDate, kcalToKj, kjToKcal } from '../goals';
import type { TargetInputs, TargetPolicy } from '../goals';
import { goal } from './fixtures';

// Test fixture policy only. The PRD requires sourced production thresholds before alpha.
const policy: TargetPolicy = { minimumKcal: 1200, maxWeeklyRateKg: 0.75, kcalPerKg: 7700, rationale: 'Test fixture policy', source: 'Unit-test fixture; not a production recommendation' };
const input: TargetInputs = {
  adultConfirmed: true, ageYears: 30, weightKg: 80, heightCm: 180,
  equationCoefficient: 5, activityFactor: 1.2, activityAssumption: 'User selected activity multiplier',
  mode: 'maintain', weeklyRateKg: 0,
};

describe('goal estimation', () => {
  it('exposes the complete Mifflin–St Jeor formula, inputs and activity assumption', () => {
    const estimate = estimateDailyTarget(input, policy);
    expect(estimate).toMatchObject({ bmrKcal: 1780, maintenanceKcal: 2136, targetKcal: 2136, impliedWeeklyChangeKg: 0, notices: [] });
    expect(estimate.breakdown).toMatchObject({ weightTerm: 800, heightTerm: 1125, ageTerm: -150, coefficient: 5, activityFactor: 1.2, activityAssumption: input.activityAssumption, policy });
    expect(estimate.breakdown.equation).toContain('10 × weightKg');
  });
  it('uses the explicitly chosen coefficient without inferring identity', () => {
    expect(estimateDailyTarget({ ...input, equationCoefficient: -161 }, policy).bmrKcal).toBe(1614);
  });
  it('applies signed loss and gain adjustments deterministically', () => {
    expect(estimateDailyTarget({ ...input, mode: 'lose', weeklyRateKg: 0.5 }, policy).targetKcal).toBe(1586);
    expect(estimateDailyTarget({ ...input, mode: 'gain', weeklyRateKg: 0.5 }, policy).targetKcal).toBe(2686);
  });
  it('caps the generated weekly change and gives a neutral notice', () => {
    const estimate = estimateDailyTarget({ ...input, mode: 'lose', weeklyRateKg: 2 }, policy);
    expect(estimate.appliedWeeklyRateKg).toBe(0.75);
    expect(estimate.targetKcal).toBe(1311);
    expect(estimate.notices).toEqual(['The generated weekly rate was limited to the documented policy cap.']);
  });
  it('applies the configured calorie floor and reports the actual implied change', () => {
    const estimate = estimateDailyTarget({ ...input, weightKg: 55, heightCm: 160, equationCoefficient: -161, mode: 'lose', weeklyRateKg: 0.75 }, policy);
    expect(estimate.targetKcal).toBe(1200);
    expect(Math.abs(estimate.impliedWeeklyChangeKg)).toBeLessThanOrEqual(policy.maxWeeklyRateKg);
    expect(estimate.notices[0]).toContain('lower target requires manual entry');
  });
  it('does not generate targets in observe mode', () => {
    expect(estimateDailyTarget({ ...input, mode: 'observe', weeklyRateKg: 100 }, policy)).toMatchObject({ targetKcal: null, appliedWeeklyRateKg: 0, notices: [] });
  });
  it('refuses to generate a target when the floor and rate cap conflict', () => {
    expect(() => estimateDailyTarget(input, { ...policy, minimumKcal: 5000 })).toThrow('conflict');
  });
  it('requires adult confirmation and all equation inputs', () => {
    expect(() => estimateDailyTarget({ ...input, adultConfirmed: false } as unknown as TargetInputs, policy)).toThrow();
    expect(() => estimateDailyTarget({ ...input, ageYears: 17 }, policy)).toThrow();
    expect(() => estimateDailyTarget({ ...input, equationCoefficient: undefined } as unknown as TargetInputs, policy)).toThrow();
  });
  it('requires documented policy sources and valid measurements', () => {
    expect(() => estimateDailyTarget(input, { ...policy, source: '' })).toThrow();
    expect(() => estimateDailyTarget(input, { ...policy, maxWeeklyRateKg: 0 })).toThrow();
    expect(() => estimateDailyTarget({ ...input, weightKg: NaN }, policy)).toThrow();
    expect(() => estimateDailyTarget({ ...input, activityFactor: 0 }, policy)).toThrow();
  });
  it('converts kcal and kJ using precisely 4.184', () => {
    expect(kcalToKj(100)).toBeCloseTo(418.4, 12);
    expect(kjToKcal(4184)).toBe(1000);
    expect(kjToKcal(kcalToKj(137))).toBeCloseTo(137, 12);
    expect(() => kcalToKj(Infinity)).toThrow();
    expect(() => kjToKcal(NaN)).toThrow();
  });
});

describe('goal history', () => {
  it('finds the most recent effective period, even when unsorted', () => {
    const old = goal('2026-01-01', 2000);
    const newer = goal('2026-06-01', 2100);
    expect(getActiveGoalForDate([newer, old], '2026-05-31')).toEqual(old);
    expect(getActiveGoalForDate([old, newer], '2026-06-01')).toEqual(newer);
  });
  it('returns no goal before the first period or with empty history', () => {
    expect(getActiveGoalForDate([goal('2026-01-01')], '2025-12-31')).toBeNull();
    expect(getActiveGoalForDate([], '2026-11-23')).toBeNull();
  });
  it('does not rewrite or mutate past targets and supports observe periods', () => {
    const periods = [goal('2026-01-01'), goal('2026-03-08', null)];
    const before = structuredClone(periods);
    expect(getActiveGoalForDate(periods, '2026-03-08')?.target_kcal).toBeNull();
    expect(getActiveGoalForDate(periods, '2026-03-07')?.target_kcal).toBe(2000);
    expect(periods).toEqual(before);
  });
  it('uses local ISO calendar dates through DST boundaries', () => {
    const periods = [goal('2026-03-07', 2000), goal('2026-03-08', 2200)];
    expect(getActiveGoalForDate(periods, '2026-03-08')?.target_kcal).toBe(2200);
    expect(() => getActiveGoalForDate(periods, '2026-03-08T00:00:00-05:00')).toThrow();
    expect(() => getActiveGoalForDate(periods, '2026-02-30')).toThrow();
  });
  it('rejects duplicate effective dates rather than making an order-dependent choice', () => {
    expect(() => getActiveGoalForDate([goal('2026-01-01'), goal('2026-01-01', 2200)], '2026-11-23')).toThrow('unique');
  });
});
