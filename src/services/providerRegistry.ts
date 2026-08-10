/**
 * Provider/runtime registry.
 *
 * Validates compiler provider + model + target runtime combinations.
 * The Compiler Provider is used for the API call (TaskSpec generation).
 * The Target Runtime determines which renderer + CLI is used for delivery.
 * These are independent — any provider can compile for any runtime.
 */

export interface ResolvedProfile {
  runtime: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
}

/**
 * Runtime → default CLI binary name (Phase 11 launcher).
 */
const RUNTIME_BINARIES: Record<string, string> = {
  'claude-code': 'claude',
  'qwen-code': 'qwen',
  'codex': 'codex',
};

/**
 * Provider label patterns that indicate subscription/OAuth auth
 * (no API key needed — the runtime handles auth natively).
 */
function isSubscriptionProvider(label: string): boolean {
  const lower = label.toLowerCase();
  return lower.includes('chatgpt') || lower.includes('subscription');
}

/**
 * Validate a compiler provider + model + target runtime combination.
 *
 * Rules:
 * - Subscription providers (ChatGPT) are only compatible with their
 *   native runtime (Codex CLI). The runtime handles auth via OAuth.
 * - DeepSeek provider requires a specific model (not 'auto').
 * - All other provider+runtime combinations are valid.
 * - The runtime binary must be known (claude/qwen/codex).
 */
export function resolveExecutionProfile(
  runtime: string,
  providerLabel: string,
  modelId: string,
): { ok: true; profile: ResolvedProfile } | { ok: false; error: string } {
  if (!runtime) return { ok: false, error: 'Select a target runtime.' };
  if (!providerLabel) return { ok: false, error: 'Select a provider profile.' };
  if (!RUNTIME_BINARIES[runtime]) {
    return { ok: false, error: `Unknown runtime: '${runtime}'.` };
  }

  const resolvedModel = modelId.trim() || 'auto';

  // Subscription providers: only compatible with their native runtime.
  if (isSubscriptionProvider(providerLabel)) {
    if (runtime !== 'codex') {
      return {
        ok: false,
        error: `ChatGPT Subscription is only compatible with Codex CLI (the runtime handles auth via OAuth).`,
      };
    }
    // Subscription runtime controls model selection.
    return {
      ok: true,
      profile: { runtime, providerId: '', providerLabel, modelId: 'auto' },
    };
  }

  // DeepSeek provider: model must be specified.
  if (providerLabel.toLowerCase().includes('deepseek') && resolvedModel === 'auto') {
    return {
      ok: false,
      error: `DeepSeek API requires a specific model (e.g. deepseek-v4-pro).`,
    };
  }

  return {
    ok: true,
    profile: {
      runtime,
      providerId: '',
      providerLabel,
      modelId: resolvedModel,
    },
  };
}
