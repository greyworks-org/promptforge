import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearProfile,
  loadProfile,
  resetSettingsCacheForTests,
  saveProfile,
} from './settingsService';
import { defaultProfile } from '../schemas/providerProfile';

beforeEach(() => {
  localStorage.clear();
  resetSettingsCacheForTests();
});

describe('settingsService (Phase 1 stub persistence)', () => {
  it('saves and loads a profile across cache resets', () => {
    const profile = {
      ...defaultProfile(),
      baseUrl: 'https://api.example.com/v1',
      modelId: 'some-model',
      label: 'Test provider',
    };
    saveProfile(profile);
    resetSettingsCacheForTests();
    expect(loadProfile()).toEqual(profile);
  });

  it('returns null when nothing is stored', () => {
    expect(loadProfile()).toBeNull();
  });

  it('returns null for corrupt stored data', () => {
    localStorage.setItem('promptforge.settings.providerProfile.v1', '{oops');
    expect(loadProfile()).toBeNull();
  });

  it('clearProfile removes the stored profile', () => {
    saveProfile({ ...defaultProfile(), baseUrl: 'https://x.example', modelId: 'm' });
    clearProfile();
    resetSettingsCacheForTests();
    expect(loadProfile()).toBeNull();
  });

  it('never persists an API key: strict schema rejects unknown fields', () => {
    const withKey = {
      ...defaultProfile(),
      baseUrl: 'https://api.example.com',
      modelId: 'm',
      apiKey: 'sk-live-secret-value',
    };
    // Runtime cast: the service boundary must refuse this shape.
    expect(() => saveProfile(withKey as never)).toThrow();
    expect(JSON.stringify(localStorage)).not.toContain('sk-live-secret-value');
  });

  it('persisted profile JSON contains no key material', () => {
    saveProfile({ ...defaultProfile(), baseUrl: 'https://api.example.com', modelId: 'm' });
    const raw = localStorage.getItem('promptforge.settings.providerProfile.v1') ?? '';
    expect(raw).not.toMatch(/key/i);
  });
});
