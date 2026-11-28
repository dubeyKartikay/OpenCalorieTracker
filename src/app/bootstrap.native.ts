import { Asset } from 'expo-asset';
import * as Crypto from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';
import { Platform, Share } from 'react-native';
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
    const resolveBundledPack = async (packId: string) => {
      const module = packId === 'usda-fdc-starter'
        ? bundled.usda
        : packId === 'custom-home-pack'
          ? bundled.custom
          : null;
      if (!module) return null;
      const asset = await Asset.fromModule(module).downloadAsync();
      if (!asset.localUri) throw new Error('Bundled food pack could not be loaded');
      const target = `${dir}${generateId()}.octpack.sqlite`;
      await FileSystem.copyAsync({ from: asset.localUri, to: target });
      try {
        const db = await openPack(target);
        return { db, filePath: target };
      } catch (error) {
        await FileSystem.deleteAsync(target, { idempotent: true });
        throw error;
      }
    };
    const packs = new PacksRepo(userDb);
    const app = new AppController({ userDb, offCacheDb, credentials: createCredentialStore(), catalog: new FoodSourceRegistry(userDb),
      diary: new DiaryRepo(userDb), library: new LibraryRepo(userDb), goals: new GoalsRepo(userDb), packs,
      water: new WaterRepo(userDb), healthSync: new HealthSyncRepo(userDb), photoDrafts: new PhotoDraftRepo(userDb),
      healthPort: createNativeHealthPort(Platform.OS),
      loopbackAuth: createNativeLoopbackAuthPort(),
      pkceCrypto: {
        getRandomBytes: count => Crypto.getRandomBytesAsync(count),
        sha256: async data => new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data as BufferSource)),
      },
      aiFetch: expoFetch as unknown as typeof globalThis.fetch,
      resolveBundledPack });
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
    let usdaMounted = false;
    for (const pack of installed) {
      if (!pack.file_path) {
        const bundledPack = await resolveBundledPack(pack.pack_id).catch(() => null);
        if (!bundledPack) continue;
        try {
          await app.installPack(bundledPack.db, bundledPack.filePath, pack.priority);
          await app.setPackEnabled(pack.pack_id, pack.enabled);
          if (pack.pack_id === 'usda-fdc-starter') usdaMounted = true;
        } catch (error) {
          await FileSystem.deleteAsync(bundledPack.filePath, { idempotent: true });
          notices.push(`${pack.meta.name}: ${error instanceof Error ? error.message : 'Could not open pack'}`);
        }
        continue;
      }
      try {
        await app.installPack(await openPack(pack.file_path), pack.file_path, pack.priority);
        await app.setPackEnabled(pack.pack_id, pack.enabled);
        if (pack.pack_id === 'usda-fdc-starter') usdaMounted = true;
      } catch (error) { notices.push(`${pack.meta.name}: ${error instanceof Error ? error.message : 'Could not open pack'}`); }
    }
    if (!usdaMounted) await installAsset(bundled.usda, 100);
    return { controller: app, notices, importPackFromFile,
      importSampleCustomPack: () => installAsset(bundled.custom, 50),
      readTextFile: uri => FileSystem.readAsStringAsync(uri),
      saveBackup: async (contents, filename = 'open-calorie-tracker-backup-v1.json') => {
        const path = `${FileSystem.documentDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(path, contents); return path;
      },
      shareBackup: async (contents, filename, savedPath) => {
        if (Platform.OS === 'android' && FileSystem.StorageAccessFramework?.requestDirectoryPermissionsAsync) {
          const perms = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
          if (!perms.granted) return null;
          const mimeType = filename.toLowerCase().endsWith('.csv') ? 'text/csv' : 'application/json';
          const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(perms.directoryUri, filename, mimeType);
          await FileSystem.writeAsStringAsync(fileUri, contents);
          return fileUri;
        }
        const shared = await Share.share({
          title: filename,
          message: Platform.OS === 'ios' ? filename : contents,
          ...(Platform.OS === 'ios' && savedPath ? { url: savedPath } : {}),
        });
        if (shared.action === Share.dismissedAction) return null;
        return savedPath ?? filename;
      },
      clearSandboxExports: async () => {
        if (!FileSystem.documentDirectory) return;
        const entries = await FileSystem.readDirectoryAsync(FileSystem.documentDirectory).catch(() => []);
        const exportFiles = entries.filter(name => /^open-calorie-tracker-.*\.(?:json|csv)$/i.test(name));
        await Promise.all(
          exportFiles.map(name => FileSystem.deleteAsync(`${FileSystem.documentDirectory}${name}`, { idempotent: true })),
        );
      } };
  } catch (error) {
    if (controller) await controller.close(); else { await offCacheDb?.closeAsync(); await userDb.closeAsync(); }
    throw error;
  }
}
