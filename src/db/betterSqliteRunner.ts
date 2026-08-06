import type BetterSqlite3 from 'better-sqlite3';
import type { QueryRunner, SqlParam } from './runner';

/**
 * Test adapter: wraps better-sqlite3 in the same async QueryRunner shape the
 * tauri-plugin-sql adapter exposes. Only imported from tests — never from the
 * app graph (better-sqlite3 is a dev dependency with no webview runtime).
 */
export function createBetterSqliteRunner(db: BetterSqlite3.Database): QueryRunner {
  db.pragma('foreign_keys = ON');
  return {
    async execute(sql: string, params: SqlParam[] = []) {
      const result = db.prepare(sql).run(...params);
      return result.changes;
    },
    async select<T extends Record<string, unknown>>(sql: string, params: SqlParam[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async close() {
      db.close();
    },
  };
}
