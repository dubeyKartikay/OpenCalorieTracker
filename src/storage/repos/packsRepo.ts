import { packMetaSchema } from '../../domain';
import type { PackMeta } from '../../domain';
import type { SqlDatabase } from '../driver';
import { nowIso, parseJson } from './shared';

export interface InstalledPack { pack_id: string; file_path: string; enabled: boolean; priority: number; meta: PackMeta; installed_at: string }
export class PacksRepo {
  constructor(private readonly db: SqlDatabase) {}
  async registerPack(metaInput: PackMeta, filePath: string, options: { enabled?: boolean; priority?: number } = {}): Promise<void> {
    const meta = packMetaSchema.parse(metaInput);
    const priority = options.priority ?? 100;
    if (!Number.isFinite(priority)) throw new Error('Pack priority must be finite');
    await this.db.runAsync(`INSERT INTO installed_packs VALUES(?,?,?,?,?,?) ON CONFLICT(pack_id) DO UPDATE SET
      file_path=excluded.file_path,enabled=excluded.enabled,priority=excluded.priority,meta_json=excluded.meta_json`, meta.pack_id, filePath, Number(options.enabled ?? true), priority, JSON.stringify(meta), nowIso());
  }
  async listInstalledPacks(): Promise<InstalledPack[]> {
    const rows = await this.db.getAllAsync<{ pack_id: string; file_path: string; enabled: number; priority: number; meta_json: string; installed_at: string }>('SELECT * FROM installed_packs ORDER BY priority,pack_id');
    return rows.map(({ meta_json, enabled, ...row }) => ({ ...row, enabled: Boolean(enabled), meta: parseJson(meta_json, packMetaSchema) }));
  }
  async setPackEnabled(id: string, enabled: boolean): Promise<void> { await this.db.runAsync('UPDATE installed_packs SET enabled=? WHERE pack_id=?', Number(enabled), id); }
  async setPackPriority(id: string, priority: number): Promise<void> {
    if (!Number.isFinite(priority)) throw new Error('Pack priority must be finite');
    await this.db.runAsync('UPDATE installed_packs SET priority=? WHERE pack_id=?', priority, id);
  }
  async removePack(id: string): Promise<void> { await this.db.runAsync('DELETE FROM installed_packs WHERE pack_id=?', id); }
}
export const createPacksRepo = (db: SqlDatabase) => new PacksRepo(db);
