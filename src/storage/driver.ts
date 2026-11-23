import type { SQLiteDatabase } from 'expo-sqlite';

export type SqlValue = string | number | null | Uint8Array;
export interface SqlRunResult { changes: number; lastInsertRowId: number }
export interface SqlDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SqlValue[]): Promise<SqlRunResult>;
  getFirstAsync<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
  /** Use the supplied handle inside the callback. All other calls wait for commit/rollback. */
  withTransactionAsync<T>(task: (tx: SqlDatabase) => Promise<T>): Promise<T>;
  closeAsync(): Promise<void>;
}
export type RawSqlDatabase = Omit<SqlDatabase, 'withTransactionAsync'>;

/** Serializes transactions AND ordinary queries to prevent async callers joining another transaction. */
export function serializeDatabase(raw: RawSqlDatabase): SqlDatabase {
  let tail = Promise.resolve();
  let savepoint = 0;
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }
  const tx: SqlDatabase = {
    ...raw,
    async withTransactionAsync(task) {
      const name = `nested_${++savepoint}`;
      await raw.execAsync(`SAVEPOINT ${name}`);
      try {
        const value = await task(tx);
        await raw.execAsync(`RELEASE ${name}`);
        return value;
      } catch (error) {
        await raw.execAsync(`ROLLBACK TO ${name}; RELEASE ${name}`);
        throw error;
      }
    },
  };
  return {
    execAsync: (sql) => enqueue(() => raw.execAsync(sql)),
    runAsync: (sql, ...params) => enqueue(() => raw.runAsync(sql, ...params)),
    getFirstAsync: <T>(sql: string, ...params: SqlValue[]) => enqueue(() => raw.getFirstAsync<T>(sql, ...params)),
    getAllAsync: <T>(sql: string, ...params: SqlValue[]) => enqueue(() => raw.getAllAsync<T>(sql, ...params)),
    closeAsync: () => enqueue(() => raw.closeAsync()),
    withTransactionAsync: (task) => enqueue(async () => {
      await raw.execAsync('BEGIN');
      try {
        const value = await task(tx);
        await raw.execAsync('COMMIT');
        return value;
      } catch (error) {
        await raw.execAsync('ROLLBACK');
        throw error;
      }
    }),
  };
}

export function createExpoSqliteDriver(db: SQLiteDatabase): SqlDatabase {
  return serializeDatabase({
    execAsync: (sql) => db.execAsync(sql),
    runAsync: (sql, ...params) => db.runAsync(sql, ...params),
    getFirstAsync: <T>(sql: string, ...params: SqlValue[]) => db.getFirstAsync<T>(sql, ...params),
    getAllAsync: <T>(sql: string, ...params: SqlValue[]) => db.getAllAsync<T>(sql, ...params),
    closeAsync: () => db.closeAsync(),
  });
}
