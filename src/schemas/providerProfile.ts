import { z } from 'zod';

export const jsonModeSchema = z.enum(['auto', 'on', 'off']);

/**
 * Non-secret provider profile. The API key is intentionally NOT part of this
 * shape: it lives only in the OS keychain, addressed by `keychainAccountFor`.
 * `.strict()` rejects any extra field (e.g. a secret) at the boundary.
 */
export const providerProfileSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    baseUrl: z.string().min(1),
    modelId: z.string().min(1),
    capabilities: z.object({ jsonMode: jsonModeSchema }),
    params: z.object({
      temperature: z.number().min(0).max(2),
      maxTokens: z.number().int().positive(),
      timeoutMs: z.number().int().positive(),
    }),
  })
  .strict();

export type ProviderProfile = z.infer<typeof providerProfileSchema>;
export type JsonMode = z.infer<typeof jsonModeSchema>;

/**
 * Base URL policy (mirrors the Rust transport): https for anything remote,
 * http allowed only for localhost so the mock provider can run in dev.
 * No endpoint path or model name is implied here — both are user-configured.
 */
export function validateBaseUrl(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'Base URL is not a valid URL.' };
  }
  if (parsed.protocol === 'https:') {
    return { ok: true, value: parsed.toString().replace(/\/$/, '') };
  }
  if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
    return { ok: true, value: parsed.toString().replace(/\/$/, '') };
  }
  return { ok: false, error: 'Base URL must use https (http is allowed only for localhost).' };
}

/** Full profile validation used before saving: schema shape + base URL policy. */
export function validateProfile(
  candidate: unknown,
): { ok: true; profile: ProviderProfile } | { ok: false; errors: string[] } {
  const parsed = providerProfileSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'profile'}: ${i.message}`) };
  }
  const urlCheck = validateBaseUrl(parsed.data.baseUrl);
  if (!urlCheck.ok) {
    return { ok: false, errors: [urlCheck.error] };
  }
  return { ok: true, profile: { ...parsed.data, baseUrl: urlCheck.value } };
}

/** Keychain account for a profile. The key itself never appears in TS state beyond the input field. */
export function keychainAccountFor(profileId: string): string {
  return `provider/${profileId}`;
}

export const DEFAULT_PROFILE_ID = 'default';

export function defaultProfile(): ProviderProfile {
  return {
    id: DEFAULT_PROFILE_ID,
    label: 'Default provider',
    baseUrl: '',
    modelId: '',
    capabilities: { jsonMode: 'auto' },
    params: { temperature: 0.2, maxTokens: 4096, timeoutMs: 60_000 },
  };
}
