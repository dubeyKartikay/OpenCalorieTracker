import { diaryEntrySnapshotSchema, isoDateSchema } from '../../domain';
import type { DiaryDay, DiaryEntrySnapshot } from '../../domain';
import type { SqlDatabase } from '../driver';
import { foodKey, nowIso, parseJson } from './shared';

export class DiaryRepo {
  constructor(private readonly db: SqlDatabase) {}

  async getEntry(id: string): Promise<DiaryEntrySnapshot | null> {
    const row = await this.db.getFirstAsync<{ snapshot_json: string }>('SELECT snapshot_json FROM diary_entries WHERE id = ?', id);
    return row ? parseJson(row.snapshot_json, diaryEntrySnapshotSchema) : null;
  }
  private async findKey(key: string): Promise<DiaryEntrySnapshot | null> {
    const row = await this.db.getFirstAsync<{ snapshot_json: string }>('SELECT snapshot_json FROM diary_entries WHERE idempotency_key = ?', key);
    return row ? parseJson(row.snapshot_json, diaryEntrySnapshotSchema) : null;
  }
  /** Internal snapshot writer; does not learn portions or reinterpret nutrition. */
  async writeSnapshot(input: DiaryEntrySnapshot): Promise<void> {
    const entry = diaryEntrySnapshotSchema.parse(input);
    const now = nowIso();
    await this.db.runAsync(`INSERT INTO diary_entries VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET idempotency_key=excluded.idempotency_key,date=excluded.date,
      occurred_at=excluded.occurred_at,time_zone=excluded.time_zone,meal=excluded.meal,
      draft_state=excluded.draft_state,snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at`,
    entry.id, entry.idempotency_key, entry.date, entry.occurred_at, entry.time_zone, entry.meal,
    entry.draft_state, JSON.stringify(entry), now, now);
  }
  private async syncDayCompleteness(date: string): Promise<void> {
    const row = await this.db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM diary_entries WHERE date=? AND draft_state='confirmed'",
      date,
    );
    const status: DiaryDay['completeness'] = (row?.count ?? 0) > 0 ? 'complete' : 'none';
    await this.db.runAsync(
      'INSERT INTO diary_days VALUES(?,?,?) ON CONFLICT(date) DO UPDATE SET completeness=excluded.completeness,updated_at=excluded.updated_at',
      date,
      status,
      nowIso(),
    );
  }
  async upsertDraft(input: DiaryEntrySnapshot): Promise<DiaryEntrySnapshot> {
    const draft = diaryEntrySnapshotSchema.parse({ ...input, draft_state: 'draft' });
    return this.db.withTransactionAsync(async (tx) => {
      const repo = new DiaryRepo(tx);
      const existing = await repo.findKey(draft.idempotency_key) ?? await repo.getEntry(draft.id);
      if (existing?.draft_state === 'confirmed') return existing;
      const value = { ...draft, id: existing?.id ?? draft.id };
      await repo.writeSnapshot(value);
      await repo.syncDayCompleteness(value.date);
      return value;
    });
  }
  async confirmEntryWithStatus(input: DiaryEntrySnapshot | string): Promise<{ entry: DiaryEntrySnapshot; changed: boolean }> {
    return this.db.withTransactionAsync(async (tx) => {
      const repo = new DiaryRepo(tx);
      const candidate = typeof input === 'string' ? await repo.getEntry(input) : input;
      if (!candidate) throw new Error('Diary draft not found');
      const parsed = diaryEntrySnapshotSchema.parse(candidate);
      const byKey = await repo.findKey(parsed.idempotency_key);
      if (byKey?.draft_state === 'confirmed') {
        return { entry: byKey, changed: false };
      }
      const byId = await repo.getEntry(parsed.id);
      if (byId && byId.idempotency_key !== parsed.idempotency_key) throw new Error('Diary id already belongs to a different operation');
      const entry = { ...parsed, id: byKey?.id ?? parsed.id, draft_state: 'confirmed' as const };
      await repo.writeSnapshot(entry);
      await repo.syncDayCompleteness(entry.date);
      await tx.runAsync(`INSERT INTO learned_portions(food_key,unit,amount,last_used_at) VALUES(?,?,?,?)
        ON CONFLICT(food_key,unit,amount) DO UPDATE SET use_count=use_count+1,last_used_at=excluded.last_used_at`,
      foodKey(entry.food), entry.quantity.unit, entry.quantity.amount, nowIso());
      return { entry, changed: true };
    });
  }
  async confirmEntry(input: DiaryEntrySnapshot | string): Promise<DiaryEntrySnapshot> {
    return (await this.confirmEntryWithStatus(input)).entry;
  }
  async updateEntry(input: DiaryEntrySnapshot): Promise<DiaryEntrySnapshot> {
    const entry = diaryEntrySnapshotSchema.parse(input);
    return this.db.withTransactionAsync(async (tx) => {
      const repo = new DiaryRepo(tx);
      const previous = await repo.getEntry(entry.id);
      if (!previous) throw new Error('Diary entry not found');
      await repo.writeSnapshot(entry);
      await repo.syncDayCompleteness(entry.date);
      if (previous.date !== entry.date) {
        await repo.syncDayCompleteness(previous.date);
      }
      return entry;
    });
  }
  async deleteEntry(id: string): Promise<DiaryEntrySnapshot | null> {
    return this.db.withTransactionAsync(async (tx) => {
      const repo = new DiaryRepo(tx);
      const entry = await repo.getEntry(id);
      await tx.runAsync('DELETE FROM diary_entries WHERE id=?', id);
      if (entry) await repo.syncDayCompleteness(entry.date);
      return entry;
    });
  }
  async restoreEntry(input: DiaryEntrySnapshot): Promise<DiaryEntrySnapshot> {
    const entry = diaryEntrySnapshotSchema.parse(input);
    return this.db.withTransactionAsync(async (tx) => {
      const repo = new DiaryRepo(tx);
      const existing = await repo.findKey(entry.idempotency_key) ?? await repo.getEntry(entry.id);
      if (existing) return existing;
      await repo.writeSnapshot(entry);
      await repo.syncDayCompleteness(entry.date);
      return entry;
    });
  }
  async moveEntry(id: string, date: string, meal?: string): Promise<DiaryEntrySnapshot> {
    isoDateSchema.parse(date);
    return this.db.withTransactionAsync(async (tx) => {
      const repo = new DiaryRepo(tx);
      const entry = await repo.getEntry(id);
      if (!entry) throw new Error('Diary entry not found');
      const occurred_at = date !== entry.date ? new Date(`${date}T12:00:00`).toISOString() : entry.occurred_at;
      return repo.updateEntry({ ...entry, date, occurred_at, meal: meal ?? entry.meal });
    });
  }
  async setDayCompleteness(date: string, completeness: DiaryDay['completeness']): Promise<void> {
    isoDateSchema.parse(date);
    if (!['none', 'partial', 'complete'].includes(completeness)) throw new Error('Invalid day completeness');
    await this.db.runAsync('INSERT INTO diary_days VALUES(?,?,?) ON CONFLICT(date) DO UPDATE SET completeness=excluded.completeness,updated_at=excluded.updated_at', date, completeness, nowIso());
  }
  async getDiaryDay(date: string): Promise<DiaryDay | null> {
    isoDateSchema.parse(date);
    return this.db.withTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<{ completeness: DiaryDay['completeness'] }>('SELECT completeness FROM diary_days WHERE date=?', date);
      if (!row) return null;
      const entries = (await tx.getAllAsync<{ snapshot_json: string }>('SELECT snapshot_json FROM diary_entries WHERE date=? ORDER BY occurred_at,id', date))
        .map((item) => parseJson(item.snapshot_json, diaryEntrySnapshotSchema));
      const completeness: DiaryDay['completeness'] = entries.some((entry) => entry.draft_state === 'confirmed') ? 'complete' : 'none';
      return { date, completeness, entries };
    });
  }
  async listDiaryDays(from?: string, to?: string): Promise<DiaryDay[]> {
    if (from) isoDateSchema.parse(from);
    if (to) isoDateSchema.parse(to);
    return this.db.withTransactionAsync(async (tx) => {
      const dayRows = await tx.getAllAsync<{ date: string; completeness: DiaryDay['completeness'] }>(
        'SELECT date, completeness FROM diary_days WHERE (? IS NULL OR date>=?) AND (? IS NULL OR date<=?) ORDER BY date',
        from ?? null, from ?? null, to ?? null, to ?? null,
      );
      if (dayRows.length === 0) return [];
      const entryRows = await tx.getAllAsync<{ date: string; snapshot_json: string }>(
        'SELECT date, snapshot_json FROM diary_entries WHERE (? IS NULL OR date>=?) AND (? IS NULL OR date<=?) ORDER BY date, occurred_at, id',
        from ?? null, from ?? null, to ?? null, to ?? null,
      );
      const byDate = new Map<string, DiaryEntrySnapshot[]>();
      for (const row of entryRows) {
        const entry = parseJson(row.snapshot_json, diaryEntrySnapshotSchema);
        const list = byDate.get(row.date);
        if (list) list.push(entry);
        else byDate.set(row.date, [entry]);
      }
      return dayRows.map((row) => {
        const entries = byDate.get(row.date) ?? [];
        const completeness: DiaryDay['completeness'] = entries.some((entry) => entry.draft_state === 'confirmed') ? 'complete' : 'none';
        return {
          date: row.date,
          completeness,
          entries,
        };
      });
    });
  }
}
export const createDiaryRepo = (db: SqlDatabase) => new DiaryRepo(db);
