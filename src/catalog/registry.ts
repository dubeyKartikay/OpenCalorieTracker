import { normalizeBarcode } from '../domain';
import type { FoodRecord, PackMeta } from '../domain';
import type { SqlDatabase } from '../storage/driver';
import { LibraryRepo } from '../storage/repos/libraryRepo';
import { PacksRepo } from '../storage/repos/packsRepo';
import { foodKey } from '../storage/repos/shared';
import { mergeFoodUnits, rankCandidates } from './ranker';
import { SqlitePackAdapter } from './sqlitePackAdapter';
import type { SearchCandidate, SearchOptions } from './types';
import { UserLibraryAdapter } from './userLibraryAdapter';

export interface MountedPack { packId: string; meta: PackMeta; priority: number; enabled: boolean }
export class FoodSourceRegistry {
  readonly userLibrary: UserLibraryAdapter;
  private readonly packs = new Map<string, { adapter: SqlitePackAdapter; meta: PackMeta; enabled: boolean }>();
  private readonly library: LibraryRepo;
  private readonly installed: PacksRepo;
  constructor(userDb: SqlDatabase) {
    this.userLibrary = new UserLibraryAdapter(userDb);
    this.library = new LibraryRepo(userDb);
    this.installed = new PacksRepo(userDb);
  }
  /** Takes ownership of a separately opened read-only handle after validation succeeds. */
  async mountPack(packId: string, db: SqlDatabase, priority = 100): Promise<void> {
    if (!Number.isFinite(priority)) throw new Error('Pack priority must be finite');
    if (this.packs.has(packId)) throw new Error(`Pack already mounted: ${packId}`);
    const adapter = await SqlitePackAdapter.create(db, priority);
    const meta = await adapter.getMeta();
    if (meta.pack_id !== packId) throw new Error('Pack id does not match its metadata');
    this.packs.set(packId, { adapter, meta, enabled: true });
  }
  async unmountPack(packId: string): Promise<void> {
    const pack = this.packs.get(packId);
    if (pack) {
      this.packs.delete(packId);
      await pack.adapter.close();
    }
  }
  async setPackEnabled(packId: string, enabled: boolean): Promise<void> {
    const pack = this.packs.get(packId);
    if (!pack) throw new Error(`Pack is not mounted: ${packId}`);
    await this.installed.setPackEnabled(packId, enabled);
    pack.enabled = enabled;
  }
  async setPackPriority(packId: string, priority: number): Promise<void> {
    if (!Number.isFinite(priority)) throw new Error('Pack priority must be finite');
    const pack = this.packs.get(packId);
    if (!pack) throw new Error(`Pack is not mounted: ${packId}`);
    await this.installed.setPackPriority(packId, priority);
    pack.adapter.priority = priority;
  }
  listMountedPacks(): MountedPack[] {
    return [...this.packs].map(([packId, pack]) => ({ packId, meta: { ...pack.meta }, enabled: pack.enabled, priority: pack.adapter.priority }))
      .sort((a, b) => a.priority - b.priority || a.packId.localeCompare(b.packId));
  }
  private async personalUnits(food: FoodRecord): Promise<FoodRecord> {
    return { ...food, units: mergeFoodUnits(food.units, await this.library.listUserFoodUnits(foodKey(food))) };
  }
  async search(query: string, options: SearchOptions = {}): Promise<{ yours: SearchCandidate[]; database: SearchCandidate[] }> {
    const sources = [this.userLibrary, ...[...this.packs.values()].filter((pack) => pack.enabled).map((pack) => pack.adapter)];
    const results = (await Promise.all(sources.map((source) => source.search(query, options)))).flat();
    const databaseFoods = results.filter((candidate) => candidate.bucket === 'database').map((candidate) => candidate.food);
    const unitsByKey = await this.library.listUserFoodUnitsForKeys(databaseFoods.map((food) => foodKey(food)));
    const merged = results.map((candidate) => {
      if (candidate.bucket === 'yours') return candidate;
      const personal = unitsByKey.get(foodKey(candidate.food));
      if (!personal?.length) return candidate;
      return { ...candidate, food: { ...candidate.food, units: mergeFoodUnits(candidate.food.units, personal) } };
    });
    const ranked = rankCandidates(merged, query, options.preferredPrepState);
    const limit = options.limit ?? 50;
    return { yours: ranked.filter((candidate) => candidate.bucket === 'yours').slice(0, limit), database: ranked.filter((candidate) => candidate.bucket === 'database').slice(0, limit) };
  }
  async lookupBarcode(rawCode: string, symbology?: string): Promise<FoodRecord | null> {
    const code = normalizeBarcode(rawCode, symbology);
    const custom = await this.userLibrary.lookupBarcode(code);
    if (custom) return custom;
    const packs = [...this.packs.values()].filter((pack) => pack.enabled).sort((a, b) => a.adapter.priority - b.adapter.priority || a.adapter.sourceId.localeCompare(b.adapter.sourceId));
    for (const pack of packs) {
      const food = await pack.adapter.lookupBarcode(code);
      if (food) return this.personalUnits(food);
    }
    return null;
  }
  async getById(packId: string | null, foodId: string): Promise<FoodRecord | null> {
    if (packId === null || packId === this.userLibrary.sourceId) return this.userLibrary.getById(foodId);
    const pack = this.packs.get(packId);
    if (!pack?.enabled) return null;
    const food = await pack.adapter.getById(foodId);
    return food ? this.personalUnits(food) : null;
  }
  async close(): Promise<void> { for (const id of [...this.packs.keys()]) await this.unmountPack(id); }
}
