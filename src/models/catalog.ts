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

/** Infer only identities that are unambiguous from known provider signals. */
export function inferKnownProviderId(profile: Pick<ProviderProfile, 'providerId' | 'label' | 'baseUrl' | 'modelId'>): string | null {
  if (profile.providerId === 'openai' || profile.providerId === 'qwen' || profile.providerId === 'deepseek') {
    return profile.providerId;
  }
  const value = `${profile.label} ${profile.baseUrl} ${profile.modelId}`.toLowerCase();
  if (value.includes('api.openai.com') || value.includes('openai') || value.includes('luna')) return 'openai';
  if (value.includes('dashscope.aliyuncs.com') || value.includes('qwen')) return 'qwen';
  if (value.includes('api.deepseek.com') || value.includes('deepseek')) return 'deepseek';
  return null;
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

export function catalogModelIdForBinding(
  providerId: string | null,
  modelId: string | null,
  profiles: ProviderProfile[] = [],
): string | null {
  if (providerId === null || modelId === null) return null;
  const profile = profiles.find((candidate) => candidate.providerId === providerId && candidate.modelId === modelId);
  if (profile !== undefined) return MODEL_CATALOG.find((model) => model.providerId === providerId)?.id ?? null;
  const normalized = modelId.toLowerCase();
  if (providerId === 'openai' && normalized.includes('luna')) return 'luna-5.6-high';
  if (providerId === 'qwen' && normalized.includes('qwen')) return 'qwen-3.8-max';
  if (providerId === 'deepseek' && normalized.includes('flash')) return 'deepseek-v4-flash';
  return null;
}

export function catalogLabelForBinding(
  providerId: string | null,
  modelId: string | null,
  profiles: ProviderProfile[] = [],
): string | null {
  const catalogId = catalogModelIdForBinding(providerId, modelId, profiles);
  return catalogId === null ? null : catalogModel(catalogId)?.displayName ?? null;
}

export function formatBindingModelLabel(
  providerId: string | null,
  modelId: string | null,
  profiles: ProviderProfile[] = [],
): string {
  const catalogLabel = catalogLabelForBinding(providerId, modelId, profiles);
  if (catalogLabel !== null) return catalogLabel;
  if (modelId === null || modelId.trim() === '') return 'Runtime default';
  const readable = modelId
    .replace(/(\d+)-(\d+)/g, '$1.$2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
  return `${readable} · Legacy/current`;
}
