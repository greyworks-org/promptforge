import { describe, expect, it } from 'vitest';
import type { MemoryRecord } from '../src/db/repos/projectMemory';
import type { TaskSpec } from '../src/schemas/taskspec';
import type { GitSnapshot } from '../src/services/gitState';
import { emptyRuntimeBinding, type ExecutionSession } from '../src/sessions/types';
import { deriveContinuationState } from '../src/handoff/continuationState';
import { assembleSnapshot } from '../src/handoff/snapshot';
import { renderHandoffQwenCode } from '../src/handoff/renderQwenCode';
import { renderHandoffClaudeCode } from '../src/handoff/renderClaudeCode';
import {
  commitsAfterObservedHead,
  deriveWipAlignment,
  evidenceVocabulary,
  overlapRatio,
  taskVocabulary,
  tokenize,
  WIP_DRIFT_THRESHOLD,
} from '../src/handoff/wipReconciliation';

// Archived TaskSpec shape mirroring a stale DB record: an old UI task whose
// vocabulary shares nothing with a newer feature diff in the repository.
const archivedTask: TaskSpec = {
  schema_version: '1.1.0', task_id: 'TASK-2026-0001', project_id: 'project-offerpath',
  task_type: 'ui', execution_mode: 'standard', target_model: 'claude-sonnet-4-5',
  agent_runtime: 'claude-code', execution_profile: 'standard-claude-sonnet-4-5-claude-code',
  objective: 'Add a small dashboard status stating that Gmail tracking is not configured yet.',
  current_state: ['The repository contains an existing dashboard.'], relevant_context: [],
  assumptions: [], blocking_questions: [],
  scope: ['Render a compact status on the dashboard when Gmail tracking is unconfigured.', 'Preserve existing dashboard states.'],
  out_of_scope: ['Adding Gmail authentication or a new external API integration.'],
  requirements: { functional: ['The dashboard visibly communicates that Gmail tracking is not configured yet.'], frontend: [], backend: [], data: [], security: [], accessibility: [], performance: [] },
  edge_cases: [], acceptance_criteria: ['The dashboard displays "Gmail tracking is not configured yet." when unconfigured.'],
  execution_plan: [], test_plan: [], stop_conditions: ['Stop and ask before any destructive configuration change.'], final_report: [], risk_level: 'low',
};

const liveTaskVocabularyFixture: TaskSpec = {
  ...archivedTask,
  objective: 'Add a deterministic answer resolver for form prefill.',
  scope: ['Implement the deterministic answer resolver.'],
  acceptance_criteria: ['The answer resolver is deterministic.'],
  requirements: { functional: ['The prefill stage uses the deterministic answer resolver.'], frontend: [], backend: [], data: [], security: [], accessibility: [], performance: [] },
};

const memory: MemoryRecord = {
  projectId: 'project-offerpath', stack: ['TypeScript'], currentPhase: null, lastValidatedTaskId: null,
  currentTaskId: 'TASK-2026-0001', nextTask: null, decisions: [], blockers: [], relevantFiles: [],
  lastTest: null, baseCommit: 'base-commit', semanticContext: null, updatedAt: '2026-08-13T00:00:00Z',
};

const liveFeatureGit: GitSnapshot = {
  isRepo: true,
  head: { hash: 'd0368018e71341bb64162c1cc1c2dcd8fe4211c1', subject: 'feat: add deterministic answer resolver', committedAt: '2026-08-15T00:00:00Z' },
  branch: 'main',
  uncommitted: {
    staged: ['apps/worker/src/stages/prefill.ts'],
    unstaged: ['packages/browser/src/executor.ts'],
    untracked: [],
    diffStat: '2 files changed, 272 insertions(+), 11 deletions(-)',
  },
  diff: 'diff --git a/apps/worker/src/stages/prefill.ts b/apps/worker/src/stages/prefill.ts\ndiff --git a/packages/browser/src/executor.ts b/packages/browser/src/executor.ts',
  recentCommits: [
    { hash: 'd0368018e71341bb64162c1cc1c2dcd8fe4211c1', subject: 'feat: add deterministic answer resolver', committedAt: '2026-08-15T00:00:00Z' },
    { hash: '71eb064111111111111111111111111111111111', subject: 'docs: establish offerpath authority', committedAt: '2026-08-14T00:00:00Z' },
    { hash: '73b7752fffffffffffffffffffffffffffffffffffffff', subject: 'feat: refuse pages that are not forms', committedAt: '2026-08-14T00:00:00Z' },
    { hash: 'aaaabbbbccccdddd0000111122223333444455556666', subject: 'feat: complete the archived dashboard gmail status', committedAt: '2026-08-13T00:00:00Z' },
  ],
};

function session(overrides: Partial<ExecutionSession> = {}): ExecutionSession {
  return {
    id: 'session-1', projectId: 'project-offerpath', compilationId: 'comp-1', taskId: archivedTask.task_id,
    runtime: 'claude-code', binding: emptyRuntimeBinding(), userInstruction: '', status: 'reconciled',
    runtimeCwd: '/tmp/offerpath',
    state: { objective: archivedTask.objective, taskId: archivedTask.task_id, completed: [], pending: archivedTask.acceptance_criteria, decisions: [], blockers: [], relevantFiles: [], lastAction: null, lastValidation: null },
    baseCommit: 'base-commit', lastKnownHead: 'aaaabbbbccccdddd0000111122223333444455556666', recoveryReason: null,
    startedAt: '2026-08-13T00:00:00Z', lastActiveAt: '2026-08-13T00:00:00Z', endedAt: null,
    ...overrides,
  };
}

describe('WIP reconciliation primitives', () => {
  it('tokenizes only alphanumeric tokens of meaningful length', () => {
    expect(tokenize('feat: Add deterministic answer-resolver!')).toEqual(['feat', 'deterministic', 'answer', 'resolver']);
  });

  it('attributes only commits newer than the observed HEAD', () => {
    const commits = commitsAfterObservedHead(liveFeatureGit, 'aaaabbbbccccdddd0000111122223333444455556666');
    expect(commits.map((commit) => commit.subject)).toEqual([
      'feat: add deterministic answer resolver',
      'docs: establish offerpath authority',
      'feat: refuse pages that are not forms',
    ]);
    expect(commitsAfterObservedHead(liveFeatureGit, liveFeatureGit.head?.hash ?? null)).toEqual([]);
    expect(commitsAfterObservedHead(liveFeatureGit, null).length).toBe(4);
  });

  it('computes overlap relative to the evidence vocabulary', () => {
    const taskTokens = taskVocabulary(archivedTask);
    const drifted = evidenceVocabulary({ uncommittedFiles: ['apps/worker/src/stages/prefill.ts'], newCommits: [{ hash: 'd0368018', subject: 'feat: add deterministic answer resolver' }] });
    expect(overlapRatio(taskTokens, drifted)).toBeLessThan(WIP_DRIFT_THRESHOLD);
    const aligned = evidenceVocabulary({ uncommittedFiles: [], newCommits: [{ hash: 'x', subject: 'add the gmail dashboard tracking status' }] });
    expect(overlapRatio(taskTokens, aligned)).toBeGreaterThanOrEqual(WIP_DRIFT_THRESHOLD);
  });

  it('derives deterministic WIP focus and action items on drift', () => {
    const alignment = deriveWipAlignment({
      task: archivedTask,
      git: liveFeatureGit,
      changedFiles: ['apps/worker/src/stages/prefill.ts', 'packages/browser/src/executor.ts'],
      observedHead: session().lastKnownHead,
    });
    expect(alignment.mode).toBe('adopt-wip');
    expect(alignment.driftDetected).toBe(true);
    expect(alignment.objective).toContain('Complete and verify the live in-progress work');
    expect(alignment.objective).toContain('feat: add deterministic answer resolver');
    expect(alignment.evidence.join('\n')).toContain('uncommitted: apps/worker/src/stages/prefill.ts, packages/browser/src/executor.ts');
    expect(alignment.actionItems.join('\n')).toContain('Finish or explicitly park the uncommitted changes');
    expect(alignment.actionItems.join('\n')).toContain("Run the project's applicable test and validation commands");
  });

  it('keeps the archived task when live evidence matches its vocabulary', () => {
    const alignment = deriveWipAlignment({
      task: liveTaskVocabularyFixture,
      git: liveFeatureGit,
      changedFiles: ['apps/worker/src/stages/prefill.ts'],
      observedHead: session().lastKnownHead,
    });
    expect(alignment.mode).toBe('preserve-task');
    expect(alignment.driftDetected).toBe(false);
    expect(alignment.actionItems).toEqual([]);
  });

  it('honors explicit mode selection', () => {
    const base = {
      task: archivedTask,
      git: liveFeatureGit,
      changedFiles: ['apps/worker/src/stages/prefill.ts'],
      observedHead: session().lastKnownHead,
    };
    expect(deriveWipAlignment({ ...base, mode: 'preserve-task' }).mode).toBe('preserve-task');
    expect(deriveWipAlignment({ ...base, mode: 'adopt-wip', changedFiles: [], observedHead: 'd0368018e71341bb64162c1cc1c2dcd8fe4211c1' }).mode).toBe('preserve-task');
    expect(deriveWipAlignment({ ...base, task: null }).mode).toBe('preserve-task');
  });
});

describe('handoff prompt adaptation for live WIP drift', () => {
  function prompt(target: 'qwen' | 'claude', overrides: Partial<GitSnapshot> = {}, wipMode?: 'auto' | 'adopt-wip' | 'preserve-task') {
    const state = deriveContinuationState({
      task: archivedTask,
      session: session(),
      events: [],
      memory,
      git: { ...liveFeatureGit, ...overrides },
      wipMode,
    });
    const snapshot = assembleSnapshot({
      projectId: 'project-offerpath',
      projectName: 'Offerpath',
      repoPath: '/tmp/offerpath',
      memory,
      git: { ...liveFeatureGit, ...overrides },
      currentTask: archivedTask,
      continuationState: state,
    });
    return target === 'qwen' ? renderHandoffQwenCode(snapshot) : renderHandoffClaudeCode(snapshot);
  }

  it('adapts Current task, next action and acceptance to the live diff (drifted WIP)', () => {
    const qwen = prompt('qwen');
    expect(qwen).toContain('# Continue: Offerpath');
    expect(qwen).toContain('Live WIP adoption: Complete and verify the live in-progress work');
    expect(qwen).toContain('Archived task (canonical reference only): Add a small dashboard status stating that Gmail tracking is not configured yet. (TASK-2026-0001)');
    expect(qwen).toContain('Drift detected:');
    expect(qwen).toContain('feat: add deterministic answer resolver');
    expect(qwen).toContain('WIP DRIFT — archived task objective suppressed in favor of live work.');
    expect(qwen).toContain('Finish or explicitly park the uncommitted changes');
    expect(qwen).toContain('### Live WIP acceptance requiring verification');
    expect(qwen).toContain('### Archived acceptance (reference only)');
    const currentTaskIndex = qwen.indexOf('## Current task');
    const archivedIndex = qwen.indexOf('Add a small dashboard status stating that Gmail tracking is not configured yet.');
    const liveIndex = qwen.indexOf('feat: add deterministic answer resolver');
    expect(currentTaskIndex).toBeGreaterThan(-1);
    expect(liveIndex).toBeGreaterThan(currentTaskIndex);
    expect(archivedIndex).toBeGreaterThan(liveIndex);
  });

  it('preserves guardrails: scope lock, stop conditions and canonical reference survive adoption', () => {
    const claude = prompt('claude');
    expect(claude).toContain('## Scope lock');
    expect(claude).toContain('Stop condition: Stop and ask before any destructive configuration change.');
    expect(claude).toContain('Out of scope: Adding Gmail authentication or a new external API integration.');
    expect(claude).toContain('## Canonical TaskSpec reference');
    expect(claude).toContain('Finish or explicitly park the live work-in-progress before resuming archived TaskSpec work.');
    expect(claude).toContain('Do not redo completed work.');
  });

  it('reflects the same adoption in the Claude Code handoff prompt', () => {
    const claude = prompt('claude');
    expect(claude).toContain('# Resume: Offerpath');
    expect(claude).toContain('Live WIP adoption: Complete and verify the live in-progress work');
  });

  it('keeps the archived objective when the diff vocabulary matches the task', () => {
    const alignedGit: Partial<GitSnapshot> = {
      recentCommits: [
        { hash: 'feed000100010001000100010001000100010001', subject: 'feat: add the gmail tracking unconfigured dashboard status', committedAt: '2026-08-15T00:00:00Z' },
      ],
      uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' },
      diff: undefined,
    };
    const qwen = prompt('qwen', alignedGit);
    expect(qwen).toContain('Add a small dashboard status stating that Gmail tracking is not configured yet. (TASK-2026-0001)');
    expect(qwen).not.toContain('Live WIP adoption:');
    expect(qwen).toContain('PROJECT CHANGED OUTSIDE CURRENT SESSION');
  });

  it('supports explicit preserve-task selection for the same drifted repository', () => {
    const qwen = prompt('qwen', {}, 'preserve-task');
    expect(qwen).not.toContain('Live WIP adoption:');
    expect(qwen).toContain('Add a small dashboard status stating that Gmail tracking is not configured yet. (TASK-2026-0001)');
    expect(qwen).toContain('PROJECT CHANGED OUTSIDE CURRENT SESSION');
  });

  it('supports forcing adopt-wip even when vocabulary overlaps', () => {
    const alignedGit: Partial<GitSnapshot> = {
      recentCommits: [
        { hash: 'feed000100010001000100010001000100010001', subject: 'feat: add the gmail tracking unconfigured dashboard status', committedAt: '2026-08-15T00:00:00Z' },
      ],
      uncommitted: { staged: ['src/dashboard/gmailStatus.ts'], unstaged: [], untracked: [], diffStat: 'src/dashboard/gmailStatus.ts | 10 +' },
    };
    const qwen = prompt('qwen', alignedGit, 'adopt-wip');
    expect(qwen).toContain('Live WIP adoption:');
    expect(qwen).toContain('WIP DRIFT');
  });
});
