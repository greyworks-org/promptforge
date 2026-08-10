import { describe, it, expect, beforeEach } from 'vitest';
import { enrich, generateTaskId, resetTaskCounterForTests } from './enrich';
import type { CompilerOutput } from '../schemas/compilerOutput';

const validCO: CompilerOutput = {
  task_type: 'feature',
  execution_mode: 'standard',
  target_model: 'deepseek-v4-pro',
  agent_runtime: 'claude-code',
  execution_profile: 'deepseek-v4-pro-claude-code',
  objective: 'Authenticated users can view their AI credit usage.',
  scope: ['Create the usage page'],
  acceptance_criteria: ['Usage page renders for logged-in user'],
  risk_level: 'medium',
  current_state: [],
  relevant_context: [],
  assumptions: [],
  blocking_questions: [],
  out_of_scope: [],
  requirements: {
    functional: [],
    frontend: [],
    backend: [],
    data: [],
    security: [],
    accessibility: [],
    performance: [],
  },
  edge_cases: [],
  execution_plan: [],
  test_plan: [],
  stop_conditions: [],
  final_report: [],
};

describe('generateTaskId', () => {
  beforeEach(() => {
    resetTaskCounterForTests(41);
  });

  it('generates sequential TASK-YYYY-NNNN ids', () => {
    const id1 = generateTaskId();
    const id2 = generateTaskId();
    expect(id1).toMatch(/^TASK-\d{4}-0042$/);
    expect(id2).toMatch(/^TASK-\d{4}-0043$/);
  });

  it('pads sequence to 4 digits', () => {
    resetTaskCounterForTests(7);
    expect(generateTaskId()).toMatch(/TASK-\d{4}-0008$/);
  });
});

describe('enrich', () => {
  beforeEach(() => {
    resetTaskCounterForTests(0);
  });

  it('produces a valid TaskSpec with all required fields', () => {
    const ts = enrich({ compilerOutput: validCO, projectId: 'project-demo' });

    expect(ts.schema_version).toBe('1.1.0');
    expect(ts.task_id).toMatch(/^TASK-\d{4}-0001$/);
    expect(ts.project_id).toBe('project-demo');
    expect(ts.task_type).toBe('feature');
    expect(ts.execution_mode).toBe('standard');
    expect(ts.target_model).toBe('deepseek-v4-pro');
    expect(ts.agent_runtime).toBe('claude-code');
    expect(ts.execution_profile).toBe('deepseek-v4-pro-claude-code');
    expect(ts.objective).toBe(validCO.objective);
    expect(ts.scope).toEqual(validCO.scope);
    expect(ts.acceptance_criteria).toEqual(validCO.acceptance_criteria);
    expect(ts.risk_level).toBe('medium');
    // Enrichment-added fields.
    expect(ts.estimated_prompt_tokens).toBeGreaterThan(0);
  });

  it('passes through optional fields', () => {
    const co: CompilerOutput = {
      ...validCO,
      user_value: 'Users need to know their limits.',
      current_state: ['Auth exists'],
      relevant_context: ['DESIGN.md'],
      assumptions: ['Existing components reused'],
      blocking_questions: ['Which billing provider?'],
      out_of_scope: ['Admin reporting'],
      edge_cases: ['Expired sessions'],
      execution_plan: ['Create component', 'Add route'],
      test_plan: ['Unit test the page'],
      stop_conditions: ['Do not modify billing'],
      final_report: ['Changed files', 'Test results'],
      confidence: 0.9,
    };

    const ts = enrich({ compilerOutput: co, projectId: 'p1' });
    expect(ts.user_value).toBe('Users need to know their limits.');
    expect(ts.current_state).toEqual(['Auth exists']);
    expect(ts.relevant_context).toEqual(['DESIGN.md']);
    expect(ts.assumptions).toEqual(['Existing components reused']);
    expect(ts.blocking_questions).toEqual(['Which billing provider?']);
    expect(ts.out_of_scope).toEqual(['Admin reporting']);
    expect(ts.edge_cases).toEqual(['Expired sessions']);
    expect(ts.execution_plan).toEqual(['Create component', 'Add route']);
    expect(ts.test_plan).toEqual(['Unit test the page']);
    expect(ts.stop_conditions).toEqual(['Do not modify billing']);
    expect(ts.final_report).toEqual(['Changed files', 'Test results']);
    expect(ts.confidence).toBe(0.9);
  });

  it('normalizes inverted destructive database safety wording', () => {
    const ts = enrich({
      compilerOutput: {
        ...validCO,
        stop_conditions: ['Any destructive database changes are required without approval'],
      },
      projectId: 'p1',
    });
    expect(ts.stop_conditions).toEqual([
      'Do not make destructive database changes without explicit approval.',
    ]);
  });

  it('is deterministic — same input → same output', () => {
    resetTaskCounterForTests(99);
    const a = enrich({ compilerOutput: validCO, projectId: 'p1' });
    resetTaskCounterForTests(99);
    const b = enrich({ compilerOutput: validCO, projectId: 'p1' });
    expect(a).toEqual(b);
  });
});
