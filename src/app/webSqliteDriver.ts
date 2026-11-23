import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
// @ts-expect-error Metro resolves the binary asset, which has no TypeScript declaration.
import sqliteWasm from '@sqlite.org/sqlite-wasm/sqlite3.wasm';
import { Asset } from 'expo-asset';
import { serializeDatabase } from '../storage/driver';
import type { SqlDatabase, SqlValue } from '../storage/driver';

let sqliteReady: Promise<Sqlite3Static> | undefined;
async function sqlite() {
  if (!sqliteReady) sqliteReady = (async () => {
    // Metro emits the actual WASM asset; no OPFS worker or cross-origin isolation is needed.
    const asset = Asset.fromModule(sqliteWasm);
    await asset.downloadAsync();
    // The package's declaration omits Emscripten's supported module options.
    const initialize = sqlite3InitModule as (options: { locateFile: () => string }) => Promise<Sqlite3Static>;
    return initialize({ locateFile: () => asset.localUri ?? asset.uri });
  })().catch(error => { sqliteReady = undefined; throw error; });
  return sqliteReady;
}

let storageReady: Promise<IDBDatabase> | undefined;
async function storage() {
  if (!storageReady) storageReady = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('oct-web-storage', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('databases'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open browser storage'));
  }).catch(error => { storageReady = undefined; throw error; });
  return storageReady;
}
export async function readWebDatabase(name: string): Promise<Uint8Array | null> {
  const db = await storage();
  return new Promise((resolve, reject) => {
    const request = db.transaction('databases', 'readonly').objectStore('databases').get(name);
    request.onsuccess = () => resolve(request.result ? new Uint8Array(request.result as ArrayBuffer) : null);
    request.onerror = () => reject(request.error);
  });
}
export async function writeWebDatabase(name: string, bytes: Uint8Array): Promise<void> {
  const db = await storage();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('databases', 'readwrite');
    tx.objectStore('databases').put(bytes.slice().buffer, name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not save browser storage'));
    tx.onabort = () => reject(tx.error ?? new Error('Browser storage write was aborted'));
  });
}

/** An ordinary in-memory SQLite database, optionally restored/persisted as an IndexedDB blob. */
export async function createWebSqliteDriver(options: { name?: string; bytes?: Uint8Array; readOnly?: boolean } = {}): Promise<SqlDatabase> {
  const sqlite3 = await sqlite();
  const bytes = options.bytes ?? (options.name ? await readWebDatabase(options.name) : null);
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  try {
    if (bytes) {
      const data = sqlite3.wasm.allocFromTypedArray(bytes);
      const flags = sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE
        | (options.readOnly ? sqlite3.capi.SQLITE_DESERIALIZE_READONLY : sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE);
      const result = sqlite3.capi.sqlite3_deserialize(db.pointer!, 'main', data, bytes.byteLength, bytes.byteLength, flags);
      if (result !== sqlite3.capi.SQLITE_OK) { sqlite3.wasm.dealloc(data); throw new Error(`Could not load SQLite database (${result})`); }
    }
    // Imported databases can carry WAL mode even though this connection has no WAL file.
    if (!options.readOnly) db.exec('PRAGMA journal_mode = MEMORY; PRAGMA foreign_keys = ON');
    else db.exec('PRAGMA query_only = ON');
    let dirty = false;
    const persist = async () => {
      if (!options.name || options.readOnly || !dirty || !sqlite3.capi.sqlite3_get_autocommit(db.pointer!)) return;
      await writeWebDatabase(options.name, sqlite3.capi.sqlite3_js_db_export(db.pointer!)); dirty = false;
    };
    const rows = <T>(sql: string, params: SqlValue[]) => db.exec({ sql, bind: params, rowMode: 'object', returnValue: 'resultRows' }) as T[];
    return serializeDatabase({
      async execAsync(sql) {
        db.exec(sql);
        if (!/^\s*(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(sql)) dirty = true;
        await persist();
      },
      async runAsync(sql, ...params) {
        db.exec({ sql, bind: params }); dirty = true;
        const result = { changes: db.changes(), lastInsertRowId: Number(db.selectValue('SELECT last_insert_rowid()')) };
        await persist(); return result;
      },
      async getAllAsync<T>(sql: string, ...params: SqlValue[]) { return rows<T>(sql, params); },
      async getFirstAsync<T>(sql: string, ...params: SqlValue[]) { return rows<T>(sql, params)[0] ?? null; },
      async closeAsync() { try { await persist(); } finally { db.close(); } },
    });
  } catch (error) { db.close(); throw error; }
}
