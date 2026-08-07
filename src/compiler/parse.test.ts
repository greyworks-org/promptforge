import { describe, it, expect } from 'vitest';
import { extractAndNormalize } from './parse';

describe('extractAndNormalize', () => {
  it('parses clean JSON', () => {
    const json = JSON.stringify({
      task_type: 'feature',
      execution_mode: 'standard',
      target_model: 'deepseek-v4-pro',
      agent_runtime: 'claude-code',
      execution_profile: 'deepseek-v4-pro-claude-code',
      objective: 'Add a login page.',
      scope: ['Create login form'],
      acceptance_criteria: ['User can log in'],
      risk_level: 'low',
    });
    const result = extractAndNormalize(json);
    expect(result.jsonFound).toBe(true);
    expect(result.data.objective).toBe('Add a login page.');
  });

  it('strips code fences', () => {
    const json = JSON.stringify({ task_type: 'bugfix', execution_mode: 'quick', target_model: 'gpt-5.6-sol', agent_runtime: 'codex', execution_profile: 'gpt-5.6-sol-high-codex', objective: 'Fix the button.', scope: ['Repair click handler'], acceptance_criteria: ['Button works'], risk_level: 'low' });
    const raw = '```json\n' + json + '\n```';
    const result = extractAndNormalize(raw);
    expect(result.jsonFound).toBe(true);
  });

  it('strips surrounding prose', () => {
    const json = JSON.stringify({ task_type: 'bugfix', execution_mode: 'quick', target_model: 'qwen-3.8-max', agent_runtime: 'qwen-code', execution_profile: 'qwen-3.8-max-qwen-code', objective: 'Fix the button.', scope: ['Repair click handler'], acceptance_criteria: ['Button works'], risk_level: 'low' });
    const raw = 'Here is the task:\n' + json + '\nHope this helps!';
    const result = extractAndNormalize(raw);
    expect(result.jsonFound).toBe(true);
  });

  it('strips client-owned keys', () => {
    const json = JSON.parse(JSON.stringify({
      task_id: 'TASK-2026-0001',
      project_id: 'project-evil',
      schema_version: '1.0.0',
      task_type: 'bugfix',
      execution_mode: 'quick',
      target_model: 'deepseek-v4-pro',
      agent_runtime: 'claude-code',
      execution_profile: 'deepseek-v4-pro-claude-code',
      objective: 'Fix the button.',
      scope: ['Repair click handler'],
      acceptance_criteria: ['Button works'],
      risk_level: 'low',
    }));
    const result = extractAndNormalize(JSON.stringify(json));
    expect(result.jsonFound).toBe(true);
    expect(result.data.task_id).toBeUndefined();
    expect(result.data.project_id).toBeUndefined();
    expect(result.data.schema_version).toBeUndefined();
    // Other fields preserved.
    expect(result.data.objective).toBe('Fix the button.');
  });

  it('defaults missing requirements to empty arrays', () => {
    const json = JSON.stringify({
      task_type: 'bugfix',
      execution_mode: 'quick',
      target_model: 'deepseek-v4-pro',
      agent_runtime: 'claude-code',
      execution_profile: 'deepseek-v4-pro-claude-code',
      objective: 'Fix the button.',
      scope: ['Repair click handler'],
      acceptance_criteria: ['Button works'],
      risk_level: 'low',
    });
    const result = extractAndNormalize(json);
    const req = result.data.requirements as Record<string, unknown>;
    expect(req).toBeDefined();
    expect(req.functional).toEqual([]);
    expect(req.frontend).toEqual([]);
    expect(req.backend).toEqual([]);
    expect(req.data).toEqual([]);
    expect(req.security).toEqual([]);
    expect(req.accessibility).toEqual([]);
    expect(req.performance).toEqual([]);
  });

  it('returns jsonFound:false for empty input', () => {
    const result = extractAndNormalize('');
    expect(result.jsonFound).toBe(false);
  });

  it('returns jsonFound:false for non-JSON prose', () => {
    const result = extractAndNormalize('Just some text, no JSON here.');
    expect(result.jsonFound).toBe(false);
  });

  it('returns jsonFound:false for malformed JSON', () => {
    const result = extractAndNormalize('{broken: yes}');
    expect(result.jsonFound).toBe(false);
  });

  it('handles JSON with only client-owned keys gracefully', () => {
    const json = JSON.stringify({
      task_id: 'TASK-2026-0001',
      project_id: 'p1',
      schema_version: '1.0.0',
    });
    const result = extractAndNormalize(json);
    expect(result.jsonFound).toBe(true);
    // All client keys stripped, requirements defaulted.
    expect(Object.keys(result.data)).toContain('requirements');
  });
});
