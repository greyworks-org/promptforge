import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { createBetterSqliteRunner } from '../db/betterSqliteRunner';
import { runMigrations } from '../db/migrate';
import type { QueryRunner } from '../db/runner';
import type { MemoryRecord } from '../db/repos/projectMemory';
import type { TaskSpec } from '../schemas/taskspec';
import {
  appendSessionEvent,
  getExecutionSession,
  listSessionEvents,
  renderSessionContinuation,
  startExecutionSession,
  switchSessionRuntime,
  setDbForTests,
} from './executionSessionService';

let runner: QueryRunner;

const task: TaskSpec = {
  schema_version: '1.1.0',
  task_id: 'TASK-2026-1001',
  project_id: 'project-session',
  task_type: 'feature',
  execution_mode: 'standard',
  target_model: 'deepseek-v4-pro',
  agent_runtime: 'claude-code',
  execution_profile: 'deepseek-v4-pro-claude-code',
  objective: 'Persist the execution session across a restart.',
  current_state: [],
  relevant_context: [],
  assumptions: [],
  blocking_questions: [],
  scope: ['Persist session state'],
  out_of_scope: [],
  requirements: { functional: [], frontend: [], backend: [], data: [], security: [], accessibility: [], performance: [] },
  edge_cases: [],
  acceptance_criteria: ['The session survives a restart.'],
  execution_plan: [],
  test_plan: [],
  stop_conditions: [],
  final_report: [],
  risk_level: 'low',
};

const memory: MemoryRecord = {
  projectId: 'project-session',
  stack: ['TypeScript'],
  currentPhase: 'session core',
  lastValidatedTaskId: null,
  currentTaskId: 'comp-1',
  nextTask: null,
  decisions: [{ text: 'Keep runtime state provider-neutral.', at: '2026-08-11T00:00:00Z' }],
  blockers: [],
  relevantFiles: ['src/sessions'],
  lastTest: null,
  baseCommit: 'abc123',
  semanticContext: null,
  updatedAt: '2026-08-11T00:00:00Z',
};

const git = {
  isRepo: true,
  head: { hash: 'def456', subject: 'session work', committedAt: '2026-08-11T00:00:00Z' },
  uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' },
  branch: 'main',
};

beforeEach(async () => {
  runner = createBetterSqliteRunner(new BetterSqlite3(':memory:'));
  await runMigrations(runner);
  await runner.execute(
    `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at) VALUES (?,?,?,'{}',?,?)`,
    ['project-session', 'Session project', '/tmp/session-project', 'now', 'now'],
  );
  setDbForTests(runner);
});

afterEach(async () => {
  setDbForTests(null);
  await runner.close();
});

describe('execution session continuity', () => {
  it('persists canonical state and transcript across runtime switching', async () => {
    const created = await startExecutionSession({
      projectId: 'project-session', runtime: 'claude-code', task, memory, git,
    });
    await appendSessionEvent('project-session', created.id, 'assistant_note', 'Implemented the first safe slice.');
    const switched = await switchSessionRuntime('project-session', created.id, 'codex');

    expect(switched.runtime).toBe('codex');
    expect(switched.state.objective).toBe(task.objective);
    const events = await listSessionEvents('project-session', created.id);
    expect(events.map((event) => event.kind)).toEqual(['started', 'assistant_note', 'runtime_switch']);
    expect(await getExecutionSession('project-session', created.id)).not.toBeNull();
  });

  it('renders the same persisted knowledge for the next runtime without a provider call', async () => {
    const created = await startExecutionSession({
      projectId: 'project-session', runtime: 'claude-code', task, memory, git,
    });
    await appendSessionEvent('project-session', created.id, 'checkpoint', 'Typecheck passed.');
    const prompt = await renderSessionContinuation('project-session', created.id);

    expect(prompt).toContain(task.objective);
    expect(prompt).toContain('Typecheck passed.');
    expect(prompt).toContain('AGENTS.md and CLAUDE.md');
  });

  it('supports OpenCode as a runtime without replacing canonical session state', async () => {
    const created = await startExecutionSession({
      projectId: 'project-session', runtime: 'claude-code', task, memory, git,
    });
    const switched = await switchSessionRuntime('project-session', created.id, 'opencode');
    const prompt = await renderSessionContinuation('project-session', created.id);

    expect(switched.runtime).toBe('opencode');
    expect(switched.binding.modelId).toBe(task.target_model);
    expect(prompt).toContain('# PromptForge continuation · OpenCode');
    expect(prompt).toContain(task.objective);
  });
});
