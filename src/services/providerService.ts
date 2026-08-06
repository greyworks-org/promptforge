import { invokeIpc } from '../ipc';
import {
  keychainAccountFor,
  type ProviderProfile,
} from '../schemas/providerProfile';

/** Raw transport outcome returned by the Rust `provider_chat` command. */
export interface ChatOutcome {
  status: number;
  body: string;
  latencyMs: number;
}

/** Error classes mirror docs/DEEPSEEK_INTEGRATION.md §6. */
export type ProviderErrorClass = 'config' | 'auth' | 'network' | 'http_api';

export interface ProviderFailure {
  class: ProviderErrorClass;
  message: string;
}

/** Failure normalized from an IPC rejection; unknown shapes are never echoed. */
interface NormalizedFailure {
  class: ProviderErrorClass | 'unknown';
  message: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  reachable: boolean;
  authAccepted: boolean | null;
  modelAnswered: boolean;
  contentIsJson: boolean;
  jsonModeRequested: boolean;
  usagePresent: boolean | null;
  latencyMs: number | null;
  errorClass: ProviderErrorClass | 'unknown' | null;
  message: string;
}

const CONNECTION_TEST_PROMPT = 'Respond with JSON: {"ok": true}';
const CONNECTION_TEST_MAX_TOKENS = 50;

export async function saveApiKey(profileId: string, secret: string): Promise<void> {
  await invokeIpc('keychain_set', { account: keychainAccountFor(profileId), secret });
}

export async function deleteApiKey(profileId: string): Promise<boolean> {
  return invokeIpc<boolean>('keychain_delete', { account: keychainAccountFor(profileId) });
}

export async function hasApiKey(profileId: string): Promise<boolean> {
  return invokeIpc<boolean>('keychain_has', { account: keychainAccountFor(profileId) });
}

function asProviderFailure(err: unknown): NormalizedFailure {
  if (err && typeof err === 'object' && 'class' in err && 'message' in err) {
    const candidate = err as { class: unknown; message: unknown };
    if (typeof candidate.message === 'string') {
      const cls = candidate.class;
      if (cls === 'config' || cls === 'auth' || cls === 'network' || cls === 'http_api') {
        return { class: cls, message: candidate.message };
      }
      return { class: 'config', message: candidate.message };
    }
  }
  // Never echo unknown payloads: they could carry provider-side details.
  return { class: 'unknown', message: 'Provider request failed.' };
}

function failureResult(failure: NormalizedFailure): ConnectionTestResult {
  return {
    ok: false,
    reachable: false,
    authAccepted: failure.class === 'auth' ? false : null,
    modelAnswered: false,
    contentIsJson: false,
    jsonModeRequested: false,
    usagePresent: null,
    latencyMs: null,
    errorClass: failure.class,
    message: failure.message,
  };
}

/**
 * Runs the connection test protocol (docs/DEEPSEEK_INTEGRATION.md §7):
 * tiny fixed prompt, small max_tokens; reports reachability, auth, parse,
 * JSON-mode support when applicable, usage presence and latency.
 * The API key never enters this function — Rust reads it from the keychain.
 */
export async function testConnection(profile: ProviderProfile): Promise<ConnectionTestResult> {
  const jsonModeRequested = profile.capabilities.jsonMode === 'on';
  try {
    const outcome = await invokeIpc<ChatOutcome>('provider_chat', {
      baseUrl: profile.baseUrl,
      modelId: profile.modelId,
      keychainAccount: keychainAccountFor(profile.id),
      messages: [{ role: 'user', content: CONNECTION_TEST_PROMPT }],
      temperature: 0.2,
      maxTokens: CONNECTION_TEST_MAX_TOKENS,
      timeoutMs: profile.params.timeoutMs,
      jsonMode: jsonModeRequested ? 'on' : 'off',
    });
    return interpretOutcome(outcome, jsonModeRequested);
  } catch (err) {
    return failureResult(asProviderFailure(err));
  }
}

export function interpretOutcome(outcome: ChatOutcome, jsonModeRequested: boolean): ConnectionTestResult {
  let content: string | null = null;
  let usagePresent: boolean | null = null;
  try {
    const body = JSON.parse(outcome.body) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: unknown;
    };
    const rawContent = body.choices?.[0]?.message?.content;
    content = typeof rawContent === 'string' ? rawContent : null;
    usagePresent = body.usage !== undefined && body.usage !== null;
  } catch {
    usagePresent = null;
  }

  const modelAnswered = content !== null && content.length > 0;
  let contentIsJson = false;
  if (content !== null) {
    try {
      JSON.parse(content);
      contentIsJson = true;
    } catch {
      contentIsJson = false;
    }
  }

  return {
    ok: modelAnswered,
    reachable: true,
    authAccepted: true,
    modelAnswered,
    contentIsJson,
    jsonModeRequested,
    usagePresent,
    latencyMs: outcome.latencyMs,
    errorClass: null,
    message: modelAnswered ? 'Connection successful.' : 'Endpoint answered but returned no usable content.',
  };
}
