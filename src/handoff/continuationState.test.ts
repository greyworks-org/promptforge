import { describe, expect, it } from 'vitest';
import type { MemoryRecord } from '../db/repos/projectMemory';
import type { TaskSpec } from '../schemas/taskspec';
import type { GitSnapshot } from '../services/gitState';
import { emptyRuntimeBinding, type ExecutionSession, type SessionEvent } from '../sessions/types';
import { deriveContinuationState } from './continuationState';
import { renderCurrentContinuation } from './renderCurrentState';
import { assembleSnapshot } from './snapshot';
import { renderHandoffClaudeCode } from './renderClaudeCode';
import { renderHandoffQwenCode } from './renderQwenCode';
import { renderHandoffCodex } from './renderCodex';

const task: TaskSpec = {
  schema_version: '1.1.0', task_id: 'task-continuity', project_id: 'project-continuity',
  task_type: 'feature', execution_mode: 'standard', target_model: 'luna-5.6-high',
  agent_runtime: 'claude-code', execution_profile: 'deepseek-v4-pro-claude-code',
  objective: 'Finish the continuity slice.', current_state: [], relevant_context: [],
  assumptions: [], blocking_questions: [], scope: ['Implement one', 'Implement two', 'Implement three', 'Implement four'],
  out_of_scope: ['Rewrite the runtime architecture'], requirements: { functional: [], frontend: [], backend: [], data: [], security: [], accessibility: [], performance: [] },
  edge_cases: [], acceptance_criteria: ['Acceptance one', 'Acceptance two', 'Acceptance three', 'Acceptance four'],
  execution_plan: [], test_plan: [], stop_conditions: ['Stop on an unsafe migration.'], final_report: [], risk_level: 'low',
};

const memory: MemoryRecord = {
  projectId: 'project-continuity', stack: ['TypeScript'], currentPhase: 'continuity', lastValidatedTaskId: null,
  currentTaskId: 'task-continuity', nextTask: null, decisions: [{ text: 'Preserve the existing session identity.', at: '2026-08-13T00:00:00Z' }],
  blockers: [], relevantFiles: ['src/handoff'], lastTest: null, baseCommit: 'base-head', semanticContext: null, updatedAt: '2026-08-13T00:00:00Z',
};

const git: GitSnapshot = {
  isRepo: true, head: { hash: 'head-new', subject: 'external progress', committedAt: '2026-08-13T00:00:00Z' },
  branch: 'main', uncommitted: { staged: ['src/feature.ts'], unstaged: [], untracked: [], diffStat: 'src/feature.ts | 4 ++++' },
  diff: 'diff --git a/src/feature.ts b/src/feature.ts',
  recentCommits: [{ hash: 'commit-new', subject: 'continue feature', committedAt: '2026-08-13T00:00:00Z' }],
};

function session(overrides: Partial<ExecutionSession> = {}): ExecutionSession {
  return {
    id: 'session-continuity', projectId: 'project-continuity', compilationId: 'comp-continuity', taskId: task.task_id,
    runtime: 'claude-code', binding: { ...emptyRuntimeBinding(), providerId: 'anthropic', modelId: 'claude-sonnet-4-5', modelRef: 'anthropic/claude-sonnet-4-5' },
    userInstruction: '', status: 'active', runtimeCwd: '/tmp/project',
    state: { objective: task.objective, taskId: task.task_id, completed: [], pending: task.acceptance_criteria, decisions: [], blockers: [], relevantFiles: [], lastAction: null, lastValidation: null },
    baseCommit: 'base-head', lastKnownHead: 'head-old', recoveryReason: null, startedAt: '2026-08-13T00:00:00Z', lastActiveAt: '2026-08-13T00:00:00Z', endedAt: null,
    ...overrides,
  };
}

function event(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return { id: 'event-1', sessionId: 'session-continuity', projectId: 'project-continuity', kind: 'user_note', runtime: 'claude-code', content: 'Checkpoint: keep the migration bounded.', metadata: {}, createdAt: '2026-08-13T00:00:00Z', ...overrides };
}

describe('derived continuation state', () => {
  it('stays active at the same reconciled HEAD even with historical commit context', () => {
    const state = deriveContinuationState({
      task,
      session: session({ status: 'reconciled', lastKnownHead: 'head-new' }),
      events: [event({ kind: 'reconciled', content: 'Restart reconciliation found no repository changes since the last checkpoint.' })],
      memory,
      git: { ...git, uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' }, recentCommits: [{ hash: 'old-context', subject: 'historical context', committedAt: '2026-08-12T00:00:00Z' }] },
    });
    expect(state.taskStatus).toBe('active');
    expect(state.externalChange).toBe(false);
  });

  it('stays active after reopening with the same reconciled HEAD', () => {
    const state = deriveContinuationState({
      task,
      session: session({ status: 'reconciled', lastKnownHead: 'head-new' }),
      events: [event({ kind: 'reconciled', content: 'Restart reconciliation found no repository changes since the last checkpoint.' })],
      memory,
      git: { ...git, uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' }, recentCommits: [] },
    });
    expect(state.taskStatus).toBe('active');
  });

  it('requires reconciliation for a newer HEAD after the last observed HEAD', () => {
    const state = deriveContinuationState({
      task, session: session({ status: 'reconciled', lastKnownHead: 'head-old' }), events: [], memory,
      git: { ...git, uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' }, diff: undefined, recentCommits: [{ hash: 'new-context', subject: 'new external commit', committedAt: '2026-08-13T00:00:00Z' }] },
    });
    expect(state.taskStatus).toBe('needs reconciliation');
    expect(state.wipAlignment.mode).toBe('adopt-wip');
    expect(state.nextAction).toContain('WIP DRIFT');
  });

  it('keeps classic reconciliation guidance when preserve-task mode is selected', () => {
    const state = deriveContinuationState({
      task, session: session({ status: 'reconciled', lastKnownHead: 'head-old' }), events: [], memory,
      git: { ...git, uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' }, diff: undefined, recentCommits: [{ hash: 'new-context', subject: 'new external commit', committedAt: '2026-08-13T00:00:00Z' }] },
      wipMode: 'preserve-task',
    });
    expect(state.taskStatus).toBe('needs reconciliation');
    expect(state.wipAlignment.mode).toBe('preserve-task');
    expect(state.nextAction).toContain('PROJECT CHANGED OUTSIDE CURRENT SESSION');
  });

  it('does not adopt WIP when live evidence vocabulary matches the archived task', () => {
    const state = deriveContinuationState({
      task, session: session({ status: 'reconciled', lastKnownHead: 'head-old' }), events: [], memory,
      git: { ...git, uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' }, diff: undefined, recentCommits: [{ hash: 'new-context', subject: 'finish the continuity slice implementation', committedAt: '2026-08-13T00:00:00Z' }] },
    });
    expect(state.taskStatus).toBe('needs reconciliation');
    expect(state.wipAlignment.mode).toBe('preserve-task');
    expect(state.wipAlignment.driftDetected).toBe(false);
    expect(state.nextAction).toContain('PROJECT CHANGED OUTSIDE CURRENT SESSION');
  });

  it('requires reconciliation for dirty repository evidence without verifying it', () => {
    const state = deriveContinuationState({
      task, session: session({ status: 'reconciled', lastKnownHead: 'head-new' }), events: [], memory,
      git: { ...git, uncommitted: { staged: ['src/external.ts'], unstaged: [], untracked: [], diffStat: 'src/external.ts | 1 +' }, recentCommits: [] },
    });
    expect(state.taskStatus).toBe('needs reconciliation');
    expect(state.unverified.join('\n')).toContain('UNVERIFIED');
  });

  it('uses the advanced observed HEAD after successful reconciliation', () => {
    const before = deriveContinuationState({
      task, session: session({ status: 'active', lastKnownHead: 'head-old' }), events: [], memory,
      git: { ...git, uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' }, recentCommits: [] },
    });
    const after = deriveContinuationState({
      task, session: session({ status: 'reconciled', lastKnownHead: before.currentHead }), events: [], memory,
      git: { ...git, uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' }, recentCommits: [] },
    });
    expect(before.taskStatus).toBe('needs reconciliation');
    expect(after.taskStatus).toBe('active');
  });

  it('does not treat legacy historical commits as external change without a baseline', () => {
    const state = deriveContinuationState({
      task, session: session({ status: 'reconciled', baseCommit: null, lastKnownHead: null }), events: [],
      memory: { ...memory, baseCommit: null },
      git: { ...git, uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' }, recentCommits: [{ hash: 'legacy-context', subject: 'old commit', committedAt: '2026-08-01T00:00:00Z' }] },
    });
    expect(state.taskStatus).toBe('active');
    expect(state.externalChange).toBe(false);
  });

  it('keeps only unresolved TaskSpec items pending when persisted evidence proves two complete', () => {
    const state = deriveContinuationState({
      task, session: session({ state: { ...session().state, completed: ['Acceptance one', 'Acceptance two'] } }), events: [], memory, git,
    });
    expect(state.verifiedCompleted).toEqual(['Acceptance one', 'Acceptance two']);
    expect(state.remaining).toEqual(['Acceptance three', 'Acceptance four']);
    expect(state.remaining).not.toContain('Acceptance one');
  });

  it('does not treat changed files as verified and replaces the task-start HEAD', () => {
    const state = deriveContinuationState({ task, session: session(), events: [], memory, git });
    expect(state.currentHead).toBe('head-new');
    expect(state.relevantChangedFiles).toContain('src/feature.ts');
    expect(state.unverified.join('\n')).toContain('UNVERIFIED');
    expect(state.verifiedCompleted).toHaveLength(0);
  });

  it('includes checkpoint and direct verification evidence', () => {
    const state = deriveContinuationState({
      task, session: session({ state: { ...session().state, completed: ['Acceptance one'], lastValidation: 'Acceptance one verified by focused test.' } }),
      events: [event(), event({ id: 'event-verify', kind: 'tool_observation', content: 'Completion verification: BLOCKED.', metadata: { outcome: 'BLOCKED', verified_items: JSON.stringify(['Acceptance one']) } })], memory: { ...memory, lastTest: { commands: ['pnpm test'], results: '1/1 passed', at: '2026-08-13T00:00:00Z' } }, git,
    });
    expect(state.checkpointNotes).toContain('Checkpoint: keep the migration bounded.');
    expect(state.verificationEvidence.some((item) => item.includes('1/1 passed'))).toBe(true);
    expect(state.verifiedCompleted).toContain('Acceptance one');
    expect(state.taskStatus).toBe('blocked');
  });

  it('starts blocked continuation at the persisted blocker', () => {
    const state = deriveContinuationState({ task, session: session({ state: { ...session().state, blockers: ['Database approval is required.'] } }), events: [], memory, git: { ...git, recentCommits: [] } });
    expect(state.taskStatus).toBe('blocked');
    expect(state.nextAction).toContain('Database approval is required.');
  });

  it('stops implementation continuation after READY/completed evidence', () => {
    const state = deriveContinuationState({
      task, session: session({ status: 'completed' }),
      events: [event({ kind: 'tool_observation', content: 'Completion verification: READY.', metadata: { outcome: 'READY', verified_items: JSON.stringify(task.acceptance_criteria) } })], memory, git: { ...git, uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' }, recentCommits: [] },
    });
    expect(state.taskStatus).toBe('completed');
    expect(state.remaining).toEqual([]);
    expect(state.nextAction).toContain('TASK COMPLETE');
  });

  it('preserves source identity while changing the target runtime/model', () => {
    const state = deriveContinuationState({
      task, session: session(), events: [], memory, git,
      target: { runtime: 'qwen-code', binding: { providerId: 'qwen', modelId: 'qwen-3.8-max', modelRef: 'qwen/qwen-3.8-max' } },
    });
    expect(state.lastExecution.runtime).toBe('claude-code');
    expect(state.lastExecution.modelId).toBe('claude-sonnet-4-5');
    expect(state.continueWith.runtime).toBe('qwen-code');
    expect(state.continueWith.modelId).toBe('qwen-3.8-max');
  });

  it('renders target-specific prompts without replaying raw session events', () => {
    const snapshot = assembleSnapshot({ projectId: 'project-continuity', projectName: 'Continuity', repoPath: '/tmp/project', memory, git, currentTask: task, continuationState: deriveContinuationState({ task, session: session(), events: [event({ kind: 'assistant_note', content: 'RAW TRANSCRIPT MUST NOT APPEAR' })], memory, git, target: { runtime: 'qwen-code', binding: { modelId: 'qwen-3.8-max', modelRef: 'qwen/qwen-3.8-max' } } }) });
    const qwen = renderCurrentContinuation(snapshot, 'Qwen Code', ['AGENTS.md', 'QWEN.md'], 'Continue');
    expect(qwen).toContain('Qwen Code');
    expect(qwen).toContain('qwen/qwen-3.8-max');
    expect(qwen).toContain('Last execution');
    expect(qwen).toContain('Continue with');
    expect(qwen).toContain('Acceptance three');
    expect(qwen).not.toContain('RAW TRANSCRIPT');
  });

  it('identifies Claude, Qwen and Codex handoff targets', () => {
    const snapshot = assembleSnapshot({ projectId: 'project-continuity', projectName: 'Continuity', repoPath: '/tmp/project', memory, git, currentTask: task });
    expect(renderHandoffClaudeCode(snapshot)).toContain('Claude Code');
    expect(renderHandoffQwenCode(snapshot)).toContain('Qwen Code');
    expect(renderHandoffCodex(snapshot)).toContain('Codex');
  });
});
