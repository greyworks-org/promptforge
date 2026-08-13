import { describe, expect, it } from 'vitest';
import type { TaskSpec } from '../schemas/taskspec';
import { renderClaudeCode } from '../renderers/renderClaudeCode';
import { renderQwenCode } from '../renderers/renderQwenCode';
import { renderCodex } from '../renderers/renderCodex';
import { PROFILES } from '../profiles/registry';
import { renderHandoffClaudeCode } from '../handoff/renderClaudeCode';
import { renderHandoffQwenCode } from '../handoff/renderQwenCode';
import { renderHandoffCodex } from '../handoff/renderCodex';
import { renderContinuationPackage } from '../handoff/crossModel';
import { assembleSnapshot } from '../handoff/snapshot';
import type { MemoryRecord } from '../db/repos/projectMemory';
import type { GitSnapshot } from './gitState';
import { deriveCompletionGate, deriveSessionFunctionalEvidence, resolveCompletionOutcome } from './completionGate';
import { taskSpecSchema } from '../schemas/taskspec';

function makeTask(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    schema_version: '1.1.0',
    task_id: 'TASK-2026-2001',
    project_id: 'project-slice-2',
    task_type: 'feature',
    execution_mode: 'standard',
    target_model: 'deepseek-v4-pro',
    agent_runtime: 'claude-code',
    execution_profile: 'deepseek-v4-pro-claude-code',
    objective: 'Add a bounded project feature without changing protected behavior.',
    current_state: [],
    relevant_context: [],
    assumptions: [],
    blocking_questions: [],
    scope: ['Add the requested feature path'],
    out_of_scope: ['Rewrite the unrelated billing subsystem'],
    requirements: { functional: [], frontend: [], backend: [], data: [], security: [], accessibility: [], performance: [] },
    edge_cases: [],
    acceptance_criteria: ['The requested feature works through its core user flow.'],
    execution_plan: [],
    test_plan: ['Run the focused feature test.'],
    stop_conditions: ['Stop before an irreversible migration.'],
    final_report: [],
    execution_contract: {
      core_loop: ['Open the feature', 'Complete the core user flow'],
      preserve: ['Preserve the existing project architecture and interfaces.'],
      verification: ['Verify the core flow against the existing project.'],
      delivery_slices: [
        { title: 'Current slice', scope: ['Add the requested feature path'], verification: ['Run the focused feature test.'] },
        { title: 'Later slice', scope: ['Add unrelated reporting'], verification: ['Run reporting tests.'] },
      ],
    },
    risk_level: 'medium',
    ...overrides,
  };
}

function evidenceFor(task: TaskSpec) {
  const gate = deriveCompletionGate(task);
  const values = (items: string[]) => Object.fromEntries(items.map((item) => [item, true]));
  return {
    acceptance: values(gate.acceptanceCriteria),
    functionalFlow: gate.functionalFlow.map((requirement) => ({
      requirement,
      status: 'VERIFIED' as const,
      evidence: `Fixture flow evidence for: ${requirement}`,
      source: 'flow' as const,
    })),
    coreLoop: values(gate.coreLoop),
    verification: values(gate.verification),
    qualityChecks: values(gate.qualityChecks),
    testPlan: values(gate.testPlan),
    humanReview: values(gate.humanReview),
  };
}

const profile = PROFILES['deepseek-v4-pro-claude-code'];

describe('PromptForge v1 Slice 2 scope lock and completion control', () => {
  it('renders explicit scope, preserve and out-of-scope boundaries for an existing-project feature', () => {
    const task = makeTask({
      execution_contract: {
        preserve: ['Preserve the existing project architecture and interfaces.'],
      },
    });
    const output = renderClaudeCode(task, profile);
    expect(output).toContain('## Scope lock');
    expect(output).toContain('Add the requested feature path');
    expect(output).toContain('Preserve the existing project architecture and interfaces.');
    expect(output).toContain('Rewrite the unrelated billing subsystem');
    expect(output).toContain('Do not perform unrelated cleanup, refactors, migrations, redesigns or dependency changes.');
  });

  it('instructs the agent to report an unrelated pre-existing failure instead of fixing it', () => {
    const output = renderQwenCode(makeTask(), profile);
    expect(output).toContain('A pre-existing unrelated failure is not permission to fix unrelated code; record it instead.');
    expect(output).toContain('OUT OF SCOPE\nFinding:\nImpact on current task:\nRequired to continue: yes/no');
  });

  it('does not resolve READY while a critical acceptance criterion is unresolved', () => {
    const task = makeTask();
    const result = resolveCompletionOutcome(task, {
      ...evidenceFor(task),
      acceptance: {},
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.unresolvedCritical).toContain('Acceptance: The requested feature works through its core user flow.');
  });

  it('only promotes directly recorded session requirements to functional evidence', () => {
    const task = makeTask();
    const evidence = deriveSessionFunctionalEvidence(task, {
      completed: ['Open the feature', 'The implementation should work.'],
      lastValidation: 'Complete the core user flow',
    });
    expect(evidence).toEqual([
      {
        requirement: 'Open the feature',
        status: 'VERIFIED',
        evidence: 'Open the feature',
        source: 'inspection',
      },
      {
        requirement: 'Complete the core user flow',
        status: 'VERIFIED',
        evidence: 'Complete the core user flow',
        source: 'inspection',
      },
    ]);
    expect(resolveCompletionOutcome(task, {
      ...evidenceFor(task),
      functionalFlow: evidence,
    }).status).toBe('READY');
  });

  it('resolves a technically complete UI task to NEEDS HUMAN REVIEW when subjective review remains', () => {
    const task = makeTask({
      task_type: 'ui',
      quality_profile: { completion_checks: ['Review the empty state.'], visual_review: true },
    });
    const { humanReview: _humanReview, ...objectiveEvidence } = evidenceFor(task);
    const result = resolveCompletionOutcome(task, objectiveEvidence);
    expect(result.status).toBe('NEEDS HUMAN REVIEW');
    expect(result.pendingHumanReview).toContain('Required product/visual review');
  });

  it('resolves a missing required dependency or decision to BLOCKED', () => {
    const task = makeTask();
    const result = resolveCompletionOutcome(task, {
      ...evidenceFor(task),
      blockers: ['The required migration decision is missing.'],
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.blockers).toEqual(['The required migration decision is missing.']);
  });

  it('resolves a fully verified bounded task to READY', () => {
    const task = makeTask();
    expect(resolveCompletionOutcome(task, evidenceFor(task)).status).toBe('READY');
  });

  it('does not automatically start later delivery slices', () => {
    const output = renderCodex(makeTask(), PROFILES['gpt-5.6-sol-high-codex']);
    expect(output).toContain('execute only the first safe slice unless directed otherwise');
    expect(output).toContain('Do not start a later delivery slice automatically.');
  });

  it('preserves the same scope and completion contract across runtime handoff renderers', () => {
    const memory: MemoryRecord = {
      projectId: 'project-slice-2', stack: ['TypeScript'], currentPhase: 'slice-2',
      lastValidatedTaskId: null, currentTaskId: 'TASK-2026-2001', nextTask: null,
      decisions: [], blockers: [], relevantFiles: [], lastTest: null, baseCommit: null,
      semanticContext: null, updatedAt: '2026-08-12T00:00:00Z',
    };
    const git: GitSnapshot = {
      isRepo: true, head: null,
      uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' }, branch: 'main',
    };
    const snapshot = assembleSnapshot({
      projectId: 'project-slice-2', projectName: 'Slice 2', repoPath: '/tmp/slice-2',
      memory, git, currentTask: makeTask(),
    });
    for (const output of [
      renderHandoffClaudeCode(snapshot),
      renderHandoffQwenCode(snapshot),
      renderHandoffCodex(snapshot),
    ]) {
      expect(output).toContain('## Scope lock');
      expect(output).toContain('## Completion control');
      expect(output).toContain('Preserve the existing project architecture and interfaces.');
      expect(output).toContain('The requested feature works through its core user flow.');
    }
    const crossModel = renderContinuationPackage({
      repository: '/tmp/slice-2',
      task: { id: 'TASK-2026-2001', goal: makeTask().objective },
      currentStatus: 'active', observedCompleted: [], observedPartial: [], decisions: [],
      constraints: [], checkpointNotes: [], changedFiles: [], validationEvidence: [],
      acceptanceRequiringVerification: [], knownBlockers: [], immediateNextAction: 'Continue safely.',
      projectStateReferences: ['AGENTS.md'],
      sourceExecution: { sessionId: 'source', runtime: 'claude-code', providerId: null, modelId: 'source-model', modelRef: null },
      targetExecution: { sessionId: 'target', runtime: 'opencode', providerId: 'openrouter', modelId: 'target-model', modelRef: 'openrouter/target-model' },
      instruction: 'Continue the bounded task.',
    }, makeTask());
    expect(crossModel).toContain('## Scope lock');
    expect(crossModel).toContain('## Completion control');
    expect(crossModel).toContain('Functional golden-path verification (required when runnable):');
  });

  it('does not add visual completion requirements to backend-only tasks', () => {
    const task = makeTask({ task_type: 'backend', quality_profile: undefined });
    const output = renderClaudeCode(task, profile).toLowerCase();
    expect(output).not.toContain('visual review');
    expect(output).not.toContain('subjective product/visual review');
  });

  it('keeps older stored TaskSpecs valid and preserves derived behavior when optional fields are absent', () => {
    const legacy = taskSpecSchema.parse({
      ...makeTask(),
      execution_contract: undefined,
      quality_profile: undefined,
    });
    expect(resolveCompletionOutcome(legacy, {
      acceptance: { [legacy.acceptance_criteria[0]]: true },
      testPlan: { [legacy.test_plan[0]]: true },
    }).status).toBe('READY');
    expect(renderCodex(legacy, PROFILES['gpt-5.6-sol-high-codex'])).toContain('## Completion control');
  });
});
