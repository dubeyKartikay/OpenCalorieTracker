import { z } from 'zod';
import { goalPeriodSchema, isoDateSchema } from './schemas';
import type { GoalPeriod } from './types';

export const KJ_PER_KCAL = 4.184;
export function kcalToKj(kcal: number): number {
  if (!Number.isFinite(kcal)) throw new RangeError('Energy must be finite');
  return kcal * KJ_PER_KCAL;
}
export function kjToKcal(kj: number): number {
  if (!Number.isFinite(kj)) throw new RangeError('Energy must be finite');
  return kj / KJ_PER_KCAL;
}

/** PRD ONB-06 leaves thresholds and sources open. Composition must supply a documented policy. */
export const targetPolicySchema = z.strictObject({
  minimumKcal: z.number().finite().positive(),
  maxWeeklyRateKg: z.number().finite().positive(),
  kcalPerKg: z.number().finite().positive(),
  rationale: z.string().trim().min(1),
  source: z.string().trim().min(1),
});
export type TargetPolicy = z.infer<typeof targetPolicySchema>;
export const targetInputsSchema = z.strictObject({
  adultConfirmed: z.literal(true),
  ageYears: z.number().finite().min(18),
  weightKg: z.number().finite().positive(),
  heightCm: z.number().finite().positive(),
  /** Equation coefficient is explicitly selected, never inferred from identity. */
  equationCoefficient: z.union([z.literal(5), z.literal(-161)]),
  activityFactor: z.number().finite().min(1).max(3),
  activityAssumption: z.string().trim().min(1),
  mode: z.enum(['lose', 'maintain', 'gain', 'observe']),
  weeklyRateKg: z.number().finite().nonnegative(),
});
export type TargetInputs = z.infer<typeof targetInputsSchema>;
export interface TargetEstimate {
  targetKcal: number | null;
  bmrKcal: number;
  maintenanceKcal: number;
  appliedWeeklyRateKg: number;
  impliedWeeklyChangeKg: number;
  notices: string[];
  breakdown: {
    inputs: TargetInputs;
    equationSource: string;
    equation: string;
    weightTerm: number; heightTerm: number; ageTerm: number; coefficient: number;
    activityFactor: number; activityAssumption: string; dailyAdjustmentKcal: number;
    uncappedTargetKcal: number | null; policy: TargetPolicy;
  };
}

/** Rounded Mifflin–St Jeor equation: https://pubmed.ncbi.nlm.nih.gov/2305711/ */
export function estimateDailyTarget(input: TargetInputs, policyInput: TargetPolicy): TargetEstimate {
  const inputs = targetInputsSchema.parse(input);
  const policy = targetPolicySchema.parse(policyInput);
  const weightTerm = 10 * inputs.weightKg;
  const heightTerm = 6.25 * inputs.heightCm;
  const ageTerm = -5 * inputs.ageYears;
  const bmrKcal = weightTerm + heightTerm + ageTerm + inputs.equationCoefficient;
  const maintenanceKcal = bmrKcal * inputs.activityFactor;
  if (!Number.isFinite(maintenanceKcal) || maintenanceKcal <= 0) throw new RangeError('Inputs do not produce a positive energy estimate');
  const notices: string[] = [];
  const hasRate = inputs.mode === 'lose' || inputs.mode === 'gain';
  const appliedWeeklyRateKg = hasRate ? Math.min(inputs.weeklyRateKg, policy.maxWeeklyRateKg) : 0;
  if (hasRate && inputs.weeklyRateKg > policy.maxWeeklyRateKg) notices.push('The generated weekly rate was limited to the documented policy cap.');
  const direction = inputs.mode === 'lose' ? -1 : inputs.mode === 'gain' ? 1 : 0;
  const dailyAdjustmentKcal = direction * appliedWeeklyRateKg * policy.kcalPerKg / 7;
  const uncappedTargetKcal = inputs.mode === 'observe' ? null : maintenanceKcal + dailyAdjustmentKcal;
  const targetKcal = uncappedTargetKcal === null ? null : Math.max(policy.minimumKcal, uncappedTargetKcal);
  if (uncappedTargetKcal !== null && uncappedTargetKcal < policy.minimumKcal) notices.push('The generated target uses the documented minimum. A lower target requires manual entry.');
  const impliedWeeklyChangeKg = targetKcal === null ? 0 : (targetKcal - maintenanceKcal) * 7 / policy.kcalPerKg;
  // A conflicting floor and rate cap cannot both be honored by generating a target.
  if (targetKcal !== null && Math.abs(impliedWeeklyChangeKg) > policy.maxWeeklyRateKg + 1e-10) {
    throw new RangeError('The minimum target and weekly rate cap conflict for these inputs; review the policy or enter a target manually');
  }
  return {
    targetKcal, bmrKcal, maintenanceKcal, appliedWeeklyRateKg, impliedWeeklyChangeKg, notices,
    breakdown: {
      inputs,
      equationSource: 'https://pubmed.ncbi.nlm.nih.gov/2305711/',
      equation: 'BMR = 10 × weightKg + 6.25 × heightCm − 5 × ageYears + coefficient; maintenance = BMR × activityFactor; target = maintenance ± weeklyRateKg × kcalPerKg / 7',
      weightTerm, heightTerm, ageTerm, coefficient: inputs.equationCoefficient,
      activityFactor: inputs.activityFactor, activityAssumption: inputs.activityAssumption,
      dailyAdjustmentKcal, uncappedTargetKcal, policy,
    },
  };
}

/** Effective dates are local calendar dates, never UTC-converted instants. Duplicate dates are invalid. */
export function getActiveGoalForDate(periods: readonly GoalPeriod[], isoDate: string): GoalPeriod | null {
  isoDateSchema.parse(isoDate);
  const seen = new Set<string>();
  let active: GoalPeriod | null = null;
  for (const periodInput of periods) {
    const period = goalPeriodSchema.parse(periodInput);
    if (seen.has(period.effective_from_date)) throw new RangeError('Goal periods must have unique effective dates');
    seen.add(period.effective_from_date);
    if (period.effective_from_date <= isoDate && (active === null || period.effective_from_date > active.effective_from_date)) active = period;
  }
  return active;
}
