// Node-only entry point: deliberately excluded from the native storage barrel.
import { DatabaseSync } from 'node:sqlite';
import { serializeDatabase } from './driver';
import type { SqlDatabase, SqlValue } from './driver';

export function createNodeSqliteDriver(filename: string, options: { readOnly?: boolean } = {}): SqlDatabase {
  const db = new DatabaseSync(filename, { readOnly: options.readOnly ?? false });
  return serializeDatabase({
    async execAsync(sql) { db.exec(sql); },
    async runAsync(sql, ...params) {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async getFirstAsync<T>(sql: string, ...params: SqlValue[]) { return (db.prepare(sql).get(...params) as T | undefined) ?? null; },
    async getAllAsync<T>(sql: string, ...params: SqlValue[]) { return db.prepare(sql).all(...params) as T[]; },
    async closeAsync() { db.close(); },
  });
}
