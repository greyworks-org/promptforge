import { describe, it, expect } from 'vitest';
import { resolveExecutionProfile } from './providerRegistry';

describe('resolveExecutionProfile — real combinations', () => {
  // Concrete profiles verified against actual installed binaries.

  it('Codex CLI + ChatGPT Subscription = valid (OAuth, no API key)', () => {
    const r = resolveExecutionProfile('codex', 'ChatGPT Subscription', 'auto');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.profile.modelId).toBe('auto');
  });

  it('ChatGPT Subscription rejected for Claude Code', () => {
    const r = resolveExecutionProfile('claude-code', 'ChatGPT Subscription', 'auto');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Codex CLI');
  });

  it('ChatGPT Subscription rejected for Qwen Code', () => {
    const r = resolveExecutionProfile('qwen-code', 'ChatGPT Subscription', 'auto');
    expect(r.ok).toBe(false);
  });

  it('Codex CLI + OpenAI API = valid (API key)', () => {
    const r = resolveExecutionProfile('codex', 'OpenAI API', 'gpt-5.6-sol');
    expect(r.ok).toBe(true);
  });

  it('OpenCode + API-key provider = valid runtime route', () => {
    expect(resolveExecutionProfile('opencode', 'Some Provider', 'provider/model')).toMatchObject({ ok: true });
  });

  it('Claude Code + DeepSeek API + deepseek-v4-pro = valid', () => {
    const r = resolveExecutionProfile('claude-code', 'DeepSeek V4 Pro', 'deepseek-v4-pro');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.profile.modelId).toBe('deepseek-v4-pro');
      expect(r.profile.runtime).toBe('claude-code');
    }
  });

  it('DeepSeek API requires specific model (not auto)', () => {
    const r = resolveExecutionProfile('claude-code', 'DeepSeek API', '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('specific model');
  });

  it('Qwen Code + any API-key provider = valid', () => {
    const r = resolveExecutionProfile('qwen-code', 'Some Provider', 'qwen-3.8-max');
    expect(r.ok).toBe(true);
  });

  it('empty runtime rejected', () => {
    expect(resolveExecutionProfile('', 'X', 'm').ok).toBe(false);
  });

  it('empty provider rejected', () => {
    expect(resolveExecutionProfile('codex', '', 'm').ok).toBe(false);
  });

  it('unknown runtime rejected', () => {
    expect(resolveExecutionProfile('vim', 'X', 'm').ok).toBe(false);
  });
});
