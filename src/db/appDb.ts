import { runMigrations } from './migrate';
import { openPluginDatabase } from './pluginSqlRunner';
import type { QueryRunner } from './runner';

let appDb: Promise<QueryRunner> | null = null;

/**
 * Process-wide app database handle. Opens once (tauri-plugin-sql) and runs
 * pending migrations before first use; later calls reuse the same promise.
 * Tests never call this — they inject an in-memory runner instead.
 */
export function getAppDb(): Promise<QueryRunner> {
  if (appDb === null) {
    appDb = openPluginDatabase().then(async (db) => {
      await runMigrations(db);
      return db;
    });
  }
  return appDb;
}

/** Test helper: forget the cached handle (does not close an open database). */
export function resetAppDbForTests(): void {
  appDb = null;
}
