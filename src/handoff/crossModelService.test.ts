import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';

vi.mock('../ipc', () => ({ invokeIpc: vi.fn() }));

import { invokeIpc } from '../ipc';
import { createBetterSqliteRunner } from '../db/betterSqliteRunner';
import { runMigrations } from '../db/migrate';
import { createExecutionHandoffsRepository } from '../db/repos/executionHandoffs';
import { recordCompilation, setDbForTests as setHistoryDb } from '../services/historyService';
import { getMemory, recordCompileSuccess, setDbForTests as setMemoryDb, updateMemory } from '../services/memoryService';
import { setDbForTests as setProjectDb } from '../services/projectsService';
import {
  getExecutionSession,
  setDbForTests as setSessionDb,
  startExecutionSession,
  updateSessionState,
} from '../sessions/executionSessionService';
import { emptyRuntimeBinding, type ExecutionSession } from '../sessions/types';
import type { QueryRunner } from '../db/runner';
import type { TaskSpec } from '../schemas/taskspec';
import {
  confirmHandoffPreview,
  handoffToOpenCode,
  prepareHandoffPreview,
  setDbForTests as setHandoffDb,
} from './crossModelService';

const mockInvoke = vi.mocked(invokeIpc);
const projectId = 'project-cross-model';
const repoPath = '/tmp/canonical-cross-model';

const task: TaskSpec = {
  schema_version: '1.1.0',
  task_id: 'TASK-2026-2001',
  project_id: projectId,
  task_type: 'feature',
  execution_mode: 'standard',
  target_model: 'model-a',
  agent_runtime: 'claude-code',
  execution_profile: 'model-a-claude-code',
  objective: 'Continue the cross-model fixture with evidence.',
  current_state: [],
  relevant_context: [],
  assumptions: [],
  blocking_questions: [],
  scope: ['Preserve the task identity'],
  out_of_scope: ['Full transcript replay'],
  requirements: { functional: [], frontend: [], backend: [], data: [], security: [], accessibility: [], performance: [] },
  edge_cases: [],
  acceptance_criteria: ['The target session retains the task identity.'],
  execution_plan: [],
  test_plan: [],
  stop_conditions: ['Stop when the target handoff is validated.'],
  final_report: [],
  risk_level: 'low',
};

const targetModel = {
  runtime: 'opencode' as const,
  providerId: 'openrouter',
  modelId: 'deepseek/deepseek-v4-pro',
  modelRef: 'openrouter/deepseek/deepseek-v4-pro',
  displayName: 'OpenRouter DeepSeek V4 Pro',
  available: true,
  configured: true,
  availability: 'available' as const,
};

const gitSnapshot = {
  isRepo: true,
  head: { hash: 'head-cross-model', subject: 'fixture baseline', committedAt: '2026-08-11T00:00:00Z' },
  uncommitted: {
    staged: ['src/feature.ts'],
    unstaged: ['src/feature.test.ts'],
    untracked: ['src/notes.md'],
    diffStat: 'src/feature.ts | 2 +-',
  },
  branch: 'main',
};

let sqlite: BetterSqlite3.Database;
let runner: QueryRunner;
let source: ExecutionSession;

async function createSource(): Promise<void> {
  const compilation = await recordCompilation({
    projectId,
    rawRequest: task.objective,
    taskType: task.task_type,
    executionMode: task.execution_mode,
    targetModel: task.target_model,
    agentRuntime: task.agent_runtime,
    executionProfile: task.execution_profile,
    providerLabel: 'Model A',
    modelId: 'model-a',
    contextDocIds: [],
    contextSent: '',
    status: 'done',
    taskspecJson: JSON.stringify(task),
  });
  await recordCompileSuccess(projectId, compilation.id);
  await updateMemory(projectId, {
    baseCommit: 'base-cross-model',
    relevantFiles: ['src/feature.ts'],
    decisions: [{ text: 'Keep the handoff bounded and evidence-aware.', at: '2026-08-11T00:00:00Z' }],
  });
  const memory = await getMemory(projectId);
  source = await startExecutionSession({
    projectId,
    runtime: 'claude-code',
    task,
    compilation,
    memory,
    git: gitSnapshot,
    binding: {
      ...emptyRuntimeBinding(),
      providerId: 'anthropic',
      modelId: 'claude-sonnet',
      modelRef: 'anthropic/claude-sonnet',
    },
  });
  await updateSessionState(projectId, source.id, {
    ...source.state,
    completed: ['The source checkpoint was verified.'],
    pending: ['Verify the target session.'],
    lastValidation: 'Targeted source validation passed.',
  });
  const sessions = await import('../sessions/executionSessionService');
  await sessions.appendSessionEvent(projectId, source.id, 'checkpoint', 'Checkpoint notes survive the handoff.');
  await sessions.appendSessionEvent(projectId, source.id, 'assistant_note', 'FULL TRANSCRIPT SHOULD NOT BE REQUIRED.');
}

beforeEach(async () => {
  sqlite = new BetterSqlite3(':memory:');
  runner = createBetterSqliteRunner(sqlite);
  await runMigrations(runner);
  await runner.execute(
    `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at) VALUES (?,?,?,'{}',?,?)`,
    [projectId, 'Cross-model fixture', repoPath, 'now', 'now'],
  );
  setHistoryDb(runner);
  setMemoryDb(runner);
  setProjectDb(runner);
  setSessionDb(runner);
  setHandoffDb(runner);
  mockInvoke.mockImplementation(async (command) => {
    if (command === 'fs_resolve_project_root') return repoPath;
    if (command === 'git_inspect') return gitSnapshot;
    if (command === 'runtime_status') return {
      runtime: 'opencode', binary: 'opencode', installed: true, canLaunch: true,
      supportsResume: true, supportsModelRouting: true, version: '1.15.10',
      capabilities: ['model-routing'], error: null,
    };
    if (command === 'opencode_models') return {
      runtime: 'opencode', models: [targetModel], source: 'opencode-cli', warning: null,
    };
    if (command === 'launch_runtime') return { started: true, pid: 1234, exitCode: null, stderr: null };
    throw new Error(`Unexpected IPC command: ${command}`);
  });
  await createSource();
});

afterEach(async () => {
  vi.restoreAllMocks();
  setHistoryDb(null);
  setMemoryDb(null);
  setProjectDb(null);
  setSessionDb(null);
  setHandoffDb(null);
  await runner.close();
});

describe('explicit cross-model handoff', () => {
  it('previews bounded evidence without launching, then confirms once with the same package', async () => {
    const sourceBefore = await getExecutionSession(projectId, source.id);
    const preview = await prepareHandoffPreview({ projectId, sourceSessionId: source.id, targetModel });

    expect(preview.continuation.targetExecution.modelRef).toBe(targetModel.modelRef);
    expect(await import('../sessions/executionSessionService').then((sessions) => sessions.listExecutionSessions(projectId))).toHaveLength(1);
    expect(mockInvoke.mock.calls.some(([command]) => command === 'launch_runtime')).toBe(false);

    const result = await confirmHandoffPreview(preview.previewId);

    expect(result.continuation).toEqual(preview.continuation);
    expect(result.targetSession.id).toBe(preview.continuation.targetExecution.sessionId);
    expect(result.handoff.status).toBe('launched');
    expect(await getExecutionSession(projectId, source.id)).toEqual(sourceBefore);
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'launch_runtime')).toHaveLength(1);
    expect(mockInvoke.mock.calls.find(([command]) => command === 'launch_runtime')?.[1]).toMatchObject({
      continuationPrompt: preview.continuation.rendered,
      modelRef: targetModel.modelRef,
    });
  });

  it('creates one new target, persists lineage, and launches bounded evidence', async () => {
    const sourceBefore = await getExecutionSession(projectId, source.id);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM execution_handoffs').get()).toMatchObject({ count: 0 });

    const result = await handoffToOpenCode({ projectId, sourceSessionId: source.id, targetModel });

    const sourceAfter = await getExecutionSession(projectId, source.id);
    expect(sourceAfter).toEqual(sourceBefore);
    expect(result.sourceSession).toEqual(sourceBefore);
    expect(result.targetSession.id).not.toBe(source.id);
    expect(result.targetSession.projectId).toBe(projectId);
    expect(result.targetSession.taskId).toBe(task.task_id);
    expect(result.targetSession.compilationId).toBe(source.compilationId);
    expect(result.targetSession.runtime).toBe('opencode');
    expect(result.targetSession.binding).toMatchObject({
      providerId: targetModel.providerId,
      modelId: targetModel.modelId,
      modelRef: targetModel.modelRef,
    });
    expect(result.targetSession.binding.runtimeSessionId).toMatch(/^opencode-binding-/);
    expect(result.handoff.status).toBe('launched');
    expect(result.handoff.sourceExecutionSessionId).toBe(source.id);
    expect(result.handoff.targetExecutionSessionId).toBe(result.targetSession.id);
    expect(result.continuation.repository).toBe(repoPath);
    expect(result.continuation.observedCompleted).toContain('The source checkpoint was verified.');
    expect(result.continuation.checkpointNotes).toContain('Checkpoint notes survive the handoff.');
    expect(result.continuation.acceptanceRequiringVerification).toContain(task.acceptance_criteria[0]);
    expect(result.continuation.rendered).not.toContain('FULL TRANSCRIPT SHOULD NOT BE REQUIRED.');

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM execution_handoffs').get()).toMatchObject({ count: 1 });
    const launch = mockInvoke.mock.calls.find(([command]) => command === 'launch_runtime');
    expect(launch?.[1]).toMatchObject({
      projectRoot: repoPath,
      modelRef: targetModel.modelRef,
      continuationPrompt: result.continuation.rendered,
    });
  });

  it('rejects missing or invalid targets before creating a target session', async () => {
    await expect(handoffToOpenCode({
      projectId, sourceSessionId: source.id, targetModel: null as never,
    })).rejects.toThrow();
    await expect(handoffToOpenCode({
      projectId,
      sourceSessionId: source.id,
      targetModel: { ...targetModel, available: false, configured: false },
    })).rejects.toThrow(/not currently available/);
    const sessions = await import('../sessions/executionSessionService');
    expect((await sessions.listExecutionSessions(projectId))).toHaveLength(1);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM execution_handoffs').get()).toMatchObject({ count: 0 });
  });

  it('rejects a duplicate prepared handoff without reusing the active source session', async () => {
    const repository = createExecutionHandoffsRepository(runner);
    const target = await startExecutionSession({
      projectId,
      runtime: 'opencode',
      task,
      memory: await getMemory(projectId),
      git: gitSnapshot,
      binding: {
        ...emptyRuntimeBinding(),
        providerId: targetModel.providerId,
        modelId: targetModel.modelId,
        modelRef: targetModel.modelRef,
      },
    });
    await repository.create({
      handoffId: 'handoff-prepared',
      projectId,
      taskId: task.task_id,
      sourceExecutionSessionId: source.id,
      targetExecutionSessionId: target.id,
      sourceRuntime: source.runtime,
      sourceProviderId: source.binding.providerId,
      sourceModelId: source.binding.modelId,
      sourceModelRef: source.binding.modelRef,
      targetProviderId: targetModel.providerId,
      targetModelId: targetModel.modelId,
      targetModelRef: targetModel.modelRef,
      continuation: {
        repository: repoPath,
        task: { id: task.task_id, goal: task.objective },
        currentStatus: source.status,
        observedCompleted: [], observedPartial: [], decisions: [], constraints: [], checkpointNotes: [],
        changedFiles: [], validationEvidence: [], acceptanceRequiringVerification: [], knownBlockers: [],
        immediateNextAction: 'Verify the target.', projectStateReferences: [],
        sourceExecution: { sessionId: source.id, runtime: source.runtime, providerId: source.binding.providerId, modelId: source.binding.modelId, modelRef: source.binding.modelRef },
        targetExecution: { sessionId: target.id, runtime: 'opencode', providerId: targetModel.providerId, modelId: targetModel.modelId, modelRef: targetModel.modelRef },
        instruction: 'Continue.', rendered: 'Continue.',
      },
      createdAt: new Date().toISOString(),
    });

    const sourceBefore = await getExecutionSession(projectId, source.id);
    await expect(handoffToOpenCode({ projectId, sourceSessionId: source.id, targetModel })).rejects.toThrow(/prepared handoff/);
    expect(await getExecutionSession(projectId, source.id)).toEqual(sourceBefore);
    expect(await import('../sessions/executionSessionService').then((sessions) => sessions.listExecutionSessions(projectId))).toHaveLength(2);
  });
});
