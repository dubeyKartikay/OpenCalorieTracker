import type { AppRuntime } from './runtime';
import { Asset } from 'expo-asset';
import { FoodSourceRegistry } from '../catalog';
import { DiaryRepo, GoalsRepo, LibraryRepo, migrateDatabase, PacksRepo } from '../storage';
import { initOffCache } from '../barcode';
import { generateId } from '../domain';
import { AppController } from './controller';
import { createCredentialStore } from './credentials';
import { createWebSqliteDriver, readWebDatabase, writeWebDatabase } from './webSqliteDriver';
import usda from '../../assets/packs/usda-fdc-starter.octpack.sqlite';
import custom from '../../assets/packs/custom-home-pack.octpack.sqlite';

async function fetchBytes(uri: string) {
  const response = await fetch(uri); if (!response.ok) throw new Error('Food pack could not be loaded');
  return new Uint8Array(await response.arrayBuffer());
}
/** Metro selects bootstrap.native on devices; browsers use SQLite WASM with FTS5. */
export async function bootstrap(): Promise<AppRuntime> {
  const userDb = await createWebSqliteDriver({ name: 'user.db' });
  let offCacheDb: Awaited<ReturnType<typeof createWebSqliteDriver>> | null = null;
  let app: AppController | null = null;
  try {
    await migrateDatabase(userDb);
    offCacheDb = await createWebSqliteDriver({ name: 'off_cache.sqlite' }); await initOffCache(offCacheDb);
    const packs = new PacksRepo(userDb);
    app = new AppController({ userDb, offCacheDb, credentials: createCredentialStore(), catalog: new FoodSourceRegistry(userDb),
      diary: new DiaryRepo(userDb), library: new LibraryRepo(userDb), goals: new GoalsRepo(userDb), packs });
    const controller = app;
    const notices: string[] = [];
    const installBytes = async (bytes: Uint8Array, path: string, priority: number) => {
      const handle = await createWebSqliteDriver({ bytes, readOnly: true });
      await controller.installPack(handle, path, priority);
    };
    const importPackFromFile = async (uri: string) => {
      const bytes = await fetchBytes(uri); const path = `pack:${generateId()}`;
      // Store the immutable source too: a selected blob URL will not survive reload.
      await writeWebDatabase(path, bytes); await installBytes(bytes, path, 50);
    };
    const installAsset = async (module: number, path: string, priority: number) => {
      const asset = await Asset.fromModule(module).downloadAsync();
      await installBytes(await fetchBytes(asset.localUri ?? asset.uri), path, priority);
    };
    const installed = await packs.listInstalledPacks();
    let usdaMounted = false;
    for (const pack of installed) {
      try {
        if (pack.file_path === 'bundled:usda') await installAsset(usda, pack.file_path, pack.priority);
        else if (pack.file_path === 'bundled:custom') await installAsset(custom, pack.file_path, pack.priority);
        else {
          const bytes = pack.file_path ? await readWebDatabase(pack.file_path) : null;
          if (!bytes) throw new Error('Pack file is missing. Import it again.');
          await installBytes(bytes, pack.file_path!, pack.priority);
        }
        await controller.setPackEnabled(pack.pack_id, pack.enabled);
        if (pack.pack_id === 'usda-fdc-starter') usdaMounted = true;
      } catch (error) { notices.push(`${pack.meta.name}: ${error instanceof Error ? error.message : 'Could not open pack'}`); }
    }
    if (!usdaMounted) await installAsset(usda, 'bundled:usda', 100);
    return { controller, notices, importPackFromFile,
      importSampleCustomPack: () => installAsset(custom, 'bundled:custom', 50),
      readTextFile: async uri => { const response = await fetch(uri); if (!response.ok) throw new Error('Backup could not be read'); return response.text(); },
      saveBackup: async json => {
        const label = `open-calorie-tracker-${Date.now()}.json`;
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        try { const link = document.createElement('a'); link.href = url; link.download = label; document.body.appendChild(link); link.click(); link.remove(); }
        finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
        return label;
      } };
  } catch (error) {
    if (app) await app.close(); else { await offCacheDb?.closeAsync(); await userDb.closeAsync(); }
    throw error;
  }
}
