/**
 * Execution profile registry (Phase 7).
 *
 * Typed constants for all canonical profiles. Profiles adapt working
 * style only — never task meaning. The profile registry validates
 * model+runtime+profile compatibility at compile time.
 */

export interface ExecutionProfile {
  profile_id: string;
  profile_version: string;
  target_model: string;
  agent_runtime: 'claude-code' | 'qwen-code' | 'codex';
  planning_depth: 'minimal' | 'standard' | 'thorough';
  exploration_budget: 'low' | 'medium' | 'high';
  context_reuse: 'conservative' | 'balanced' | 'aggressive';
  reasoning_effort: 'low' | 'medium' | 'high' | 'maximum';
  test_strategy: 'none' | 'targeted' | 'full-suite';
  final_validation: 'none' | 'quick' | 'full-gate';
  retry_budget: number;
  progress_verbosity: 'minimal' | 'normal' | 'detailed';
  autonomy: 'low' | 'medium' | 'high';
  guardrail_strength: 'relaxed' | 'standard' | 'strict';
}

/**
 * All canonical profiles (v1.0.0). Keyed by profile_id.
 * Extend this map to add custom profiles.
 */
export const PROFILES: Record<string, ExecutionProfile> = {
  'deepseek-v4-pro-claude-code': {
    profile_id: 'deepseek-v4-pro-claude-code',
    profile_version: '1.0.0',
    target_model: 'deepseek-v4-pro',
    agent_runtime: 'claude-code',
    planning_depth: 'standard',
    exploration_budget: 'low',
    context_reuse: 'aggressive',
    reasoning_effort: 'high',
    test_strategy: 'targeted',
    final_validation: 'full-gate',
    retry_budget: 2,
    progress_verbosity: 'minimal',
    autonomy: 'high',
    guardrail_strength: 'strict',
  },
  'qwen-3.8-max-qwen-code': {
    profile_id: 'qwen-3.8-max-qwen-code',
    profile_version: '1.0.0',
    target_model: 'qwen-3.8-max',
    agent_runtime: 'qwen-code',
    planning_depth: 'standard',
    exploration_budget: 'medium',
    context_reuse: 'balanced',
    reasoning_effort: 'high',
    test_strategy: 'targeted',
    final_validation: 'quick',
    retry_budget: 2,
    progress_verbosity: 'normal',
    autonomy: 'medium',
    guardrail_strength: 'standard',
  },
  'gpt-5.6-sol-high-codex': {
    profile_id: 'gpt-5.6-sol-high-codex',
    profile_version: '1.0.0',
    target_model: 'gpt-5.6-sol',
    agent_runtime: 'codex',
    planning_depth: 'minimal',
    exploration_budget: 'low',
    context_reuse: 'conservative',
    reasoning_effort: 'medium',
    test_strategy: 'targeted',
    final_validation: 'quick',
    retry_budget: 1,
    progress_verbosity: 'normal',
    autonomy: 'medium',
    guardrail_strength: 'standard',
  },
  'opus-5-high-claude-code': {
    profile_id: 'opus-5-high-claude-code',
    profile_version: '1.0.0',
    target_model: 'opus-5',
    agent_runtime: 'claude-code',
    planning_depth: 'thorough',
    exploration_budget: 'high',
    context_reuse: 'aggressive',
    reasoning_effort: 'high',
    test_strategy: 'full-suite',
    final_validation: 'full-gate',
    retry_budget: 3,
    progress_verbosity: 'detailed',
    autonomy: 'high',
    guardrail_strength: 'strict',
  },
};

/**
 * Resolve a profile by ID. Returns the profile or undefined if not found.
 */
export function resolveProfile(profileId: string): ExecutionProfile | undefined {
  return PROFILES[profileId];
}

/**
 * Validate that a (model, runtime, profile) triple is compatible.
 */
export function validateProfileCompatibility(
  targetModel: string,
  agentRuntime: string,
  executionProfile: string,
): { ok: true; profile: ExecutionProfile } | { ok: false; error: string } {
  const profile = resolveProfile(executionProfile);
  if (!profile) {
    return { ok: false, error: `Unknown execution profile: '${executionProfile}'` };
  }
  if (profile.target_model !== targetModel) {
    return {
      ok: false,
      error: `Profile '${executionProfile}' expects model '${profile.target_model}', got '${targetModel}'`,
    };
  }
  if (profile.agent_runtime !== agentRuntime) {
    return {
      ok: false,
      error: `Profile '${executionProfile}' expects runtime '${profile.agent_runtime}', got '${agentRuntime}'`,
    };
  }
  return { ok: true, profile };
}
