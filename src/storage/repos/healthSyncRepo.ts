import { healthSyncRecordSchema } from '../../domain';
import type { HealthSyncRecord } from '../../domain';
import type { SqlDatabase } from '../driver';

export class HealthSyncRepo {
  constructor(private readonly db: SqlDatabase) {}

  async getRecord(entryId: string): Promise<HealthSyncRecord | null> {
    const row = await this.db.getFirstAsync<HealthSyncRecord>('SELECT * FROM health_sync_records WHERE entry_id=?', entryId);
    return row ? healthSyncRecordSchema.parse(row) : null;
  }

  async upsertRecord(input: HealthSyncRecord): Promise<void> {
    const record = healthSyncRecordSchema.parse(input);
    await this.db.runAsync(`INSERT INTO health_sync_records(entry_id,platform,external_record_id,synced_at,status) VALUES(?,?,?,?,?)
      ON CONFLICT(entry_id) DO UPDATE SET platform=excluded.platform,external_record_id=excluded.external_record_id,
      synced_at=excluded.synced_at,status=excluded.status`,
    record.entry_id, record.platform, record.external_record_id, record.synced_at, record.status);
  }

  async deleteRecord(entryId: string): Promise<void> {
    await this.db.runAsync('DELETE FROM health_sync_records WHERE entry_id=?', entryId);
  }

  async listRecords(platform?: HealthSyncRecord['platform']): Promise<HealthSyncRecord[]> {
    if (platform !== undefined) healthSyncRecordSchema.shape.platform.parse(platform);
    const rows = await this.db.getAllAsync<HealthSyncRecord>(
      'SELECT * FROM health_sync_records WHERE (? IS NULL OR platform=?) ORDER BY synced_at,entry_id', platform ?? null, platform ?? null);
    return rows.map((row) => healthSyncRecordSchema.parse(row));
  }
}
export const createHealthSyncRepo = (db: SqlDatabase) => new HealthSyncRepo(db);
