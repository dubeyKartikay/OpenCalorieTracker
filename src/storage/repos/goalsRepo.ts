import { goalPeriodSchema, isoDateSchema, weighInSchema } from '../../domain';
import type { GoalPeriod, WeighIn } from '../../domain';
import type { SqlDatabase } from '../driver';
import { parseJson } from './shared';

export class GoalsRepo {
  constructor(private readonly db: SqlDatabase) {}
  async upsertGoalPeriod(input: GoalPeriod): Promise<GoalPeriod> {
    const goal = goalPeriodSchema.parse(input);
    await this.db.runAsync('INSERT INTO goal_periods VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET effective_from_date=excluded.effective_from_date,goal_json=excluded.goal_json', goal.id, goal.effective_from_date, JSON.stringify(goal));
    return goal;
  }
  async listGoalPeriods(): Promise<GoalPeriod[]> {
    return (await this.db.getAllAsync<{ goal_json: string }>('SELECT goal_json FROM goal_periods ORDER BY effective_from_date,id')).map((row) => parseJson(row.goal_json, goalPeriodSchema));
  }
  async recordWeighIn(input: WeighIn): Promise<WeighIn> {
    const entry = weighInSchema.parse(input);
    return this.db.withTransactionAsync(async (tx) => {
      if (entry.source === 'health') {
        const old = await tx.getFirstAsync<{ weigh_in_json: string }>('SELECT weigh_in_json FROM weigh_ins WHERE external_source_id=?', entry.external_source_id);
        if (old) return parseJson(old.weigh_in_json, weighInSchema);
      }
      await tx.runAsync('INSERT INTO weigh_ins VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,measured_at=excluded.measured_at,source=excluded.source,external_source_id=excluded.external_source_id,weigh_in_json=excluded.weigh_in_json', entry.id, entry.date, entry.measured_at, entry.source, entry.external_source_id, JSON.stringify(entry));
      return entry;
    });
  }
  async listWeighIns(from?: string, to?: string): Promise<WeighIn[]> {
    if (from) isoDateSchema.parse(from);
    if (to) isoDateSchema.parse(to);
    return (await this.db.getAllAsync<{ weigh_in_json: string }>('SELECT weigh_in_json FROM weigh_ins WHERE (? IS NULL OR date>=?) AND (? IS NULL OR date<=?) ORDER BY measured_at,id', from ?? null, from ?? null, to ?? null, to ?? null)).map((row) => parseJson(row.weigh_in_json, weighInSchema));
  }
}
export const createGoalsRepo = (db: SqlDatabase) => new GoalsRepo(db);
