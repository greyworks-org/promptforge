import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';

vi.mock('../ipc', () => ({ invokeIpc: vi.fn() }));

import { invokeIpc } from '../ipc';
import { runMigrations } from '../db/migrate';
import { createBetterSqliteRunner } from '../db/betterSqliteRunner';
import type { QueryRunner } from '../db/runner';
import { defaultProfile } from '../schemas/providerProfile';
import { resetTaskCounterForTests } from '../compiler/enrich';
import { runPipeline } from '../compiler/pipeline';
import { recordCompilation, getCompilation, setDbForTests as setHistoryDb } from './historyService';
import { getMemory, recordCompileSuccess, setDbForTests as setMemoryDb } from './memoryService';
import { assembleSnapshot } from '../handoff/snapshot';
import { renderHandoffCodex } from '../handoff/renderCodex';
import type { GitSnapshot } from './gitState';

const mockInvoke = vi.mocked(invokeIpc);
const projectId = 'project-fixture';

const git: GitSnapshot = {
  isRepo: true,
  head: { hash: 'a708fc37abcdef', subject: 'fixture baseline', committedAt: '2026-08-10T00:00:00Z' },
  uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' },
  branch: 'main',
};

describe('compiler to Continue persistence', () => {
  let sqlite: BetterSqlite3.Database;
  let runner: QueryRunner;

  beforeEach(async () => {
    resetTaskCounterForTests();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      status: 200,
      latencyMs: 1,
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          task_type: 'feature',
          execution_mode: 'standard',
          target_model: 'deepseek-v4-pro',
          agent_runtime: 'claude-code',
          execution_profile: 'deepseek-v4-pro-claude-code',
          objective: 'Add venue and asset-class filters to the Research dossier.',
          scope: ['Add venue filter', 'Add asset-class filter'],
          acceptance_criteria: ['Both filters work with status, data-health, and search.'],
          risk_level: 'medium',
        }) } }],
      }),
    });

    sqlite = new BetterSqlite3(':memory:');
    runner = createBetterSqliteRunner(sqlite);
    await runMigrations(runner);
    const now = '2026-08-10T00:00:00Z';
    await runner.execute(
      `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at) VALUES (?,?,?,'{}',?,?)`,
      [projectId, 'Fixture', '/tmp/fixture', now, now],
    );
    setHistoryDb(runner);
    setMemoryDb(runner);
  });

  afterEach(() => {
    setHistoryDb(null);
    setMemoryDb(null);
    sqlite.close();
  });

  it('persists the canonical task and reloads the identical task for Continue', async () => {
    const profile = { ...defaultProfile(), baseUrl: 'http://localhost:4141', modelId: 'deepseek-v4-pro' };
    const compiled = await runPipeline({
      profile,
      projectId,
      rawRequest: 'Add venue and asset-class filters to the Research dossier.',
      executionMode: 'standard',
      contextDocs: [],
    });

    expect(compiled.status).toBe('done');
    expect(compiled.taskSpec).not.toBeNull();

    const saved = await recordCompilation({
      projectId,
      rawRequest: 'Add venue and asset-class filters to the Research dossier.',
      taskType: compiled.taskSpec!.task_type,
      executionMode: compiled.taskSpec!.execution_mode,
      targetModel: compiled.taskSpec!.target_model,
      agentRuntime: compiled.taskSpec!.agent_runtime,
      executionProfile: compiled.taskSpec!.execution_profile,
      providerLabel: 'DeepSeek Provider',
      modelId: profile.modelId,
      contextDocIds: [],
      contextSent: compiled.contextSent,
      status: 'done',
      taskspecJson: JSON.stringify(compiled.taskSpec),
    });
    await recordCompileSuccess(projectId, saved.id);

    const reloadedMemory = await getMemory(projectId);
    const reloadedCompilation = await getCompilation(reloadedMemory.currentTaskId!);
    const reloadedTask = JSON.parse(reloadedCompilation!.taskspecJson!);
    const snapshot = assembleSnapshot({
      projectId,
      projectName: 'Fixture',
      memory: reloadedMemory,
      git,
      currentTask: reloadedTask,
      currentCompilation: reloadedCompilation,
    });

    expect(reloadedMemory.currentTaskId).toBe(saved.id);
    expect(reloadedTask).toEqual(compiled.taskSpec);
    expect(renderHandoffCodex(snapshot)).toContain(compiled.taskSpec!.objective);
    expect(renderHandoffCodex(snapshot)).toContain('DeepSeek Provider / OS Keychain');
    expect(renderHandoffCodex(snapshot)).toContain(compiled.taskSpec!.acceptance_criteria[0]);
  });
});
