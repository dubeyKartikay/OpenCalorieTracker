import { Asset } from 'expo-asset';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { openDatabaseAsync } from 'expo-sqlite';
import { FoodSourceRegistry } from '../catalog';
import { createExpoSqliteDriver, DiaryRepo, GoalsRepo, HealthSyncRepo, LibraryRepo, migrateDatabase, PacksRepo, PhotoDraftRepo, WaterRepo } from '../storage';
import { createNativeHealthPort } from '../../modules/oct-health';
import { createNativeLoopbackAuthPort } from '../../modules/oct-oauth-loopback';
import { generateId } from '../domain';
import { initOffCache } from '../barcode';
import { createCredentialStore } from './credentials.native';
import { AppController } from './controller';
import type { AppRuntime } from './runtime';
import usda from '../../assets/packs/usda-fdc-starter.octpack.sqlite';
import custom from '../../assets/packs/custom-home-pack.octpack.sqlite';

const bundled = {
  usda,
  custom,
};
async function openPack(uri: string) {
  if (!(await FileSystem.getInfoAsync(uri)).exists) throw new Error('Pack file is missing. Import it again.');
  const split = uri.lastIndexOf('/');
  const db = createExpoSqliteDriver(await openDatabaseAsync(uri.slice(split + 1), { useNewConnection: true }, uri.slice(0, split)));
  // Expo exposes no SQLITE_OPEN_READONLY flag. Enforce read-only SQL on each dedicated connection.
  try { await db.execAsync('PRAGMA query_only = ON'); return db; }
  catch (error) { await db.closeAsync(); throw error; }
}
export async function bootstrap(): Promise<AppRuntime> {
  if (!FileSystem.documentDirectory) throw new Error('The app document directory is unavailable.');
  const dir = `${FileSystem.documentDirectory}packs/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const userDb = createExpoSqliteDriver(await openDatabaseAsync('user.db', { useNewConnection: true }));
  await userDb.execAsync('PRAGMA busy_timeout = 5000');
  const notices: string[] = [];
  let offCacheDb: ReturnType<typeof createExpoSqliteDriver> | null = null;
  let controller: AppController | null = null;
  try {
    await migrateDatabase(userDb);
    offCacheDb = createExpoSqliteDriver(await openDatabaseAsync('off_cache.sqlite', { useNewConnection: true }));
    await offCacheDb.execAsync('PRAGMA busy_timeout = 5000');
    await initOffCache(offCacheDb);
    const packs = new PacksRepo(userDb);
    const app = new AppController({ userDb, offCacheDb, credentials: createCredentialStore(), catalog: new FoodSourceRegistry(userDb),
      diary: new DiaryRepo(userDb), library: new LibraryRepo(userDb), goals: new GoalsRepo(userDb), packs,
      water: new WaterRepo(userDb), healthSync: new HealthSyncRepo(userDb), photoDrafts: new PhotoDraftRepo(userDb),
      healthPort: createNativeHealthPort(Platform.OS),
      loopbackAuth: createNativeLoopbackAuthPort() });
    controller = app;
    const importPackFromFile = async (uri: string, priority = 50) => {
      const target = `${dir}${generateId()}.octpack.sqlite`;
      await FileSystem.copyAsync({ from: uri, to: target });
      try { await app.installPack(await openPack(target), target, priority); }
      catch (error) { await FileSystem.deleteAsync(target, { idempotent: true }); throw error; }
    };
    const installAsset = async (module: number, priority: number) => {
      const asset = await Asset.fromModule(module).downloadAsync();
      if (!asset.localUri) throw new Error('Bundled food pack could not be loaded');
      await importPackFromFile(asset.localUri, priority);
    };
    const installed = await packs.listInstalledPacks();
    for (const pack of installed) {
      if (!pack.file_path) continue;
      try {
        await app.installPack(await openPack(pack.file_path), pack.file_path, pack.priority);
        await app.setPackEnabled(pack.pack_id, pack.enabled);
      } catch (error) { notices.push(`${pack.meta.name}: ${error instanceof Error ? error.message : 'Could not open pack'}`); }
    }
    if (!installed.some(pack => pack.pack_id === 'usda-fdc-starter')) await installAsset(bundled.usda, 100);
    return { controller: app, notices, importPackFromFile,
      importSampleCustomPack: () => installAsset(bundled.custom, 50),
      readTextFile: uri => FileSystem.readAsStringAsync(uri),
      saveBackup: async (contents, filename = 'open-calorie-tracker-backup-v1.json') => {
        const path = `${FileSystem.documentDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(path, contents); return path;
      } };
  } catch (error) {
    if (controller) await controller.close(); else { await offCacheDb?.closeAsync(); await userDb.closeAsync(); }
    throw error;
  }
}
