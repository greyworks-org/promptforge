import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../schemas/providerProfile';
import { DEFAULT_MODEL_ID, MODEL_CATALOG, formatBindingModelLabel, inferKnownProviderId, resolveCatalogModel, runtimeModelRef } from './catalog';

describe('PromptForge v1 model catalog', () => {
  it('contains exactly the three requested display choices', () => {
    expect(MODEL_CATALOG.map((model) => model.displayName)).toEqual([
      'Luna 5.6 High',
      'Qwen 3.8 Max',
      'DeepSeek V4 Flash',
    ]);
    expect(DEFAULT_MODEL_ID).toBe('luna-5.6-high');
  });

  it('uses configured provider and runtime IDs without guessing model names', () => {
    const profile = {
      ...defaultProfile(),
      providerId: 'qwen',
      baseUrl: 'https://qwen.example/v1',
      modelId: 'configured-qwen-model-id',
      runtimeModelRef: 'qwen/configured-runtime-model',
    };
    const resolved = resolveCatalogModel('qwen-3.8-max', [profile]);
    expect(resolved).toMatchObject({ ok: true, value: { profile } });
    if (resolved.ok) expect(runtimeModelRef(resolved.value.profile)).toBe('qwen/configured-runtime-model');
    expect(JSON.stringify(MODEL_CATALOG)).not.toContain('3.7');
  });

  it('does not fall back to another provider profile', () => {
    const profile = { ...defaultProfile(), providerId: 'openai', baseUrl: 'https://openai.example/v1', modelId: 'luna-id' };
    expect(resolveCatalogModel('qwen-3.8-max', [profile])).toEqual(expect.objectContaining({ ok: false }));
  });

  it('keeps legacy explicitly labelled profiles usable', () => {
    const legacy = { ...defaultProfile(), label: 'DeepSeek Provider', baseUrl: 'https://deepseek.example/v1', modelId: 'legacy-id' };
    expect(resolveCatalogModel('deepseek-v4-flash', [legacy])).toMatchObject({ ok: true });
  });

  it('identifies a known legacy Luna profile without changing its configured endpoint', () => {
    const legacy = { ...defaultProfile(), label: 'OpenAI GPT 5.6 Luna', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-5.6-luna' };
    expect(inferKnownProviderId(legacy)).toBe('openai');
    expect(formatBindingModelLabel('anthropic', 'claude-sonnet-4-5')).toBe('Claude Sonnet 4.5 · Legacy/current');
    expect(formatBindingModelLabel('openai', 'gpt-5.6-luna', [legacy])).toBe('Luna 5.6 High');
  });
});
