import { describe, it, expect } from 'vitest';
import { deriveChecklist } from './checklist';
import type { TaskSpec } from '../schemas/taskspec';

const baseTask: TaskSpec = {
  schema_version: '1.1.0',
  task_id: 'TASK-2026-0001',
  project_id: 'project-test',
  task_type: 'feature',
  execution_mode: 'standard',
  target_model: 'deepseek-v4-pro',
  agent_runtime: 'claude-code',
  execution_profile: 'deepseek-v4-pro-claude-code',
  objective: 'Add a login page.',
  scope: ['Create login form'],
  acceptance_criteria: ['User can log in'],
  risk_level: 'medium',
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

describe('deriveChecklist', () => {
  it('produces checklist items', () => {
    const items = deriveChecklist(baseTask);
    expect(items.length).toBeGreaterThan(0);
  });

  it('flags missing out-of-scope items', () => {
    const items = deriveChecklist(baseTask);
    const oosItem = items.find((i) => i.label.includes('Out-of-scope'));
    expect(oosItem).toBeDefined();
    expect(oosItem!.ok).toBe(false); // no out_of_scope defined
  });

  it('accepts when out-of-scope is defined', () => {
    const task: TaskSpec = { ...baseTask, out_of_scope: ['Do not touch billing'] };
    const items = deriveChecklist(task);
    const oosItem = items.find((i) => i.label.includes('Out-of-scope'));
    expect(oosItem!.ok).toBe(true);
  });

  it('flags assumptions as warnings', () => {
    const task: TaskSpec = { ...baseTask, assumptions: ['Use existing components'] };
    const items = deriveChecklist(task);
    const asItem = items.find((i) => i.label.includes('assumption'));
    expect(asItem).toBeDefined();
    expect(asItem!.ok).toBe(false); // assumptions exist → warning
  });

  it('accepts when no assumptions', () => {
    const items = deriveChecklist(baseTask);
    const asItem = items.find((i) => i.label.includes('No assumptions'));
    expect(asItem).toBeDefined();
    expect(asItem!.ok).toBe(true);
  });

  it('flags missing edge cases', () => {
    const items = deriveChecklist(baseTask);
    const ecItem = items.find((i) => i.label.includes('Edge cases'));
    expect(ecItem!.ok).toBe(false);
  });

  it('accepts when edge cases are defined', () => {
    const task: TaskSpec = { ...baseTask, edge_cases: ['Expired tokens'] };
    const items = deriveChecklist(task);
    const ecItem = items.find((i) => i.label.includes('Edge cases'));
    expect(ecItem!.ok).toBe(true);
  });

  it('requires execution plan for deep mode', () => {
    const task: TaskSpec = { ...baseTask, execution_mode: 'deep' };
    const items = deriveChecklist(task);
    const epItem = items.find((i) => i.label.includes('Execution plan'));
    expect(epItem).toBeDefined();
    expect(epItem!.ok).toBe(false); // no execution plan
  });

  it('does not require execution plan for quick mode', () => {
    const task: TaskSpec = { ...baseTask, execution_mode: 'quick' };
    const items = deriveChecklist(task);
    const epItem = items.find((i) => i.label.includes('Execution plan'));
    expect(epItem).toBeUndefined();
  });

  it('flags missing test plan', () => {
    const items = deriveChecklist(baseTask);
    const tpItem = items.find((i) => i.label.includes('Test plan'));
    expect(tpItem!.ok).toBe(false);
  });

  it('never produces a numeric score', () => {
    const items = deriveChecklist(baseTask);
    for (const item of items) {
      expect(item.label).not.toMatch(/\d+\/\d+/);
      expect(item.label).not.toMatch(/score/i);
    }
    // No numeric aggregate.
    expect(items).not.toContainEqual(
      expect.objectContaining({ label: expect.stringMatching(/^\d/) }),
    );
  });

  it('all items have boolean ok', () => {
    const items = deriveChecklist(baseTask);
    for (const item of items) {
      expect(typeof item.ok).toBe('boolean');
    }
  });
});
