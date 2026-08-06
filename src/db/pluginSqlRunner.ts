import Database from '@tauri-apps/plugin-sql';
import type { QueryRunner, SqlParam } from './runner';

/**
 * Production adapter over tauri-plugin-sql. The database file lives in the
 * Tauri app data dir (DATA_MODEL.md §1). Foreign keys are enabled right after
 * open so cascade deletes and FK constraints hold for the connection's life.
 */
export async function openPluginDatabase(name = 'sqlite:promptforge.db'): Promise<QueryRunner> {
  const db = await Database.load(name);
  await db.execute('PRAGMA foreign_keys = ON');
  return {
    async execute(sql: string, params: SqlParam[] = []) {
      const result = await db.execute(sql, params);
      return result.rowsAffected ?? 0;
    },
    async select<T extends Record<string, unknown>>(sql: string, params: SqlParam[] = []) {
      return db.select<T[]>(sql, params);
    },
    async close() {
      await db.close();
    },
  };
}
