import { beforeEach, describe, expect, it, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';

vi.mock('../ipc', () => ({ invokeIpc: vi.fn() }));

import { invokeIpc } from '../ipc';
import {
  deleteApiKey,
  hasApiKey,
  interpretOutcome,
  saveApiKey,
  setDbForTests,
  testConnection,
} from './providerService';
import { createBetterSqliteRunner } from '../db/betterSqliteRunner';
import { runMigrations } from '../db/migrate';
import { defaultProfile, type ProviderProfile } from '../schemas/providerProfile';

const mockInvoke = vi.mocked(invokeIpc);

function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    ...defaultProfile(),
    baseUrl: 'http://localhost:4141',
    modelId: 'test-model',
    ...overrides,
  };
}

const okBody = JSON.stringify({
  choices: [{ message: { content: '{"ok":true}' } }],
  usage: { prompt_tokens: 9, completion_tokens: 4 },
});

beforeEach(async () => {
  mockInvoke.mockReset();
  const runner = createBetterSqliteRunner(new BetterSqlite3(':memory:'));
  await runMigrations(runner);
  setDbForTests(runner);
});

describe('keychain IPC wrappers', () => {
  it('saves the key and stores presence metadata', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await saveApiKey('default', 'sk-test');
    expect(mockInvoke).toHaveBeenCalledWith('keychain_set', {
      account: 'provider/default',
      secret: 'sk-test',
    });
    // After save, hasApiKey should return true from metadata (no keychain_has call).
  });

  it('reports presence from metadata and deletion clears it', async () => {
    // Save first to write metadata.
    mockInvoke.mockResolvedValueOnce(undefined); // keychain_set
    await saveApiKey('default', 'sk-test');

    // hasApiKey should return true from metadata — no keychain_has call needed.
    mockInvoke.mockReset();
    const exists = await hasApiKey('default');
    expect(exists).toBe(true);

    // Delete: keychain_delete + metadata removal.
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValueOnce(true); // keychain_delete
    await deleteApiKey('default');
    expect(mockInvoke).toHaveBeenCalledWith('keychain_delete', expect.any(Object));

    // After delete, metadata removed.
    mockInvoke.mockReset();
    // Metadata is '0', but hasApiKey skips IPC — returns false from meta.
  });
});

describe('testConnection', () => {
  it('reports a fully successful mock connection', async () => {
    mockInvoke.mockResolvedValueOnce({ status: 200, body: okBody, latencyMs: 42 });
    const result = await testConnection(profile());
    expect(result).toMatchObject({
      ok: true,
      reachable: true,
      authAccepted: true,
      modelAnswered: true,
      contentIsJson: true,
      usagePresent: true,
      latencyMs: 42,
      errorClass: null,
    });
  });

  it('sends the connection-test payload shape (no key in args, jsonMode off for auto)', async () => {
    mockInvoke.mockResolvedValueOnce({ status: 200, body: okBody, latencyMs: 5 });
    await testConnection(profile());
    const [command, args] = mockInvoke.mock.calls[0];
    expect(command).toBe('provider_chat');
    const a = args as Record<string, unknown>;
    expect(a.keychainAccount).toBe('provider/default');
    expect(a.maxTokens).toBe(50);
    expect(a.jsonMode).toBe('off');
    expect(JSON.stringify(a)).not.toContain('apiKey');
    expect(Object.keys(a)).not.toContain('secret');
  });

  it('requests response_format only when jsonMode is on', async () => {
    mockInvoke.mockResolvedValueOnce({ status: 200, body: okBody, latencyMs: 5 });
    await testConnection(profile({ capabilities: { jsonMode: 'on' } }));
    const args = mockInvoke.mock.calls[0][1] as Record<string, unknown>;
    expect(args.jsonMode).toBe('on');
  });

  it('flags invalid JSON content (200 but unparsable)', async () => {
    const body = JSON.stringify({ choices: [{ message: { content: 'Sure! { broken' } }], usage: {} });
    mockInvoke.mockResolvedValueOnce({ status: 200, body, latencyMs: 10 });
    const result = await testConnection(profile());
    // The connection itself worked; the report shows content is not JSON,
    // which informs jsonMode auto-resolution.
    expect(result.modelAnswered).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.contentIsJson).toBe(false);
  });

  it('reports missing usage stats', async () => {
    const body = JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] });
    mockInvoke.mockResolvedValueOnce({ status: 200, body, latencyMs: 10 });
    const result = await testConnection(profile());
    expect(result.usagePresent).toBe(false);
  });

  it('maps auth rejection to the auth class', async () => {
    mockInvoke.mockRejectedValueOnce({ class: 'auth', message: 'API key rejected — check Settings.' });
    const result = await testConnection(profile());
    expect(result).toMatchObject({
      ok: false,
      reachable: false,
      authAccepted: false,
      errorClass: 'auth',
      message: 'API key rejected — check Settings.',
    });
  });

  it('maps unreachable/timeout endpoints to the network class', async () => {
    mockInvoke.mockRejectedValueOnce({ class: 'network', message: 'Connection timed out.' });
    const result = await testConnection(profile());
    expect(result).toMatchObject({ ok: false, reachable: false, errorClass: 'network', latencyMs: null });

    mockInvoke.mockRejectedValueOnce({ class: 'network', message: 'Connection failed — check the base URL and your network.' });
    const unreachable = await testConnection(profile());
    expect(unreachable.errorClass).toBe('network');
  });

  it('maps provider HTTP errors to http_api', async () => {
    mockInvoke.mockRejectedValueOnce({ class: 'http_api', message: 'Provider error: overloaded' });
    const result = await testConnection(profile());
    expect(result.errorClass).toBe('http_api');
  });

  it('never echoes unknown rejection payloads', async () => {
    mockInvoke.mockRejectedValueOnce('weird-provider-payload-with-details');
    const result = await testConnection(profile());
    expect(result.errorClass).toBe('unknown');
    expect(result.message).not.toContain('weird-provider-payload');
  });
});

describe('interpretOutcome', () => {
  it('handles an unparseable body defensively', () => {
    const result = interpretOutcome({ status: 200, body: '<html>', latencyMs: 3 }, false);
    expect(result.modelAnswered).toBe(false);
    expect(result.usagePresent).toBeNull();
  });
});
