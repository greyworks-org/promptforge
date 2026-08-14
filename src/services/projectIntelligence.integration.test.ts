import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';

vi.mock('../ipc', () => ({ invokeIpc: vi.fn() }));

import { invokeIpc } from '../ipc';
import { createBetterSqliteRunner } from '../db/betterSqliteRunner';
import { runMigrations } from '../db/migrate';
import type { QueryRunner } from '../db/runner';
import { defaultProfile } from '../schemas/providerProfile';
import type { TaskSpec } from '../schemas/taskspec';
import { runPipeline } from '../compiler/pipeline';
import { setDbForTests as setContextDb } from './contextService';
import { setDbForTests as setHistoryDb, recordCompilation } from './historyService';
import { setDbForTests as setMemoryDb, updateMemory } from './memoryService';
import { setDbForTests as setProjectDb } from './projectsService';
import { setDbForTests as setSessionDb } from '../sessions/executionSessionService';
import {
  bootstrapProjectIntelligence,
  compilerIntelligenceSummary,
  getProjectIntelligence,
  recommendNextTask,
  setDbForTests as setIntelligenceDb,
} from './projectIntelligenceService';

const mockInvoke = vi.mocked(invokeIpc);
const projectId = 'project-intelligence';
const repoPath = '/tmp/intelligence-project';

const README = [
  '# Sample product',
  '',
  'Sample product is a local pipeline that discovers work, scores it and prepares a submission.',
  '',
  '## Architecture',
  '',
  '- Discovery and scoring share one worker process.',
  '',
  '## Known issues',
  '',
  '- The pipeline is blocked before a successful real prefill.',
].join('\n');

const task: TaskSpec = {
  schema_version: '1.1.0',
  task_id: 'TASK-2026-2001',
  project_id: projectId,
  task_type: 'feature',
  execution_mode: 'standard',
  target_model: 'luna-5.6-high',
  agent_runtime: 'claude-code',
  execution_profile: 'deepseek-v4-pro-claude-code',
  objective: 'Add the requirement-fit gate.',
  current_state: [],
  relevant_context: [],
  assumptions: [],
  blocking_questions: [],
  scope: ['Add the gate'],
  out_of_scope: [],
  requirements: { functional: [], frontend: [], backend: [], data: [], security: [], accessibility: [], performance: [] },
  edge_cases: [],
  acceptance_criteria: ['The gate rejects postings below the threshold.'],
  execution_plan: [],
  test_plan: [],
  stop_conditions: [],
  final_report: [],
  risk_level: 'low',
};

/** Read-only project filesystem/git stub: no repository is ever written. */
function repositoryStub(options: { changedFiles?: string[] } = {}) {
  mockInvoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'fs_resolve_project_root') return repoPath as never;
    if (command === 'fs_list_dir') {
      return (args?.path === '' ? [{ name: 'README.md', isDir: false, sizeBytes: README.length }] : []) as never;
    }
    if (command === 'fs_read_text') {
      if (args?.path === 'README.md') return README as never;
      throw new Error('No such file.');
    }
    if (command === 'fs_exists') return false as never;
    if (command === 'git_inspect') {
      return {
        isRepo: true,
        head: { hash: 'head-1', subject: 'baseline', committedAt: '2026-08-14T00:00:00Z' },
        staged: options.changedFiles ?? [],
        unstaged: [],
        untracked: [],
        diffStat: '',
        branch: 'main',
        diff: '',
        recentCommits: [],
      } as never;
    }
    throw new Error(`Unexpected command: ${command}`);
  });
}

let sqlite: BetterSqlite3.Database;
let runner: QueryRunner;

beforeEach(async () => {
  mockInvoke.mockReset();
  sqlite = new BetterSqlite3(':memory:');
  runner = createBetterSqliteRunner(sqlite);
  await runMigrations(runner);
  await runner.execute(
    `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at) VALUES (?,?,?,'{}',?,?)`,
    [projectId, 'Sample product', repoPath, '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'],
  );
  setProjectDb(runner);
  setHistoryDb(runner);
  setMemoryDb(runner);
  setContextDb(runner);
  setSessionDb(runner);
  setIntelligenceDb(runner);
  repositoryStub();
});

afterEach(() => {
  setProjectDb(null);
  setHistoryDb(null);
  setMemoryDb(null);
  setContextDb(null);
  setSessionDb(null);
  setIntelligenceDb(null);
  sqlite.close();
});

describe('persistent project intelligence', () => {
  it('bootstraps a project that has no intelligence yet', async () => {
    expect(await getProjectIntelligence(projectId)).toBeNull();

    const { intelligence } = await bootstrapProjectIntelligence(projectId);

    expect(intelligence.projectId).toBe(projectId);
    expect(intelligence.product).toContain('Sample product is a local pipeline');
    expect(intelligence.blocked.map((item) => item.statement).join('\n')).toContain('blocked before a successful real prefill');
    expect(await getProjectIntelligence(projectId)).not.toBeNull();
  });

  it('reconciles the existing record instead of recreating it', async () => {
    const first = (await bootstrapProjectIntelligence(projectId)).intelligence;
    const second = (await bootstrapProjectIntelligence(projectId)).intelligence;

    expect(second.bootstrappedAt).toBe(first.bootstrappedAt);
    expect(second.blocked.map((item) => item.statement)).toEqual(first.blocked.map((item) => item.statement));
  });

  it('counts a verified TaskSpec as project progress and leaves repository changes unverified', async () => {
    const compilation = await recordCompilation({
      projectId,
      rawRequest: 'Add the requirement-fit gate.',
      taskType: task.task_type,
      executionMode: task.execution_mode,
      targetModel: task.target_model,
      agentRuntime: task.agent_runtime,
      executionProfile: task.execution_profile,
      providerLabel: 'Provider',
      modelId: 'model',
      contextDocIds: [],
      contextSent: '',
      status: 'done',
      taskspecJson: JSON.stringify(task),
    });
    await updateMemory(projectId, { lastValidatedTaskId: compilation.id, currentTaskId: null });
    repositoryStub({ changedFiles: ['src/prefill.ts'] });

    const { intelligence } = await bootstrapProjectIntelligence(projectId);

    expect(intelligence.verifiedComplete.map((item) => item.statement)).toContain('Verified complete: Add the requirement-fit gate.');
    const partial = intelligence.partial.map((item) => item.statement).join('\n');
    expect(partial).toContain('UNVERIFIED');
    expect(partial).toContain('src/prefill.ts');
    expect(intelligence.verifiedComplete.map((item) => item.statement).join('\n')).not.toContain('src/prefill.ts');
  });

  it('recommends the next bounded task without creating a TaskSpec or session', async () => {
    const { recommendation } = await recommendNextTask(projectId);

    expect(recommendation?.basis).toBe('blocker');
    expect(recommendation?.intent).toContain('blocked before a successful real prefill');
    const compilations = await runner.select<{ count: number }>('SELECT COUNT(*) AS count FROM compilations');
    const sessions = await runner.select<{ count: number }>('SELECT COUNT(*) AS count FROM execution_sessions');
    expect(compilations[0].count).toBe(0);
    expect(sessions[0].count).toBe(0);
  });

  it('compiles a short intent using project intelligence', async () => {
    const { intelligence } = await bootstrapProjectIntelligence(projectId);
    mockInvoke.mockResolvedValue({
      status: 200,
      latencyMs: 1,
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          task_type: 'feature',
          execution_mode: 'standard',
          target_model: 'luna-5.6-high',
          agent_runtime: 'claude-code',
          execution_profile: 'deepseek-v4-pro-claude-code',
          objective: 'Unblock the prefill path.',
          scope: ['Unblock prefill'],
          acceptance_criteria: ['A real prefill completes once.'],
          risk_level: 'medium',
        }) } }],
      }),
    } as never);

    const compiled = await runPipeline({
      profile: { ...defaultProfile(), baseUrl: 'http://localhost:4141', modelId: 'model' },
      projectId,
      rawRequest: 'Continue.',
      executionMode: 'standard',
      contextDocs: [],
      projectIntelligence: compilerIntelligenceSummary(intelligence),
    });

    expect(compiled.status).toBe('done');
    expect(compiled.contextSent).toContain('Project intelligence');
    expect(compiled.contextSent).toContain('blocked before a successful real prefill');
    expect(compiled.contextSent).toContain('Continue.');
  });

  it('lets a typed intent override the recommendation', async () => {
    const { intelligence, recommendation } = await recommendNextTask(projectId);
    mockInvoke.mockResolvedValue({
      status: 200,
      latencyMs: 1,
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          task_type: 'ui',
          execution_mode: 'standard',
          target_model: 'luna-5.6-high',
          agent_runtime: 'claude-code',
          execution_profile: 'deepseek-v4-pro-claude-code',
          objective: 'Simplify onboarding.',
          scope: ['Simplify onboarding'],
          acceptance_criteria: ['Onboarding has fewer steps.'],
          risk_level: 'low',
        }) } }],
      }),
    } as never);

    const compiled = await runPipeline({
      profile: { ...defaultProfile(), baseUrl: 'http://localhost:4141', modelId: 'model' },
      projectId,
      rawRequest: 'Make onboarding simpler.',
      executionMode: 'standard',
      contextDocs: [],
      projectIntelligence: compilerIntelligenceSummary(intelligence),
    });

    expect(recommendation?.intent).toContain('blocked before a successful real prefill');
    expect(compiled.taskSpec?.objective).toBe('Simplify onboarding.');
    expect(compiled.contextSent.startsWith('Make onboarding simpler.')).toBe(true);
  });
});
