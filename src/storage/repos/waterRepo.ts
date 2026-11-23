import { isoDateSchema, waterLogSchema } from '../../domain';
import type { WaterLog } from '../../domain';
import type { SqlDatabase } from '../driver';

export class WaterRepo {
  constructor(private readonly db: SqlDatabase) {}

  async addWaterLog(input: WaterLog): Promise<WaterLog> {
    const log = waterLogSchema.parse(input);
    await this.db.runAsync('INSERT INTO water_logs(id,date,occurred_at,amount_ml) VALUES(?,?,?,?)',
      log.id, log.date, log.occurred_at, log.amount_ml);
    return log;
  }

  async deleteWaterLog(id: string): Promise<WaterLog | null> {
    return this.db.withTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<WaterLog>('SELECT * FROM water_logs WHERE id=?', id);
      const log = row ? waterLogSchema.parse(row) : null;
      await tx.runAsync('DELETE FROM water_logs WHERE id=?', id);
      return log;
    });
  }

  async listWaterLogs(date?: string): Promise<WaterLog[]> {
    if (date !== undefined) isoDateSchema.parse(date);
    const rows = await this.db.getAllAsync<WaterLog>(
      'SELECT * FROM water_logs WHERE (? IS NULL OR date=?) ORDER BY date,occurred_at,id', date ?? null, date ?? null);
    return rows.map((row) => waterLogSchema.parse(row));
  }

  async getDailyWaterMl(date: string): Promise<number> {
    isoDateSchema.parse(date);
    const row = await this.db.getFirstAsync<{ total: number }>(
      'SELECT COALESCE(SUM(amount_ml),0) AS total FROM water_logs WHERE date=?', date);
    return row!.total;
  }
}
export const createWaterRepo = (db: SqlDatabase) => new WaterRepo(db);
