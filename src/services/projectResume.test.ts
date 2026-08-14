import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';

vi.mock('./opencodeModels', () => ({ getOpenCodeModelDiscovery: vi.fn() }));

import { createBetterSqliteRunner } from '../db/betterSqliteRunner';
import { runMigrations } from '../db/migrate';
import type { QueryRunner } from '../db/runner';
import type { TaskSpec } from '../schemas/taskspec';
import {
  appendSessionEvent,
  ensureExecutionSession,
  finishExecutionSession,
  listExecutionSessions,
  setDbForTests as setSessionDb,
} from '../sessions/executionSessionService';
import { getOpenCodeModelDiscovery } from './opencodeModels';
import * as runtimeService from './runtimeService';
import * as settingsService from './settingsService';
import { recordCompilation, setDbForTests as setHistoryDb } from './historyService';
import { updateMemory, setDbForTests as setMemoryDb } from './memoryService';
import { setDbForTests as setProjectDb } from './projectsService';
import { setDbForTests as setContextDb } from './contextService';
import { setDbForTests as setIntelligenceDb } from './projectIntelligenceService';
import { resumeCurrentProject } from './projectResume';

const projectId = 'project-resume';
const repoPath = '/tmp/resume-project';
const MODEL_REF = 'bailian-token-plan-personal/qwen3.8-max';

const task: TaskSpec = {
  schema_version: '1.1.0',
  task_id: 'TASK-2026-3001',
  project_id: projectId,
  task_type: 'feature',
  execution_mode: 'standard',
  target_model: 'qwen-3.8-max',
  agent_runtime: 'claude-code',
  execution_profile: 'deepseek-v4-pro-claude-code',
  objective: 'Finish the resume slice.',
  current_state: [],
  relevant_context: [],
  assumptions: [],
  blocking_questions: [],
  scope: ['Finish resume'],
  out_of_scope: [],
  requirements: { functional: [], frontend: [], backend: [], data: [], security: [], accessibility: [], performance: [] },
  edge_cases: [],
  acceptance_criteria: ['Resume launches OpenCode with the current continuation.'],
  execution_plan: [],
  test_plan: [],
  stop_conditions: [],
  final_report: [],
  risk_level: 'low',
};

let sqlite: BetterSqlite3.Database;
let runner: QueryRunner;
let launches: runtimeService.LaunchRuntimeInput[] = [];

async function activeSession(binding?: { providerId: string | null; modelId: string | null; modelRef: string | null }) {
  const compilation = await recordCompilation({
    projectId,
    rawRequest: 'Finish the resume slice.',
    taskType: task.task_type,
    executionMode: task.execution_mode,
    targetModel: task.target_model,
    agentRuntime: task.agent_runtime,
    executionProfile: task.execution_profile,
    providerLabel: 'Qwen',
    modelId: 'qwen-3.8-max',
    contextDocIds: [],
    contextSent: '',
    status: 'done',
    taskspecJson: JSON.stringify(task),
  });
  const session = await ensureExecutionSession({
    projectId,
    runtime: 'opencode',
    task,
    compilation,
    binding: {
      providerId: binding?.providerId ?? 'qwen',
      modelId: binding?.modelId ?? 'qwen-3.8-max',
      modelRef: binding === undefined ? MODEL_REF : binding.modelRef,
      variant: null,
      runtimeSessionId: null,
      detectedVersion: null,
      capabilities: [],
    },
  });
  await updateMemory(projectId, { currentTaskId: compilation.id });
  return session;
}

beforeEach(async () => {
  launches = [];
  sqlite = new BetterSqlite3(':memory:');
  runner = createBetterSqliteRunner(sqlite);
  await runMigrations(runner);
  const now = '2026-08-14T00:00:00Z';
  await runner.execute(
    `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at) VALUES (?,?,?,'{}',?,?)`,
    [projectId, 'Resume project', repoPath, now, now],
  );
  await runner.execute(
    `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at) VALUES (?,?,?,'{}',?,?)`,
    ['project-other', 'Other', '/tmp/other-project', now, now],
  );
  setProjectDb(runner);
  setHistoryDb(runner);
  setMemoryDb(runner);
  setContextDb(runner);
  setSessionDb(runner);
  setIntelligenceDb(runner);

  vi.spyOn(runtimeService, 'validateRuntimeProject').mockResolvedValue(repoPath);
  vi.spyOn(runtimeService, 'detectRuntime').mockResolvedValue({
    runtime: 'opencode', binary: 'opencode', installed: true, canLaunch: true, supportsResume: true,
    supportsModelRouting: true, version: '1.15.10', capabilities: ['resume'], error: null,
  });
  vi.spyOn(runtimeService, 'launchRuntimeProcess').mockImplementation(async (input) => {
    launches.push(input);
    return { started: true, pid: 4242, exitCode: null, stderr: null };
  });
  vi.mocked(getOpenCodeModelDiscovery).mockImplementation(async (_projectId, selectedModelRef) => ({
    runtime: 'opencode',
    models: selectedModelRef ? [{
      runtime: 'opencode', providerId: selectedModelRef.split('/')[0],
      modelId: selectedModelRef.split('/').slice(1).join('/'), modelRef: selectedModelRef,
      displayName: selectedModelRef, available: true, configured: true, availability: 'available',
    }] : [],
    source: 'opencode-cli', warning: null,
  }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  setProjectDb(null);
  setHistoryDb(null);
  setMemoryDb(null);
  setContextDb(null);
  setSessionDb(null);
  setIntelligenceDb(null);
  await runner.close();
});

describe('VS Code project resume', () => {
  it('resolves the registered project from the workspace repository root', async () => {
    const outcome = await resumeCurrentProject(repoPath);
    expect(outcome.projectId).toBe(projectId);
    expect(outcome.projectName).toBe('Resume project');
  });

  it('resolves the real registered Offerpath root to its own project only', async () => {
    await runner.execute(
      `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at) VALUES (?,?,?,'{}',?,?)`,
      ['project-offerpath', 'Offerpath', '/Users/utku/projects/offerpath', 'now', 'now'],
    );

    const outcome = await resumeCurrentProject('/Users/utku/projects/offerpath');

    expect(outcome.projectId).toBe('project-offerpath');
    expect(outcome.status).toBe('no-active-task');
    expect(launches).toHaveLength(0);
  });

  it('reports no project for an unregistered workspace root', async () => {
    const outcome = await resumeCurrentProject('/tmp/not-registered');
    expect(outcome.status).toBe('no-project');
    expect(outcome.projectId).toBeNull();
    expect(launches).toHaveLength(0);
  });

  it('resumes an active task with the current continuation and the saved model reference', async () => {
    const session = await activeSession();
    await appendSessionEvent(projectId, session.id, 'runtime_launch', 'OpenCode start requested.', 'opencode');
    await appendSessionEvent(projectId, session.id, 'user_note', 'Checkpoint: keep the migration bounded.');

    const outcome = await resumeCurrentProject(repoPath);

    expect(outcome.status).toBe('executed');
    expect(outcome.taskStatus).toBe('active');
    expect(launches).toHaveLength(1);
    expect(launches[0].resume).toBe(true);
    expect(launches[0].modelRef).toBe(MODEL_REF);
    expect(launches[0].projectRoot).toBe(repoPath);
    // The continuation is derived now, not replayed from a stored prompt.
    expect(launches[0].continuationPrompt).toContain(task.objective);
    expect(launches[0].continuationPrompt).toContain('Checkpoint: keep the migration bounded.');
    expect(outcome.modelRef).toBe(MODEL_REF);
  });

  it('falls back to the exact reference saved on the provider profile', async () => {
    vi.spyOn(settingsService, 'listProfiles').mockResolvedValue([{
      id: 'qwen', label: 'Qwen', providerId: 'qwen', baseUrl: 'https://example.invalid', modelId: 'qwen-3.8-max',
      runtimeModelRef: MODEL_REF, capabilities: { jsonMode: 'auto' },
      params: { temperature: 0.2, maxTokens: 4096, timeoutMs: 60_000 },
    }]);
    await activeSession({ providerId: 'qwen', modelId: 'qwen-3.8-max', modelRef: null });

    const outcome = await resumeCurrentProject(repoPath);

    expect(outcome.status).toBe('executed');
    expect(launches[0].modelRef).toBe(MODEL_REF);
  });

  it('requires configuration instead of guessing a model when no reference is saved', async () => {
    vi.spyOn(settingsService, 'listProfiles').mockResolvedValue([]);
    await activeSession({ providerId: 'qwen', modelId: 'qwen-3.8-max', modelRef: null });

    const outcome = await resumeCurrentProject(repoPath);

    expect(outcome.status).toBe('configuration-required');
    expect(outcome.message).toContain('CONFIGURATION REQUIRED');
    expect(launches).toHaveLength(0);
  });

  it('never executes a completed task and offers the next step instead', async () => {
    const session = await activeSession();
    await finishExecutionSession(projectId, session.id, 'completed');

    const outcome = await resumeCurrentProject(repoPath);

    expect(outcome.status).toBe('completed');
    expect(outcome.taskStatus).toBe('completed');
    expect(outcome.message).toBe('Current task complete.');
    expect(launches).toHaveLength(0);
  });

  it('never executes a blocked task and surfaces the blocker', async () => {
    const session = await activeSession();
    await appendSessionEvent(
      projectId, session.id, 'tool_observation', 'Completion verification: BLOCKED.',
      'opencode', { outcome: 'BLOCKED', verified_items: '[]' },
    );

    const outcome = await resumeCurrentProject(repoPath);

    expect(outcome.status).toBe('blocked');
    expect(outcome.blockers.join('\n')).toContain('BLOCKED');
    expect(launches).toHaveLength(0);
  });

  it('never executes a task that needs human review', async () => {
    const session = await activeSession();
    await appendSessionEvent(
      projectId, session.id, 'tool_observation', 'Completion verification: NEEDS HUMAN REVIEW.',
      'opencode', { outcome: 'NEEDS HUMAN REVIEW', verified_items: '[]' },
    );

    const outcome = await resumeCurrentProject(repoPath);

    expect(outcome.status).toBe('needs-human-review');
    expect(launches).toHaveLength(0);
  });

  it('recommends a next task when no active task exists', async () => {
    const outcome = await resumeCurrentProject(repoPath);

    expect(outcome.status).toBe('no-active-task');
    expect(outcome.sessionId).toBeNull();
    expect(launches).toHaveLength(0);
  });

  it('shares the same persisted session state with the desktop app', async () => {
    const session = await activeSession();
    const outcome = await resumeCurrentProject(repoPath);

    const sessions = await listExecutionSessions(projectId);
    expect(sessions).toHaveLength(1);
    expect(outcome.sessionId).toBe(session.id);
    expect(sessions[0].id).toBe(session.id);
    expect(sessions[0].runtimeCwd).toBe(repoPath);
  });
});
