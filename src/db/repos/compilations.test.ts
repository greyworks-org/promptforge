import { describe, it, expect, beforeEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { createBetterSqliteRunner } from '../betterSqliteRunner';
import { runMigrations } from '../migrate';
import { createCompilationsRepository, type CompilationsRepository } from './compilations';
import type { QueryRunner } from '../runner';

describe('compilations repository', () => {
  let runner: QueryRunner;
  let repo: CompilationsRepository;

  beforeEach(async () => {
    runner = createBetterSqliteRunner(new BetterSqlite3(':memory:'));
    await runMigrations(runner);
    repo = createCompilationsRepository(runner);
    const now = '2026-08-07T00:00:00Z';
    await runner.execute(
      `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at) VALUES (?,?,?,'{}',?,?)`,
      ['p1', 'p1', '/tmp/p1', now, now],
    );
    await runner.execute(
      `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at) VALUES (?,?,?,'{}',?,?)`,
      ['p2', 'p2', '/tmp/p2', now, now],
    );
  });

  it('inserts and retrieves a compilation', async () => {
    const c = await repo.insert({
      id: 'c1', projectId: 'p1', rawRequest: 'Fix login', taskType: 'bugfix',
      executionMode: 'quick', providerLabel: 'default', modelId: 'deepseek-v4-pro',
      contextSent: 'redacted', status: 'done',
    });
    expect(c.id).toBe('c1');
    expect(c.rawRequest).toBe('Fix login');
    expect(c.status).toBe('done');
  });

  it('lists by project with default values', async () => {
    await repo.insert({
      id: 'c1', projectId: 'p1', rawRequest: 'Fix login', taskType: 'bugfix',
      executionMode: 'quick', providerLabel: 'default', modelId: 'm1',
      contextSent: 'x', status: 'done',
    });
    const list = await repo.listByProject('p1');
    expect(list).toHaveLength(1);
    // New columns should have defaults.
    expect(list[0].targetModel).toBe('');
    expect(list[0].agentRuntime).toBe('');
    expect(list[0].profileVersion).toBe('1.0.0');
  });

  it('is project-isolated', async () => {
    await repo.insert({
      id: 'c1', projectId: 'p1', rawRequest: 'A', taskType: 'bugfix',
      executionMode: 'quick', providerLabel: 'x', modelId: 'x',
      contextSent: 'x', status: 'done',
    });
    expect(await repo.listByProject('p2')).toHaveLength(0);
  });

  it('updates status and prompt fields', async () => {
    await repo.insert({
      id: 'c1', projectId: 'p1', rawRequest: 'Test', taskType: 'feature',
      executionMode: 'standard', providerLabel: 'x', modelId: 'x',
      contextSent: 'x', status: 'compiling',
    });
    const updated = await repo.update('c1', {
      status: 'done',
      taskspecJson: '{"task_type":"feature"}',
      promptClaude: 'Rendered prompt here',
    });
    expect(updated!.status).toBe('done');
    expect(updated!.taskspecJson).toBe('{"task_type":"feature"}');
    expect(updated!.promptClaude).toBe('Rendered prompt here');
  });

  it('getById returns null for unknown id', async () => {
    expect(await repo.getById('nonexistent')).toBeNull();
  });

  it('stores and retrieves new profile columns', async () => {
    await repo.insert({
      id: 'c2', projectId: 'p1', rawRequest: 'Test', taskType: 'feature',
      executionMode: 'deep', providerLabel: 'x', modelId: 'x',
      contextSent: 'x', status: 'done',
      targetModel: 'deepseek-v4-pro',
      agentRuntime: 'claude-code',
      executionProfile: 'deepseek-v4-pro-claude-code',
      profileVersion: '1.0.0',
    });
    const c = await repo.getById('c2');
    expect(c!.targetModel).toBe('deepseek-v4-pro');
    expect(c!.agentRuntime).toBe('claude-code');
    expect(c!.executionProfile).toBe('deepseek-v4-pro-claude-code');
  });
});
