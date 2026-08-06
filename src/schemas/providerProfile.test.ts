import { describe, expect, it } from 'vitest';
import {
  defaultProfile,
  keychainAccountFor,
  validateBaseUrl,
  validateProfile,
} from './providerProfile';

describe('validateBaseUrl', () => {
  it('accepts https endpoints and strips trailing slashes', () => {
    const ok = validateBaseUrl('https://api.example.com/v1/');
    expect(ok).toEqual({ ok: true, value: 'https://api.example.com/v1' });
  });

  it('allows http only for localhost', () => {
    expect(validateBaseUrl('http://localhost:4141').ok).toBe(true);
    expect(validateBaseUrl('http://127.0.0.1:4141').ok).toBe(true);
    expect(validateBaseUrl('http://api.example.com').ok).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(validateBaseUrl('not a url').ok).toBe(false);
  });
});

describe('validateProfile', () => {
  const base = defaultProfile();

  it('accepts a complete valid profile', () => {
    const result = validateProfile({
      ...base,
      baseUrl: 'https://api.example.com/v1',
      modelId: 'my-model-id',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects empty modelId (no hardcoded default exists)', () => {
    const result = validateProfile({ ...base, baseUrl: 'https://api.example.com', modelId: '' });
    expect(result.ok).toBe(false);
  });

  it('rejects a remote http baseUrl', () => {
    const result = validateProfile({ ...base, baseUrl: 'http://api.example.com', modelId: 'm' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/https/);
    }
  });

  it('rejects unknown fields such as an API key (strict schema)', () => {
    const result = validateProfile({
      ...base,
      baseUrl: 'https://api.example.com',
      modelId: 'm',
      apiKey: 'sk-secret-must-not-live-here',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/apiKey/);
    }
  });
});

describe('keychainAccountFor', () => {
  it('derives a stable account name per profile', () => {
    expect(keychainAccountFor('default')).toBe('provider/default');
  });
});
