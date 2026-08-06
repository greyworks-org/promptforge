import {
  providerProfileSchema,
  type ProviderProfile,
} from '../schemas/providerProfile';

/**
 * Phase 1 settings stub: in-memory + localStorage. Phase 2 replaces the
 * storage backend with the SQLite `settings` table; the service API stays.
 *
 * Only the non-secret profile is persisted. The strict Zod schema rejects
 * unknown fields, so an API key can never enter this shape.
 */
const STORAGE_KEY = 'promptforge.settings.providerProfile.v1';

let memoryCache: ProviderProfile | null = null;

function readStorage(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(value: string | null): void {
  try {
    if (value === null) {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    } else {
      globalThis.localStorage?.setItem(STORAGE_KEY, value);
    }
  } catch {
    // Storage unavailable (private mode, tests): memory cache still works.
  }
}

export function loadProfile(): ProviderProfile | null {
  if (memoryCache) return memoryCache;
  const raw = readStorage();
  if (raw === null) return null;
  try {
    const parsed = providerProfileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    memoryCache = parsed.data;
    return parsed.data;
  } catch {
    return null;
  }
}

export function saveProfile(profile: ProviderProfile): ProviderProfile {
  const parsed = providerProfileSchema.parse(profile);
  memoryCache = parsed;
  writeStorage(JSON.stringify(parsed));
  return parsed;
}

export function clearProfile(): void {
  memoryCache = null;
  writeStorage(null);
}

/** Test helper: drop the in-memory cache so storage is re-read. */
export function resetSettingsCacheForTests(): void {
  memoryCache = null;
}
