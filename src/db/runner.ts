/** Values bindable to a SQL parameter placeholder. */
export type SqlParam = string | number | null;

/**
 * Minimal async database seam (ARCHITECTURE.md §2.4). Production uses the
 * tauri-plugin-sql adapter (`pluginSqlRunner.ts`); tests use better-sqlite3
 * (`betterSqliteRunner.ts`). Both run the same SQLite dialect, so
 * repositories and migrations keep to plain SQL that works on either.
 */
export interface QueryRunner {
  /** Run a write/DDL statement; resolves with the number of affected rows. */
  execute(sql: string, params?: SqlParam[]): Promise<number>;
  /** Run a read statement; resolves with the raw row objects. */
  select<T extends Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  close(): Promise<void>;
}
