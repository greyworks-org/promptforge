import { describe, it, expect, beforeEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { createBetterSqliteRunner } from '../../src/db/betterSqliteRunner';
import { runMigrations } from '../../src/db/migrate';
import { createCompilationsRepository } from '../../src/db/repos/compilations';
import { createOutcomesRepository } from '../../src/db/repos/outcomes';
import { getProjectUsage, setDbForTests as setUsageDb } from '../../src/services/usageService';
import { setDbForTests as setHistoryDb, recordCompilation } from '../../src/services/historyService';
import type { QueryRunner } from '../../src/db/runner';

describe('history isolation', () => {
  let runner: QueryRunner;

  beforeEach(async () => {
    runner = createBetterSqliteRunner(new BetterSqlite3(':memory:'));
    await runMigrations(runner);
    setUsageDb(runner);
    setHistoryDb(runner);

    const now = '2026-08-07T00:00:00Z';
    await runner.execute(
      `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at) VALUES (?,?,?,'{}',?,?)`,
      ['project-a', 'A', '/tmp/a', now, now],
    );
    await runner.execute(
      `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at) VALUES (?,?,?,'{}',?,?)`,
      ['project-b', 'B', '/tmp/b', now, now],
    );
  });

  it('history is project-scoped — Project A data never appears in Project B list', async () => {
    await recordCompilation({
      projectId: 'project-a', rawRequest: 'Fix login', taskType: 'bugfix',
      executionMode: 'quick', providerLabel: 'x', modelId: 'x',
      contextDocIds: [], contextSent: 'redacted', status: 'done',
    });
    await recordCompilation({
      projectId: 'project-b', rawRequest: 'Add signup', taskType: 'feature',
      executionMode: 'standard', providerLabel: 'x', modelId: 'x',
      contextDocIds: [], contextSent: 'redacted', status: 'done',
    });

    const comps = createCompilationsRepository(runner);
    const aList = await comps.listByProject('project-a');
    const bList = await comps.listByProject('project-b');

    expect(aList).toHaveLength(1);
    expect(bList).toHaveLength(1);
    expect(aList[0].rawRequest).toBe('Fix login');
    expect(bList[0].rawRequest).toBe('Add signup');
  });

  it('usage aggregates are project-scoped', async () => {
    const comps = createCompilationsRepository(runner);
    await comps.insert({
      id: 'ca1', projectId: 'project-a', rawRequest: 'A1', taskType: 'bugfix',
      executionMode: 'quick', providerLabel: 'x', modelId: 'x',
      contextSent: 'x', status: 'done',
      compilerPromptTokens: 100, compilerCompletionTokens: 50,
    });
    await comps.insert({
      id: 'ca2', projectId: 'project-a', rawRequest: 'A2', taskType: 'feature',
      executionMode: 'standard', providerLabel: 'x', modelId: 'x',
      contextSent: 'x', status: 'failed',
      error: 'Something broke',
    });

    const usageA = await getProjectUsage('project-a');
    const usageB = await getProjectUsage('project-b');

    expect(usageA.totalCompilations).toBe(2);
    expect(usageA.failureCount).toBe(1);
    expect(usageB.totalCompilations).toBe(0);
    expect(usageB.failureCount).toBe(0);
  });

  it('outcome edits remain bound to correct compilation and project', async () => {
    const comps = createCompilationsRepository(runner);
    const outcomes = createOutcomesRepository(runner);

    await comps.insert({
      id: 'c1', projectId: 'project-a', rawRequest: 'Fix login', taskType: 'bugfix',
      executionMode: 'quick', providerLabel: 'x', modelId: 'x',
      contextSent: 'x', status: 'done',
    });

    await outcomes.upsert({
      compilationId: 'c1', completionResult: 'success', revisionCount: 1,
      scopeViolation: null, testsPassed: 1, completionTimeMin: 30,
      usedRuntime: 'claude-code', userNote: 'Good', recordedAt: new Date().toISOString(),
    });

    // Project B should not find this outcome.
    const bOutcomes = await outcomes.listByProject('project-b');
    expect(bOutcomes).toHaveLength(0);

    // Project A should.
    const aOutcomes = await outcomes.listByProject('project-a');
    expect(aOutcomes).toHaveLength(1);
    expect(aOutcomes[0].completionResult).toBe('success');
  });

  it('pagination is project-scoped', async () => {
    for (let i = 0; i < 5; i++) {
      await recordCompilation({
        projectId: 'project-a', rawRequest: `Task ${i}`, taskType: 'bugfix',
        executionMode: 'quick', providerLabel: 'x', modelId: 'x',
        contextDocIds: [], contextSent: 'x', status: 'done',
      });
    }
    for (let i = 0; i < 3; i++) {
      await recordCompilation({
        projectId: 'project-b', rawRequest: `Task B${i}`, taskType: 'feature',
        executionMode: 'standard', providerLabel: 'x', modelId: 'x',
        contextDocIds: [], contextSent: 'x', status: 'done',
      });
    }

    const comps = createCompilationsRepository(runner);
    const aPage1 = await comps.listByProject('project-a', 2, 0);
    const aPage2 = await comps.listByProject('project-a', 2, 2);
    const aPage3 = await comps.listByProject('project-a', 2, 4);

    expect(aPage1).toHaveLength(2);
    expect(aPage2).toHaveLength(2);
    expect(aPage3).toHaveLength(1);

    // All items belong to project-a.
    for (const c of [...aPage1, ...aPage2, ...aPage3]) {
      expect(c.projectId).toBe('project-a');
    }
  });

  it('success counts are correct in aggregates', async () => {
    const outcomes = createOutcomesRepository(runner);
    const comps = createCompilationsRepository(runner);

    await comps.insert({
      id: 'c1', projectId: 'project-a', rawRequest: 'A', taskType: 'bugfix',
      executionMode: 'quick', providerLabel: 'x', modelId: 'x',
      contextSent: 'x', status: 'done',
    });
    await outcomes.upsert({
      compilationId: 'c1', completionResult: 'success', revisionCount: 0,
      scopeViolation: null, testsPassed: null, completionTimeMin: null,
      usedRuntime: null, userNote: null, recordedAt: new Date().toISOString(),
    });

    await comps.insert({
      id: 'c2', projectId: 'project-a', rawRequest: 'B', taskType: 'feature',
      executionMode: 'standard', providerLabel: 'x', modelId: 'x',
      contextSent: 'x', status: 'done',
    });
    await outcomes.upsert({
      compilationId: 'c2', completionResult: 'failure', revisionCount: 2,
      scopeViolation: null, testsPassed: null, completionTimeMin: null,
      usedRuntime: null, userNote: null, recordedAt: new Date().toISOString(),
    });

    // Third compilation with no outcome yet.
    await comps.insert({
      id: 'c3', projectId: 'project-a', rawRequest: 'C', taskType: 'bugfix',
      executionMode: 'quick', providerLabel: 'x', modelId: 'x',
      contextSent: 'x', status: 'done',
    });

    const usage = await getProjectUsage('project-a');
    expect(usage.totalCompilations).toBe(3);
    expect(usage.successCount).toBe(1);
    expect(usage.failureCount).toBe(1);
    // c3 has no outcome → not counted in success/partial/failure.
    expect(usage.partialCount).toBe(0);
  });
});
