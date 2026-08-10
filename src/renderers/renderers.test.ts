import { describe, it, expect } from 'vitest';
import { renderClaudeCode } from './renderClaudeCode';
import { renderQwenCode } from './renderQwenCode';
import { renderCodex } from './renderCodex';
import { PROFILES } from '../profiles/registry';
import type { TaskSpec } from '../schemas/taskspec';

const FEATURE_TASK: TaskSpec = {
  schema_version: '1.1.0',
  task_id: 'TASK-2026-0042',
  project_id: 'project-test',
  task_type: 'feature',
  execution_mode: 'standard',
  target_model: 'deepseek-v4-pro',
  agent_runtime: 'claude-code',
  execution_profile: 'deepseek-v4-pro-claude-code',
  objective: 'Authenticated users can view their AI credit usage.',
  user_value: 'Users understand remaining usage before reaching the limit.',
  current_state: [
    'Authentication already exists',
    'Stripe subscription records are stored in Supabase',
  ],
  relevant_context: ['DESIGN.md', 'DATA_MODEL.md', 'INTEGRATIONS.md'],
  assumptions: ['Use the existing dashboard card components.'],
  blocking_questions: [],
  scope: [
    'Create the usage page',
    'Show plan, consumed credits and renewal date',
    'Add loading, empty and error states',
  ],
  out_of_scope: ['Creating new Stripe prices', 'Admin reporting'],
  requirements: {
    functional: [],
    frontend: ['Reuse existing card components'],
    backend: [],
    data: [],
    security: ['Verify authentication before showing data'],
    accessibility: [],
    performance: [],
  },
  edge_cases: ['Expired sessions', 'Zero credits remaining'],
  acceptance_criteria: [
    'Usage page renders plan, consumed credits and renewal date for logged-in user',
  ],
  execution_plan: ['Create usage page component', 'Add API route', 'Wire up billing data'],
  test_plan: ['Unit test the usage component', 'Integration test the billing flow'],
  stop_conditions: ['Do not modify Stripe billing logic'],
  final_report: ['Changed files', 'Test results', 'Assumptions'],
  risk_level: 'medium',
  confidence: 0.87,
  estimated_prompt_tokens: 1450,
};

const BUGFIX_TASK: TaskSpec = {
  schema_version: '1.1.0',
  task_id: 'TASK-2026-0001',
  project_id: 'project-test',
  task_type: 'bugfix',
  execution_mode: 'quick',
  target_model: 'qwen-3.8-max',
  agent_runtime: 'qwen-code',
  execution_profile: 'qwen-3.8-max-qwen-code',
  objective: 'Fix the login button not responding on the settings page.',
  scope: ['Repair the login button click handler on the settings page'],
  acceptance_criteria: ['Login button submits the form from the settings page'],
  risk_level: 'low',
  current_state: [],
  relevant_context: [],
  assumptions: [],
  blocking_questions: [],
  out_of_scope: [],
  requirements: { functional:[], frontend:[], backend:[], data:[], security:[], accessibility:[], performance:[] },
  edge_cases: [],
  execution_plan: [],
  test_plan: [],
  stop_conditions: [],
  final_report: [],
};

const primaryProfile = PROFILES['deepseek-v4-pro-claude-code'];
const qwenProfile = PROFILES['qwen-3.8-max-qwen-code'];
const codexProfile = PROFILES['gpt-5.6-sol-high-codex'];
const opusProfile = PROFILES['opus-5-high-claude-code'];

describe('renderClaudeCode', () => {
  it('produces a non-empty string', () => {
    const output = renderClaudeCode(FEATURE_TASK, primaryProfile);
    expect(output.length).toBeGreaterThan(100);
  });

  it('includes the objective', () => {
    const output = renderClaudeCode(FEATURE_TASK, primaryProfile);
    expect(output).toContain('AI credit usage');
  });

  it('includes scope items', () => {
    const output = renderClaudeCode(FEATURE_TASK, primaryProfile);
    expect(output).toContain('Create the usage page');
  });

  it('includes assumptions verbatim with Assumption: prefix', () => {
    const output = renderClaudeCode(FEATURE_TASK, primaryProfile);
    expect(output).toContain('Assumption: Use the existing dashboard card components.');
  });

  it('includes stop conditions', () => {
    const output = renderClaudeCode(FEATURE_TASK, primaryProfile);
    expect(output).toContain('Do not modify Stripe billing logic');
  });

  it('includes CLAUDE.md + AGENTS.md reference', () => {
    const output = renderClaudeCode(FEATURE_TASK, primaryProfile);
    expect(output).toContain('CLAUDE.md');
    expect(output).toContain('AGENTS.md');
  });

  it('is deterministic — same input, byte-identical output', () => {
    const a = renderClaudeCode(FEATURE_TASK, primaryProfile);
    const b = renderClaudeCode(FEATURE_TASK, primaryProfile);
    expect(a).toBe(b);
  });

  it('planning depth minimal skips implementation plan', () => {
    const minimalProfile = { ...primaryProfile, planning_depth: 'minimal' as const };
    const output = renderClaudeCode(FEATURE_TASK, minimalProfile);
    expect(output).not.toContain('implementation plan covering');
  });

  it('adapts to different profiles without changing task meaning', () => {
    const a = renderClaudeCode(FEATURE_TASK, primaryProfile);
    const b = renderClaudeCode(FEATURE_TASK, opusProfile);
    // Both contain the same objective (task meaning unchanged).
    expect(a).toContain('AI credit usage');
    expect(b).toContain('AI credit usage');
    // But they differ in style (profile adaptation).
    expect(a).not.toBe(b);
  });
});

describe('renderQwenCode', () => {
  it('produces a non-empty string', () => {
    const output = renderQwenCode(FEATURE_TASK, qwenProfile);
    expect(output.length).toBeGreaterThan(100);
  });

  it('includes QWEN.md + AGENTS.md references', () => {
    const output = renderQwenCode(FEATURE_TASK, qwenProfile);
    expect(output).toContain('QWEN.md');
    expect(output).toContain('AGENTS.md');
  });

  it('includes Read first section with context paths', () => {
    const output = renderQwenCode(FEATURE_TASK, qwenProfile);
    expect(output).toContain('Read first');
    expect(output).toContain('DESIGN.md');
  });

  it('includes execution rules with numbered steps for deep/high-risk', () => {
    const deepTask = { ...FEATURE_TASK, execution_mode: 'deep' as const, risk_level: 'high' as const };
    const output = renderQwenCode(deepTask, qwenProfile);
    expect(output).toContain('Execution rules');
    expect(output).toContain('1.');
    expect(output).toContain('Inspect');
  });

  it('is deterministic', () => {
    const a = renderQwenCode(FEATURE_TASK, qwenProfile);
    const b = renderQwenCode(FEATURE_TASK, qwenProfile);
    expect(a).toBe(b);
  });

  it('works with minimal task', () => {
    const output = renderQwenCode(BUGFIX_TASK, qwenProfile);
    expect(output.length).toBeGreaterThan(50);
    expect(output).toContain('login button');
  });
});

describe('renderCodex', () => {
  it('produces a non-empty string', () => {
    const output = renderCodex(FEATURE_TASK, codexProfile);
    expect(output.length).toBeGreaterThan(100);
  });

  it('includes AGENTS.md reference', () => {
    const output = renderCodex(FEATURE_TASK, codexProfile);
    expect(output).toContain('AGENTS.md');
  });

  it('is outcome-first — objective appears early', () => {
    const output = renderCodex(FEATURE_TASK, codexProfile);
    const idx = output.indexOf('AI credit usage');
    expect(idx).toBeGreaterThan(0);
    expect(idx).toBeLessThan(300);
  });

  it('includes report requirements', () => {
    const output = renderCodex(FEATURE_TASK, codexProfile);
    expect(output).toContain('files changed');
    expect(output).toContain('test results');
    expect(output).toContain('remaining risks');
  });

  it('is deterministic', () => {
    const a = renderCodex(FEATURE_TASK, codexProfile);
    const b = renderCodex(FEATURE_TASK, codexProfile);
    expect(a).toBe(b);
  });
});

describe('cross-runtime semantic equivalence', () => {
  it('all renderers include the objective verbatim', () => {
    const claude = renderClaudeCode(FEATURE_TASK, primaryProfile);
    const qwen = renderQwenCode(FEATURE_TASK, qwenProfile);
    const codex = renderCodex(FEATURE_TASK, codexProfile);
    expect(claude).toContain('AI credit usage');
    expect(qwen).toContain('AI credit usage');
    expect(codex).toContain('AI credit usage');
  });

  it('all renderers include all scope items', () => {
    const claude = renderClaudeCode(FEATURE_TASK, primaryProfile);
    const qwen = renderQwenCode(FEATURE_TASK, qwenProfile);
    const codex = renderCodex(FEATURE_TASK, codexProfile);
    for (const item of FEATURE_TASK.scope) {
      expect(claude).toContain(item);
      expect(qwen).toContain(item);
      expect(codex).toContain(item);
    }
  });

  it('all renderers include acceptance criteria', () => {
    const claude = renderClaudeCode(FEATURE_TASK, primaryProfile);
    const qwen = renderQwenCode(FEATURE_TASK, qwenProfile);
    const codex = renderCodex(FEATURE_TASK, codexProfile);
    for (const ac of FEATURE_TASK.acceptance_criteria) {
      expect(claude).toContain(ac);
      expect(qwen).toContain(ac);
      expect(codex).toContain(ac);
    }
  });

  it('no renderer invents content not in TaskSpec', () => {
    // Property: rendered output must not contain words that aren't in the TaskSpec
    // or the profile definition or the fixed template text.
    const claude = renderClaudeCode(FEATURE_TASK, primaryProfile);
    // The renderer should NOT invent "Add OAuth" (not in scope).
    expect(claude).not.toContain('Add OAuth');
    // Should NOT invent "JWT" (not in requirements).
    expect(claude).not.toContain('JWT authentication');
  });

  it('heading injection is sanitized', () => {
    const maliciousTask: TaskSpec = {
      ...FEATURE_TASK,
      scope: ['# Fake heading injection'],
      objective: 'Fix button.',
    };
    const output = renderClaudeCode(maliciousTask, primaryProfile);
    // The `#` should be indented within the bullet, not start a raw heading line.
    const lines = output.split('\n');
    let found = false;
    for (const line of lines) {
      if (line.includes('Fake heading')) {
        // Bullet item: "-   # Fake..." or similar — should NOT be a raw heading.
        expect(line.trimStart().startsWith('#')).toBe(false);
        expect(line.includes('  #')).toBe(true);
        found = true;
      }
    }
    expect(found).toBe(true);
  });
});
