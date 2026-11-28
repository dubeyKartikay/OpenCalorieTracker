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
function revKey(name: string): string {
  return `${name}:rev`;
}

function encodeRev(rev: number): ArrayBuffer {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, rev);
  return buf;
}

function decodeRev(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (raw instanceof ArrayBuffer && raw.byteLength === 8) {
    const val = new DataView(raw).getFloat64(0);
    return Number.isFinite(val) ? val : 0;
  }
  return 0;
}

async function withWebStorageLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as { locks?: { request<R>(key: string, fn: () => Promise<R>): Promise<R> } }).locks : undefined;
  if (locks?.request) {
    return locks.request(`oct-web-storage:${name}`, operation);
  }
  return operation();
}

async function readWebDatabaseRecord(name: string): Promise<{ bytes: Uint8Array | null; revision: number }> {
  const db = await storage();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('databases', 'readonly');
    const store = tx.objectStore('databases');
    const dataReq = store.get(name);
    const revReq = store.get(revKey(name));
    let rawBytes: ArrayBuffer | undefined;
    let rawRev: unknown;
    let done = 0;
    const finish = () => {
      if (++done < 2) return;
      resolve({
        bytes: rawBytes ? new Uint8Array(rawBytes) : null,
        revision: decodeRev(rawRev),
      });
    };
    dataReq.onsuccess = () => { rawBytes = dataReq.result as ArrayBuffer | undefined; finish(); };
    dataReq.onerror = () => reject(dataReq.error);
    revReq.onsuccess = () => { rawRev = revReq.result; finish(); };
    revReq.onerror = () => reject(revReq.error);
  });
}

export async function readWebDatabase(name: string): Promise<Uint8Array | null> {
  const db = await storage();
  return new Promise((resolve, reject) => {
    const request = db.transaction('databases', 'readonly').objectStore('databases').get(name);
    request.onsuccess = () => resolve(request.result ? new Uint8Array(request.result as ArrayBuffer) : null);
    request.onerror = () => reject(request.error);
  });
}

async function writeWebDatabaseChecked(name: string, bytes: Uint8Array, expectedRevision: number): Promise<number> {
  return withWebStorageLock(name, async () => {
    const db = await storage();
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction('databases', 'readwrite');
      const store = tx.objectStore('databases');
      const currentReq = store.get(revKey(name));
      let nextRev = expectedRevision + 1;
      let conflict = false;
      currentReq.onsuccess = () => {
        const storedRev = decodeRev(currentReq.result);
        if (storedRev !== expectedRevision) {
          conflict = true;
          try { tx.abort?.(); } catch { /* mock IDB tx may omit abort */ }
          reject(new Error('Another browser tab updated this diary. Reload this tab to avoid overwriting newer changes.'));
          return;
        }
        nextRev = storedRev + 1;
        store.put(bytes.slice().buffer, name);
        store.put(encodeRev(nextRev), revKey(name));
      };
      currentReq.onerror = () => reject(currentReq.error ?? new Error('Could not check browser storage revision'));
      tx.oncomplete = () => { if (!conflict) resolve(nextRev); };
      tx.onerror = () => { if (!conflict) reject(tx.error ?? new Error('Could not save browser storage')); };
      tx.onabort = () => { if (!conflict) reject(tx.error ?? new Error('Browser storage write was aborted')); };
    });
  });
}

export async function writeWebDatabase(name: string, bytes: Uint8Array): Promise<void> {
  await withWebStorageLock(name, async () => {
    const db = await storage();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('databases', 'readwrite');
      tx.objectStore('databases').put(bytes.slice().buffer, name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not save browser storage'));
      tx.onabort = () => reject(tx.error ?? new Error('Browser storage write was aborted'));
    });
  });
}

/** An ordinary in-memory SQLite database, optionally restored/persisted as an IndexedDB blob. */
export async function createWebSqliteDriver(options: { name?: string; bytes?: Uint8Array; readOnly?: boolean } = {}): Promise<SqlDatabase> {
  const sqlite3 = await sqlite();
  const loaded = options.bytes
    ? { bytes: options.bytes, revision: 0 }
    : options.name
      ? await readWebDatabaseRecord(options.name)
      : { bytes: null, revision: 0 };
  const bytes = loaded.bytes;
  let storedRevision = loaded.revision;
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  try {
    if (bytes) {
      const data = sqlite3.wasm.allocFromTypedArray(bytes);
      const flags = sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE
        | (options.readOnly ? sqlite3.capi.SQLITE_DESERIALIZE_READONLY : sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE);
      const result = sqlite3.capi.sqlite3_deserialize(db.pointer!, 'main', data, bytes.byteLength, bytes.byteLength, flags);
      // With SQLITE_DESERIALIZE_FREEONCLOSE, SQLite takes ownership of `data` and frees it even on error.
      if (result !== sqlite3.capi.SQLITE_OK) throw new Error(`Could not load SQLite database (${result})`);
    }
    // Imported databases can carry WAL mode even though this connection has no WAL file.
    if (!options.readOnly) db.exec('PRAGMA journal_mode = MEMORY; PRAGMA foreign_keys = ON');
    else db.exec('PRAGMA query_only = ON');
    let dirty = false;
    let invalidatedError: Error | null = null;
    const assertValid = () => {
      if (invalidatedError) throw invalidatedError;
    };
    const persist = async () => {
      if (!options.name || options.readOnly || !dirty || !sqlite3.capi.sqlite3_get_autocommit(db.pointer!)) return;
      try {
        storedRevision = await writeWebDatabaseChecked(options.name, sqlite3.capi.sqlite3_js_db_export(db.pointer!), storedRevision);
        dirty = false;
      } catch (error) {
        invalidatedError = error instanceof Error ? error : new Error('Browser storage changed in another tab. Reload this tab.');
        dirty = false;
        throw invalidatedError;
      }
    };
    const rows = <T>(sql: string, params: SqlValue[]) => db.exec({ sql, bind: params, rowMode: 'object', returnValue: 'resultRows' }) as T[];
    return serializeDatabase({
      async execAsync(sql) {
        if (/^\s*ROLLBACK\b/i.test(sql) && sqlite3.capi.sqlite3_get_autocommit(db.pointer!)) {
          return;
        }
        assertValid();
        db.exec(sql);
        if (!/^\s*(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(sql)) dirty = true;
        await persist();
      },
      async runAsync(sql, ...params) {
        assertValid();
        db.exec({ sql, bind: params }); dirty = true;
        const result = { changes: db.changes(), lastInsertRowId: Number(db.selectValue('SELECT last_insert_rowid()')) };
        await persist(); return result;
      },
      async getAllAsync<T>(sql: string, ...params: SqlValue[]) { assertValid(); return rows<T>(sql, params); },
      async getFirstAsync<T>(sql: string, ...params: SqlValue[]) { assertValid(); return rows<T>(sql, params)[0] ?? null; },
      async closeAsync() { try { if (!invalidatedError) await persist(); } finally { db.close(); } },
    });
  } catch (error) { db.close(); throw error; }
}
