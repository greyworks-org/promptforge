import type { QueryRunner } from '../runner';

/**
 * Key/JSON-value settings store (DATA_MODEL.md §1.5). Secrets never belong
 * here: the API key lives only in the OS keychain (SECURITY.md).
 */
export interface SettingsRepository {
  /** Parsed JSON value, or null when the key is absent/unparseable. */
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createSettingsRepository(runner: QueryRunner): SettingsRepository {
  return {
    async get(key: string): Promise<unknown | null> {
      const rows = await runner.select<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
      if (rows.length === 0) return null;
      try {
        return JSON.parse(rows[0].value) as unknown;
      } catch {
        return null;
      }
    },

    async set(key: string, value: unknown): Promise<void> {
      const json = JSON.stringify(value);
      await runner.execute(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, json],
      );
    },

    async remove(key: string): Promise<void> {
      await runner.execute('DELETE FROM settings WHERE key = ?', [key]);
    },
  };
}
