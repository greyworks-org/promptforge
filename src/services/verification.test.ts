import { describe, expect, it } from 'vitest';
import type { TaskSpec } from '../schemas/taskspec';
import { resolveCompletionOutcome } from './completionGate';
import {
  buildCorrectivePass,
  buildVisualReviewRequest,
  deriveFunctionalVerificationPlan,
  isVisualReviewApplicable,
  parseVisualReviewOutput,
} from './verification';

function makeTask(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    schema_version: '1.1.0',
    task_id: 'TASK-2026-3001',
    project_id: 'project-slice-3',
    task_type: 'feature',
    execution_mode: 'standard',
    target_model: 'deepseek-v4-pro',
    agent_runtime: 'claude-code',
    execution_profile: 'deepseek-v4-pro-claude-code',
    objective: 'Add a bounded feature with a demonstrable core flow.',
    current_state: [], relevant_context: [], assumptions: [], blocking_questions: [],
    scope: ['Add the feature flow'],
    out_of_scope: ['Rewrite unrelated account settings'],
    requirements: { functional: [], frontend: ['Render the feature state.'], backend: [], data: [], security: [], accessibility: [], performance: [] },
    edge_cases: [],
    acceptance_criteria: ['The feature produces the expected result.'],
    execution_plan: [], test_plan: ['Run the focused feature test.'],
    stop_conditions: [], final_report: [],
    execution_contract: {
      core_loop: ['Submit the input', 'Show the expected result'],
      preserve: ['Preserve the existing navigation and data boundary.'],
      verification: ['Verify the failed-input state.'],
    },
    risk_level: 'medium',
    ...overrides,
  };
}

function objectiveEvidence(task: TaskSpec) {
  return {
    acceptance: Object.fromEntries(task.acceptance_criteria.map((item) => [item, true])),
    coreLoop: Object.fromEntries((task.execution_contract?.core_loop ?? []).map((item) => [item, true])),
    verification: Object.fromEntries((task.execution_contract?.verification ?? []).map((item) => [item, true])),
    testPlan: Object.fromEntries(task.test_plan.map((item) => [item, true])),
  };
}

function flowEvidence(task: TaskSpec, status: 'VERIFIED' | 'NOT VERIFIED' = 'VERIFIED') {
  return (task.execution_contract?.core_loop ?? []).map((requirement) => ({
    requirement,
    status,
    evidence: status === 'VERIFIED' ? `Observed runtime result for ${requirement}.` : 'The flow could not be demonstrated in this environment.',
    source: 'flow' as const,
  }));
}

describe('Slice 3 real verification and bounded corrective pass', () => {
  it('does not resolve READY when a required feature core flow has no functional evidence', () => {
    const task = makeTask();
    const result = resolveCompletionOutcome(task, objectiveEvidence(task));
    expect(result.status).toBe('BLOCKED');
    expect(result.unresolvedCritical).toContain('Functional flow: Submit the input');
  });

  it('allows verified core-flow evidence to contribute to READY', () => {
    const task = makeTask();
    const result = resolveCompletionOutcome(task, {
      ...objectiveEvidence(task),
      functionalFlow: flowEvidence(task),
    });
    expect(result.status).toBe('READY');
  });

  it('does not treat weak claims as direct verification evidence', () => {
    const task = makeTask();
    const result = resolveCompletionOutcome(task, {
      ...objectiveEvidence(task),
      functionalFlow: [{
        requirement: 'Submit the input',
        status: 'VERIFIED',
        evidence: 'The flow should work based on the implementation.',
        source: 'inspection',
      }, ...flowEvidence(task).slice(1)],
    });
    expect(result.status).toBe('BLOCKED');
  });

  it('does not invent a golden path for docs/config-only work', () => {
    const task = makeTask({
      task_type: 'feature',
      scope: ['Update README.md and config.json'],
      execution_contract: undefined,
      requirements: { functional: [], frontend: [], backend: [], data: [], security: [], accessibility: [], performance: [] },
    });
    const plan = deriveFunctionalVerificationPlan(task);
    expect(plan.applicable).toBe(false);
    expect(plan.requirements).toEqual([]);
    expect(resolveCompletionOutcome(task, objectiveEvidence(task)).status).toBe('READY');
  });

  it('does not invoke visual QA when visual_review is false', () => {
    const task = makeTask({ quality_profile: { visual_review: false } });
    expect(isVisualReviewApplicable(task)).toBe(false);
    expect(buildVisualReviewRequest(task, '/tmp/feature.png')).toBeNull();
  });

  it('requires visual evidence for a rendered UI task when visual_review is true', () => {
    const task = makeTask({ task_type: 'ui', quality_profile: { visual_review: true } });
    const withoutVisual = resolveCompletionOutcome(task, {
      ...objectiveEvidence(task),
      functionalFlow: flowEvidence(task),
    });
    expect(withoutVisual.status).toBe('NEEDS HUMAN REVIEW');

    const withVisual = resolveCompletionOutcome(task, {
      ...objectiveEvidence(task),
      functionalFlow: flowEvidence(task),
      visualReview: { status: 'PASS', issues: [], evidence: 'Rendered UI reviewed.', source: 'qwen-mm-plugins-core' },
    });
    expect(withVisual.status).toBe('READY');
  });

  it('creates a bounded corrective instruction from a visual FAIL', () => {
    const task = makeTask({ task_type: 'ui', quality_profile: { visual_review: true, anti_slop: ['Avoid duplicated labels.'] } });
    const visualFail = parseVisualReviewOutput('FAIL\n1. The filter label appears twice in the rendered surface.');
    const pass = buildCorrectivePass(task, visualFail.issues.map((issue) => ({
      requirement: 'Duplicated labels/content', evidence: issue,
      relevantFiles: ['src/components/FeaturePanel.tsx'],
    })), 0);
    expect(pass.allowed).toBe(true);
    expect(pass.instruction).toContain('Duplicated labels/content');
    expect(pass.instruction).toContain('The filter label appears twice');
    expect(pass.instruction).toContain('src/components/FeaturePanel.tsx');
    expect(pass.instruction).not.toContain(task.objective);
    expect(pass.instruction).not.toContain('The feature produces the expected result.');
  });

  it('allows at most one automatic corrective pass', () => {
    const task = makeTask();
    const failure = [{ requirement: 'Submit the input', evidence: 'The result did not appear.' }];
    expect(buildCorrectivePass(task, failure, 0).allowed).toBe(true);
    expect(buildCorrectivePass(task, failure, 1)).toEqual({ allowed: false, attempt: 1, instruction: null });
    expect(buildCorrectivePass(task, failure, 2).allowed).toBe(false);
  });

  it('keeps a remaining critical functional failure from becoming READY after correction', () => {
    const task = makeTask();
    const result = resolveCompletionOutcome(task, {
      ...objectiveEvidence(task),
      functionalFlow: flowEvidence(task, 'NOT VERIFIED'),
    });
    expect(result.status).toBe('BLOCKED');
  });

  it('does not request visual review for backend-only work', () => {
    const task = makeTask({ task_type: 'backend', quality_profile: { visual_review: true } });
    expect(isVisualReviewApplicable(task)).toBe(false);
    expect(buildVisualReviewRequest(task, '/tmp/backend.png')).toBeNull();
  });

  it('uses structured Qwen-MM criteria rather than generic aesthetic judgment', () => {
    const task = makeTask({ task_type: 'ui', quality_profile: { visual_review: true, anti_slop: ['Avoid duplicated labels.'] } });
    const request = buildVisualReviewRequest(task, '/tmp/feature.png', ['Use the existing project layout.']);
    expect(request).not.toBeNull();
    expect(request!.capability).toBe('qwen-mm-plugins-core');
    expect(request!.tool).toBe('read_image');
    expect(request!.criteria).toContain('Hierarchy');
    expect(request!.criteria).toContain('Avoid duplicated labels.');
    expect(request!.instruction).not.toContain('Does this look good?');
    expect(parseVisualReviewOutput('PASS').status).toBe('PASS');
    expect(parseVisualReviewOutput('FAIL\n1. The filter label is duplicated.').issues).toEqual(['The filter label is duplicated.']);
    expect(parseVisualReviewOutput('FAIL\n1. One\n2. Two\n3. Three\n4. Four\n5. Five\n6. Six').issues).toHaveLength(5);
  });

  it('keeps Slice 2 outcomes backward compatible for non-visual tasks', () => {
    const task = makeTask({ execution_contract: undefined, quality_profile: undefined });
    expect(resolveCompletionOutcome(task, objectiveEvidence(task)).status).toBe('READY');
    expect(resolveCompletionOutcome(task, { ...objectiveEvidence(task), blockers: ['Missing decision.'] }).status).toBe('BLOCKED');
    expect(resolveCompletionOutcome(task, { ...objectiveEvidence(task), humanReviewPending: ['User decision remains.'] }).status).toBe('NEEDS HUMAN REVIEW');
  });

  it('runs a deterministic end-to-end TaskSpec → evidence → outcome fixture', () => {
    const task = makeTask({ task_type: 'ui', quality_profile: { visual_review: true } });
    const visualRequest = buildVisualReviewRequest(task, '/tmp/feature.png');
    const visualEvidence = parseVisualReviewOutput('PASS');
    const result = resolveCompletionOutcome(task, {
      ...objectiveEvidence(task),
      functionalFlow: flowEvidence(task),
      visualReview: visualEvidence,
    });
    expect(visualRequest?.criteria.length).toBeGreaterThan(5);
    expect(result.status).toBe('READY');
  });
});
