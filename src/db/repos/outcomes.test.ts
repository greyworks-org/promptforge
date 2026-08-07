import { describe, it, expect, beforeEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { createBetterSqliteRunner } from '../betterSqliteRunner';
import { runMigrations } from '../migrate';
import { createOutcomesRepository, type OutcomesRepository } from './outcomes';
import type { QueryRunner } from '../runner';

describe('outcomes repository', () => {
  let runner: QueryRunner;
  let repo: OutcomesRepository;

  beforeEach(async () => {
    runner = createBetterSqliteRunner(new BetterSqlite3(':memory:'));
    await runMigrations(runner);
    repo = createOutcomesRepository(runner);
    const now = '2026-08-07T00:00:00Z';
    await runner.execute(
      `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at) VALUES (?,?,?,'{}',?,?)`,
      ['p1', 'p1', '/tmp/p1', now, now],
    );
    // Need a compilation row for FK.
    await runner.execute(
      `INSERT INTO compilations (id, project_id, created_at, raw_request, task_type, execution_mode, target_model, agent_runtime, execution_profile, profile_version, provider_label, model_id, context_sent, status)
       VALUES ('c1','p1',?,'test','bugfix','quick','','','','1.0.0','x','x','x','done')`, [now],
    );
  });

  it('upserts and retrieves an outcome', async () => {
    const o = await repo.upsert({
      compilationId: 'c1', completionResult: 'success', revisionCount: 0,
      scopeViolation: null, testsPassed: 1, completionTimeMin: 30,
      usedRuntime: 'claude-code', userNote: 'Worked well.', recordedAt: new Date().toISOString(),
    });
    expect(o.completionResult).toBe('success');
    expect(o.testsPassed).toBe(1);
    expect(o.usedRuntime).toBe('claude-code');
  });

  it('updates existing outcome', async () => {
    await repo.upsert({
      compilationId: 'c1', completionResult: 'success', revisionCount: 1,
      scopeViolation: null, testsPassed: null, completionTimeMin: null,
      usedRuntime: null, userNote: null, recordedAt: new Date().toISOString(),
    });
    const updated = await repo.upsert({
      compilationId: 'c1', completionResult: 'failure', revisionCount: 3,
      scopeViolation: 1, testsPassed: 0, completionTimeMin: 60,
      usedRuntime: 'codex', userNote: 'Failed.', recordedAt: new Date().toISOString(),
    });
    expect(updated.completionResult).toBe('failure');
    expect(updated.revisionCount).toBe(3);
  });

  it('getByCompilationId returns null for unknown', async () => {
    expect(await repo.getByCompilationId('nonexistent')).toBeNull();
  });
});
