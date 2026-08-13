import type { ProviderProfile } from '../schemas/providerProfile';

export const MODEL_CATALOG = [
  {
    id: 'luna-5.6-high',
    displayName: 'Luna 5.6 High',
    providerId: 'openai',
    role: 'primary high-reasoning',
  },
  {
    id: 'qwen-3.8-max',
    displayName: 'Qwen 3.8 Max',
    providerId: 'qwen',
    role: 'alternative high-capability',
  },
  {
    id: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    providerId: 'deepseek',
    role: 'fast/light tasks',
  },
] as const;

export type CatalogModel = (typeof MODEL_CATALOG)[number];
export const DEFAULT_MODEL_ID = MODEL_CATALOG[0].id;

export function catalogModel(modelId: string): CatalogModel | null {
  return MODEL_CATALOG.find((model) => model.id === modelId) ?? null;
}

export interface ResolvedCatalogModel {
  model: CatalogModel;
  profile: ProviderProfile;
}

/** Resolve only an explicitly labelled provider profile; never fall back across providers. */
export function resolveCatalogModel(
  modelId: string,
  profiles: ProviderProfile[],
): { ok: true; value: ResolvedCatalogModel } | { ok: false; error: string } {
  const model = catalogModel(modelId);
  if (model === null) return { ok: false, error: 'Select one of the supported PromptForge models.' };
  const profile = profiles.find((candidate) => candidate.providerId === model.providerId
    || (candidate.providerId === undefined && candidate.label.toLowerCase().includes(model.providerId)));
  if (profile === undefined || profile.baseUrl.trim() === '' || profile.modelId.trim() === '') {
    return {
      ok: false,
      error: `CONFIGURATION REQUIRED: configure the ${model.displayName} provider profile in Settings.`,
    };
  }
  return { ok: true, value: { model, profile } };
}

export function runtimeModelRef(profile: ProviderProfile): string | null {
  return profile.runtimeModelRef?.trim() || null;
}

export function catalogLabelForBinding(providerId: string | null, modelId: string | null): string | null {
  if (providerId === null || modelId === null) return null;
  return MODEL_CATALOG.find((model) => model.providerId === providerId)?.displayName ?? null;
}
