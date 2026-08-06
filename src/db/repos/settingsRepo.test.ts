import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBetterSqliteRunner } from '../betterSqliteRunner';
import { runMigrations } from '../migrate';
import type { QueryRunner } from '../runner';
import { createSettingsRepository, type SettingsRepository } from './settingsRepo';

let sqlite: BetterSqlite3.Database;
let runner: QueryRunner;
let repo: SettingsRepository;

beforeEach(async () => {
  sqlite = new BetterSqlite3(':memory:');
  runner = createBetterSqliteRunner(sqlite);
  await runMigrations(runner);
  repo = createSettingsRepository(runner);
});

afterEach(() => {
  sqlite.close();
});

describe('settings repository', () => {
  it('returns null for an absent key', async () => {
    expect(await repo.get('missing.key')).toBeNull();
  });

  it('stores and retrieves JSON values', async () => {
    const value = { active: 'default', nested: { list: [1, 2, 3] } };
    await repo.set('provider.profiles', value);
    expect(await repo.get('provider.profiles')).toEqual(value);
  });

  it('overwrites an existing key', async () => {
    await repo.set('ui.theme', 'light');
    await repo.set('ui.theme', 'dark');
    expect(await repo.get('ui.theme')).toBe('dark');
    const rows = sqlite.prepare('SELECT COUNT(*) AS n FROM settings WHERE key = ?').get('ui.theme') as {
      n: number;
    };
    expect(rows.n).toBe(1);
  });

  it('removes a key', async () => {
    await repo.set('temp', 1);
    await repo.remove('temp');
    expect(await repo.get('temp')).toBeNull();
    await repo.remove('temp');
  });

  it('returns null for a corrupt stored value instead of throwing', async () => {
    sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('corrupt', '{not json');
    expect(await repo.get('corrupt')).toBeNull();
  });
});
