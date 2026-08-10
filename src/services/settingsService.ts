import { z } from 'zod';
import { getAppDb } from '../db/appDb';
import { createSettingsRepository, type SettingsRepository } from '../db/repos/settingsRepo';
import type { QueryRunner } from '../db/runner';
import {
  providerProfileSchema,
  type ProviderProfile,
} from '../schemas/providerProfile';

/**
 * Provider settings persistence (Phase 2): the SQLite `settings` table
 * (DATA_MODEL.md §1.5), replacing the Phase 1 localStorage stub. A valid
 * stub value is imported once on first load, then the stub key is removed.
 *
 * Only the non-secret profile is persisted. The strict Zod schemas reject
 * unknown fields, so an API key can never enter this shape — keys live
 * exclusively in the macOS Keychain (see providerService).
 */

const PROFILES_KEY = 'provider.profiles';
const LEGACY_STORAGE_KEY = 'promptforge.settings.providerProfile.v1';

export const providerProfilesStoreSchema = z
  .object({
    active: z.string().min(1),
    profiles: z.record(providerProfileSchema),
  })
  .strict();

export type ProviderProfilesStore = z.infer<typeof providerProfilesStoreSchema>;

let testRunner: QueryRunner | null = null;
let cache: ProviderProfilesStore | null = null;

/** Test seam: run against an in-memory database instead of the app DB. */
export function setDbForTests(runner: QueryRunner | null): void {
  testRunner = runner;
}

/** Test helper: drop the in-memory cache so storage is re-read. */
export function resetSettingsCacheForTests(): void {
  cache = null;
}

async function settings(): Promise<SettingsRepository> {
  return createSettingsRepository(testRunner ?? (await getAppDb()));
}

function readLegacyStub(): ProviderProfile | null {
  try {
    const raw = globalThis.localStorage?.getItem(LEGACY_STORAGE_KEY) ?? null;
    if (raw === null) return null;
    const parsed = providerProfileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function removeLegacyStub(): void {
  try {
    globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing to clean up.
  }
}

async function loadStore(): Promise<ProviderProfilesStore | null> {
  if (cache !== null) return cache;
  const store = await settings();
  const raw = await store.get(PROFILES_KEY);
  if (raw !== null) {
    const parsed = providerProfilesStoreSchema.safeParse(raw);
    if (parsed.success) {
      cache = parsed.data;
      return parsed.data;
    }
    // Corrupt store row: treat as absent rather than crashing the UI.
    return null;
  }
  // One-time migration from the Phase 1 localStorage stub.
  const legacy = readLegacyStub();
  if (legacy !== null) {
    const migrated: ProviderProfilesStore = { active: legacy.id, profiles: { [legacy.id]: legacy } };
    await store.set(PROFILES_KEY, migrated);
    removeLegacyStub();
    cache = migrated;
    return migrated;
  }
  return null;
}

export async function loadProfile(): Promise<ProviderProfile | null> {
  const store = await loadStore();
  if (store === null) return null;
  return store.profiles[store.active] ?? null;
}

/** List all configured provider profiles. */
export async function listProfiles(): Promise<ProviderProfile[]> {
  const store = await loadStore();
  if (store === null) return [];
  return Object.values(store.profiles);
}

export async function saveProfile(profile: ProviderProfile): Promise<ProviderProfile> {
  const parsed = providerProfileSchema.parse(profile);
  const store = await settings();
  const existing = await loadStore();
  const next: ProviderProfilesStore = {
    active: parsed.id,
    profiles: { ...(existing?.profiles ?? {}), [parsed.id]: parsed },
  };
  const validated = providerProfilesStoreSchema.parse(next);
  await store.set(PROFILES_KEY, validated);
  cache = validated;
  return parsed;
}

export async function clearProfile(): Promise<void> {
  const store = await settings();
  await store.remove(PROFILES_KEY);
  cache = null;
}
