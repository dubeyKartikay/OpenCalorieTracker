import { offlinePhotoDraftSchema } from '../../domain';
import type { OfflinePhotoDraft } from '../../domain';
import type { SqlDatabase } from '../driver';

export class PhotoDraftRepo {
  constructor(private readonly db: SqlDatabase) {}

  async saveDraft(input: OfflinePhotoDraft): Promise<OfflinePhotoDraft> {
    const draft = offlinePhotoDraftSchema.parse(input);
    await this.db.runAsync(`INSERT INTO offline_photo_drafts(id,date,meal,note,image_data_url,created_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET date=excluded.date,meal=excluded.meal,note=excluded.note,
      image_data_url=excluded.image_data_url,created_at=excluded.created_at`,
    draft.id, draft.date, draft.meal, draft.note, draft.image_data_url, draft.created_at);
    return draft;
  }

  async getDraft(id: string): Promise<OfflinePhotoDraft | null> {
    const row = await this.db.getFirstAsync<OfflinePhotoDraft>('SELECT * FROM offline_photo_drafts WHERE id=?', id);
    return row ? offlinePhotoDraftSchema.parse(row) : null;
  }

  async listDrafts(): Promise<OfflinePhotoDraft[]> {
    const rows = await this.db.getAllAsync<OfflinePhotoDraft>('SELECT * FROM offline_photo_drafts ORDER BY created_at DESC,id');
    return rows.map((row) => offlinePhotoDraftSchema.parse(row));
  }

  async deleteDraft(id: string): Promise<OfflinePhotoDraft | null> {
    return this.db.withTransactionAsync(async (tx) => {
      const draft = await new PhotoDraftRepo(tx).getDraft(id);
      await tx.runAsync('DELETE FROM offline_photo_drafts WHERE id=?', id);
      return draft;
    });
  }
}
export const createPhotoDraftRepo = (db: SqlDatabase) => new PhotoDraftRepo(db);
