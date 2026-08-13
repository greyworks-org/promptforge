import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_PROFILE_ID,
  defaultProfile,
  validateBaseUrl,
  validateProfile,
  type ProviderProfile,
} from '../schemas/providerProfile';
import {
  loadProfile,
  saveProfile,
} from '../services/settingsService';
import {
  deleteApiKey,
  hasApiKey,
  saveApiKey,
  testConnection,
  type ConnectionTestResult,
} from '../services/providerService';

type KeyState = 'unknown' | 'stored' | 'absent';

export interface SettingsScreenProps {
  /** Injectable for tests; default to the real services. */
  deps?: {
    loadProfile?: typeof loadProfile;
    saveProfile?: typeof saveProfile;
    saveApiKey?: typeof saveApiKey;
    deleteApiKey?: typeof deleteApiKey;
    hasApiKey?: typeof hasApiKey;
    testConnection?: typeof testConnection;
  };
}

export function SettingsScreen({ deps }: SettingsScreenProps) {
  const load = deps?.loadProfile ?? loadProfile;
  const save = deps?.saveProfile ?? saveProfile;
  const saveKey = deps?.saveApiKey ?? saveApiKey;
  const deleteKey = deps?.deleteApiKey ?? deleteApiKey;
  const keyExists = deps?.hasApiKey ?? hasApiKey;
  const runTest = deps?.testConnection ?? testConnection;

  const [label, setLabel] = useState('');
  const [providerId, setProviderId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [runtimeModelRef, setRuntimeModelRef] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [jsonMode, setJsonMode] = useState<'auto' | 'on' | 'off'>('auto');
  const [reasoningEffort, setReasoningEffort] = useState<'none' | 'low' | 'medium' | 'high' | 'maximum'>('high');

  const [loading, setLoading] = useState(true);
  const [keyState, setKeyState] = useState<KeyState>('unknown');
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'idle' | 'saving' | 'testing'>('idle');
  const [result, setResult] = useState<ConnectionTestResult | null>(null);

  const refreshKeyState = useCallback(async () => {
    try {
      const stored = await keyExists(DEFAULT_PROFILE_ID);
      setKeyState(stored ? 'stored' : 'absent');
    } catch {
      setKeyState('unknown');
    }
  }, [keyExists]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      let existing: ProviderProfile | null = null;
      try {
        existing = await load();
      } catch {
        existing = null;
      }
      if (cancelled) return;
      const profile = existing ?? defaultProfile();
      setLabel(profile.label);
      setProviderId(profile.providerId ?? '');
      setBaseUrl(profile.baseUrl);
      setModelId(profile.modelId);
      setRuntimeModelRef(profile.runtimeModelRef ?? '');
      setJsonMode(profile.capabilities.jsonMode);
      setReasoningEffort(profile.params.reasoningEffort ?? 'high');
      setLoading(false);
      void refreshKeyState();
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [load, refreshKeyState]);

  const buildCandidate = (): unknown => ({
    id: DEFAULT_PROFILE_ID,
    label: label.trim() === '' ? 'Default provider' : label.trim(),
    ...(providerId.trim() ? { providerId: providerId.trim() } : {}),
    baseUrl: baseUrl.trim(),
    modelId: modelId.trim(),
    ...(runtimeModelRef.trim() ? { runtimeModelRef: runtimeModelRef.trim() } : {}),
    capabilities: { jsonMode },
    params: { temperature: 0.2, maxTokens: 4096, timeoutMs: 60_000, reasoningEffort },
  });

  const onSave = async () => {
    setActionError(null);
    setFormErrors([]);
    const check = validateProfile(buildCandidate());
    if (!check.ok) {
      setFormErrors(check.errors);
      return;
    }
    setBusy('saving');
    try {
      await save(check.profile);
      if (apiKey.trim() !== '') {
        await saveKey(check.profile.id, apiKey.trim());
        setApiKey('');
      }
      await refreshKeyState();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Saving failed.');
    } finally {
      setBusy('idle');
    }
  };

  const onDeleteKey = async () => {
    setActionError(null);
    setBusy('saving');
    try {
      await deleteKey(DEFAULT_PROFILE_ID);
      await refreshKeyState();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Deleting the key failed.');
    } finally {
      setBusy('idle');
    }
  };

  const onTest = async () => {
    setActionError(null);
    setFormErrors([]);
    setResult(null);
    const urlCheck = validateBaseUrl(baseUrl.trim());
    if (!urlCheck.ok || modelId.trim() === '') {
      setFormErrors([
        ...(!urlCheck.ok ? [urlCheck.error] : []),
        ...(modelId.trim() === '' ? ['modelId: required'] : []),
      ]);
      return;
    }
    const profile: ProviderProfile = {
      id: DEFAULT_PROFILE_ID,
      label: label.trim() === '' ? 'Default provider' : label.trim(),
      ...(providerId.trim() ? { providerId: providerId.trim() } : {}),
      baseUrl: urlCheck.value,
      modelId: modelId.trim(),
      ...(runtimeModelRef.trim() ? { runtimeModelRef: runtimeModelRef.trim() } : {}),
      capabilities: { jsonMode },
      params: { temperature: 0.2, maxTokens: 4096, timeoutMs: 60_000, reasoningEffort },
    };
    setBusy('testing');
    try {
      setResult(await runTest(profile));
    } catch {
      setActionError('Connection test could not run.');
    } finally {
      setBusy('idle');
    }
  };

  const inputClass =
    'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none';

  if (loading) {
    return (
      <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-zinc-500" role="status">
          Loading settings…
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold">Provider settings</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Configure an OpenAI-compatible endpoint. The API key is stored in the
        macOS Keychain only — never in files, databases or logs.
      </p>

      <div className="mt-5 grid gap-4">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Profile label</span>
          <input
            className={inputClass}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Default provider"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-medium">Provider identity</span>
          <select className={inputClass} value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            <option value="">Choose a provider</option>
            <option value="openai">OpenAI</option>
            <option value="qwen">Qwen</option>
            <option value="deepseek">DeepSeek</option>
          </select>
          <span className="text-xs text-zinc-400">Used to bind the configured endpoint to the compact model selector.</span>
        </label>

        <div className="grid gap-1 text-sm">
          <label className="grid gap-1">
            <span className="font-medium">Base URL</span>
            <input
              className={inputClass}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://your-endpoint.example.com/v1"
            />
          </label>
          <span className="text-xs text-zinc-400">
            The /chat/completions path is appended by the transport.
          </span>
        </div>

        <label className="grid gap-1 text-sm">
          <span className="font-medium">Model ID</span>
          <input
            className={inputClass}
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="As configured on your endpoint (no default)"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-medium">OpenCode model reference (optional)</span>
          <input className={inputClass} value={runtimeModelRef} onChange={(e) => setRuntimeModelRef(e.target.value)} placeholder="provider/configured-model-id" />
          <span className="text-xs text-zinc-400">Required when this provider is selected for an OpenCode session; PromptForge never guesses it.</span>
        </label>

        <div className="grid gap-1 text-sm">
          <label className="grid gap-1">
            <span className="font-medium">API key</span>
            <input
              className={inputClass}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keyState === 'stored' ? 'Stored in Keychain — enter to replace' : 'Paste key to store'}
              autoComplete="off"
            />
          </label>
          <span className="text-xs text-zinc-400">
            {keyState === 'stored' && 'Key is stored in the Keychain.'}
            {keyState === 'absent' && 'No key stored yet.'}
            {keyState === 'unknown' && 'Keychain state unavailable.'}
          </span>
        </div>

        <div className="grid gap-1 text-sm">
          <label className="grid gap-1">
            <span className="font-medium">JSON response mode</span>
            <select
              className={inputClass}
              value={jsonMode}
              onChange={(e) => setJsonMode(e.target.value as 'auto' | 'on' | 'off')}
            >
              <option value="auto">auto — decide after connection test</option>
              <option value="on">on — request JSON response_format</option>
              <option value="off">off — plain chat, client parses</option>
            </select>
          </label>
        </div>

        <label className="grid gap-1 text-sm">
          <span className="font-medium">Reasoning effort</span>
          <select
            className={inputClass}
            value={reasoningEffort}
            onChange={(e) => setReasoningEffort(e.target.value as typeof reasoningEffort)}
          >
            <option value="none">none — provider default</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="maximum">maximum</option>
          </select>
          <span className="text-xs text-zinc-400">Used when the endpoint supports reasoning controls; ignored for legacy-compatible endpoints.</span>
        </label>
      </div>

      {formErrors.length > 0 && (
        <ul className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {formErrors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {actionError !== null && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {actionError}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={busy !== 'idle'}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === 'saving' ? 'Saving…' : 'Save profile'}
        </button>
        <button
          type="button"
          onClick={() => void onTest()}
          disabled={busy !== 'idle'}
          className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy === 'testing' ? 'Testing…' : 'Test connection'}
        </button>
        {keyState === 'stored' && (
          <button
            type="button"
            onClick={() => void onDeleteKey()}
            disabled={busy !== 'idle'}
            className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
          >
            Delete key
          </button>
        )}
      </div>

      {result !== null && (
        <div
          className={`mt-6 rounded-md border p-4 text-sm ${
            result.ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
          }`}
          aria-live="polite"
        >
          <p className="font-medium">{result.message}</p>
          <ul className="mt-2 grid gap-1 text-zinc-700">
            <li>{result.reachable ? '✓' : '✗'} Endpoint reachable</li>
            <li>
              {result.authAccepted === true
                ? '✓ Authentication accepted'
                : result.authAccepted === false
                  ? '✗ Authentication rejected'
                  : '– Authentication not verified'}
            </li>
            <li>{result.modelAnswered ? '✓ Model answered' : '✗ Model did not answer'}</li>
            <li>{result.contentIsJson ? '✓ Response content parsed as JSON' : '✗ Response content is not JSON'}</li>
            <li>
              {result.jsonModeRequested
                ? result.contentIsJson
                  ? '✓ JSON mode: requested and honored'
                  : '✗ JSON mode: requested but not honored'
                : '– JSON mode: not requested (auto/off)'}
            </li>
            <li>
              {result.usagePresent === true
                ? '✓ Usage stats present'
                : result.usagePresent === false
                  ? '– Usage stats absent (estimates will be labeled)'
                  : '– Usage stats unknown'}
            </li>
            <li>{result.latencyMs !== null ? `Latency: ${result.latencyMs} ms` : 'Latency: –'}</li>
            {result.errorClass !== null && <li>Error class: {result.errorClass}</li>}
          </ul>
        </div>
      )}
    </section>
  );
}
