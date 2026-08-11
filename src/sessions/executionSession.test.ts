import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { createBetterSqliteRunner } from '../db/betterSqliteRunner';
import { runMigrations } from '../db/migrate';
import type { QueryRunner } from '../db/runner';
import type { MemoryRecord } from '../db/repos/projectMemory';
import type { TaskSpec } from '../schemas/taskspec';
import {
  appendSessionEvent,
  deriveExecutionSessionControls,
  getExecutionSession,
  launchExecutionSessionThroughOpenCode,
  listSessionEvents,
  renderSessionContinuation,
  renderSessionTask,
  selectOpenCodeModel,
  startExecutionSession,
  switchSessionRuntime,
  updateSessionInstruction,
  setDbForTests,
} from './executionSessionService';
import * as runtimeService from '../services/runtimeService';

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
  vi.restoreAllMocks();
  setDbForTests(null);
  await runner.close();
});

describe('execution session continuity', () => {
  it('exposes safe OpenCode control eligibility from canonical state and events', async () => {
    const created = await startExecutionSession({
      projectId: 'project-session', runtime: 'opencode', task, memory, git,
    });
    expect(deriveExecutionSessionControls(created, []).canStart).toBe(true);
    const launch = {
      id: 'event-launch',
      sessionId: created.id,
      projectId: created.projectId,
      kind: 'runtime_launch' as const,
      runtime: 'opencode' as const,
      content: 'OpenCode start requested.',
      metadata: {},
      createdAt: '2026-08-11T00:00:00Z',
    };
    expect(deriveExecutionSessionControls(created, [launch]).canStart).toBe(false);
    expect(deriveExecutionSessionControls({ ...created, status: 'paused' }, [launch]).canResume).toBe(true);
    expect(deriveExecutionSessionControls({ ...created, status: 'completed' }, [launch]).canCheckpoint).toBe(false);
  });

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

  it('persists the selected OpenCode model and forwards its opaque reference on launch', async () => {
    const created = await startExecutionSession({
      projectId: 'project-session', runtime: 'opencode', task, memory, git,
    });
    const model = {
      runtime: 'opencode' as const,
      providerId: 'openrouter',
      modelId: 'deepseek/deepseek-v4-pro',
      modelRef: 'openrouter/deepseek/deepseek-v4-pro',
      displayName: 'OpenRouter DeepSeek V4 Pro',
      available: true,
      configured: true,
      availability: 'available' as const,
    };
    const selected = await selectOpenCodeModel('project-session', created.id, model);
    expect(selected.binding).toMatchObject({
      providerId: 'openrouter',
      modelId: 'deepseek/deepseek-v4-pro',
      modelRef: 'openrouter/deepseek/deepseek-v4-pro',
    });

    vi.spyOn(runtimeService, 'detectRuntime').mockResolvedValue({
      runtime: 'opencode',
      binary: 'opencode',
      installed: true,
      canLaunch: true,
      supportsResume: true,
      supportsModelRouting: true,
      version: '1.15.10',
      capabilities: ['model-routing'],
      error: null,
    });
    const launch = vi.spyOn(runtimeService, 'launchRuntimeProcess').mockResolvedValue({
      started: true,
      pid: 1234,
      exitCode: null,
      stderr: null,
    });

    await launchExecutionSessionThroughOpenCode('project-session', created.id, 'resume');

    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      runtime: 'opencode',
      resume: true,
      externalSessionId: null,
      modelRef: 'openrouter/deepseek/deepseek-v4-pro',
      continuationPrompt: null,
    }));
  });

  it('persists a new instruction and composes it after canonical context', async () => {
    const created = await startExecutionSession({
      projectId: 'project-session', runtime: 'opencode', task, memory, git,
    });
    await runner.execute(
      'INSERT INTO project_context_documents (project_id, rel_path, selected_at) VALUES (?, ?, ?)',
      ['project-session', 'docs/offerpath-v2/offerpath-source-of-truth.md', 'now'],
    );
    const saved = await updateSessionInstruction('project-session', created.id, 'Implement the next safe slice.');
    const composed = await renderSessionTask('project-session', created.id, saved.userInstruction);

    expect(saved.userInstruction).toBe('Implement the next safe slice.');
    expect(composed).toContain('docs/offerpath-v2/offerpath-source-of-truth.md');
    expect(composed).toContain('## New user instruction\nImplement the next safe slice.');
    expect(await renderSessionContinuation('project-session', created.id)).not.toContain('New user instruction');
  });

  it('records the actual launch error and keeps the instruction after failure', async () => {
    const created = await startExecutionSession({
      projectId: 'project-session', runtime: 'opencode', task, memory, git,
    });
    await updateSessionInstruction('project-session', created.id, 'Do not lose this instruction.');
    vi.spyOn(runtimeService, 'detectRuntime').mockResolvedValue({
      runtime: 'opencode', binary: 'opencode', installed: true, canLaunch: true,
      supportsResume: true, supportsModelRouting: true, version: '1.15.10',
      capabilities: [], error: null,
    });
    vi.spyOn(runtimeService, 'launchRuntimeProcess').mockResolvedValue({
      started: false, pid: 99, exitCode: 17, stderr: 'permission denied',
    });

    await expect(launchExecutionSessionThroughOpenCode('project-session', created.id, 'start', 'complete task'))
      .rejects.toThrow('exit code 17: permission denied');
    const failed = await getExecutionSession('project-session', created.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.userInstruction).toBe('Do not lose this instruction.');
    expect((await listSessionEvents('project-session', created.id)).some((event) => event.content.includes('permission denied'))).toBe(true);
  });
});
