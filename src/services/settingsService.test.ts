import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBetterSqliteRunner } from '../db/betterSqliteRunner';
import { runMigrations } from '../db/migrate';
import type { QueryRunner } from '../db/runner';
import { defaultProfile, type ProviderProfile } from '../schemas/providerProfile';
import {
  clearProfile,
  loadProfile,
  resetSettingsCacheForTests,
  saveProfile,
  setDbForTests,
} from './settingsService';

const LEGACY_STORAGE_KEY = 'promptforge.settings.providerProfile.v1';

let sqlite: BetterSqlite3.Database;
let runner: QueryRunner;

beforeEach(async () => {
  localStorage.clear();
  sqlite = new BetterSqlite3(':memory:');
  runner = createBetterSqliteRunner(sqlite);
  await runMigrations(runner);
  setDbForTests(runner);
  resetSettingsCacheForTests();
});

afterEach(() => {
  setDbForTests(null);
  resetSettingsCacheForTests();
  sqlite.close();
});

function storedSettingsValues(): string {
  const rows = sqlite.prepare('SELECT value FROM settings').all() as Array<{ value: string }>;
  return rows.map((row) => row.value).join('\n');
}

function makeProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    ...defaultProfile(),
    baseUrl: 'https://api.example.com/v1',
    modelId: 'some-model',
    label: 'Test provider',
    ...overrides,
  };
}

describe('settingsService (Phase 2 SQLite persistence)', () => {
  it('saves and loads a profile across cache resets', async () => {
    const profile = makeProfile();
    await saveProfile(profile);
    resetSettingsCacheForTests();
    expect(await loadProfile()).toEqual(profile);
  });

  it('returns null when nothing is stored', async () => {
    expect(await loadProfile()).toBeNull();
  });

  it('returns null for a corrupt store row instead of crashing', async () => {
    sqlite
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .run('provider.profiles', '{not json');
    expect(await loadProfile()).toBeNull();
  });

  it('clearProfile removes the stored profile', async () => {
    await saveProfile(makeProfile());
    await clearProfile();
    resetSettingsCacheForTests();
    expect(await loadProfile()).toBeNull();
  });

  it('migrates a valid Phase 1 localStorage stub into SQLite once', async () => {
    const stubProfile = makeProfile({ label: 'Legacy stub profile' });
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(stubProfile));

    expect(await loadProfile()).toEqual(stubProfile);
    // Stub is consumed: gone from localStorage, present in SQLite.
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(storedSettingsValues()).toContain('Legacy stub profile');

    // A later cold load reads from SQLite, not from the stub.
    resetSettingsCacheForTests();
    expect(await loadProfile()).toEqual(stubProfile);
  });

  it('ignores a corrupt Phase 1 stub', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, '{oops');
    expect(await loadProfile()).toBeNull();
  });

  it('prefers the SQLite store over a leftover stub', async () => {
    const stored = makeProfile({ label: 'Stored profile' });
    await saveProfile(stored);
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(makeProfile({ label: 'Stale stub' })));
    resetSettingsCacheForTests();
    expect(await loadProfile()).toEqual(stored);
  });

  it('never persists an API key: strict schema rejects unknown fields', async () => {
    const withKey = { ...makeProfile(), apiKey: 'sk-live-secret-value' };
    await expect(saveProfile(withKey as never)).rejects.toThrow();
    expect(storedSettingsValues()).not.toContain('sk-live-secret-value');
  });

  it('persisted settings JSON contains no key material', async () => {
    await saveProfile(makeProfile());
    const stored = storedSettingsValues();
    expect(stored).not.toMatch(/key/i);
    expect(stored).not.toMatch(/secret/i);
  });
});
