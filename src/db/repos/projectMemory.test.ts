import { describe, it, expect, beforeEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { createBetterSqliteRunner } from '../betterSqliteRunner';
import { runMigrations } from '../migrate';
import { createProjectMemoryRepository, type ProjectMemoryRepository } from './projectMemory';
import type { QueryRunner } from '../runner';

describe('projectMemory repository', () => {
  let runner: QueryRunner;
  let repo: ProjectMemoryRepository;

  beforeEach(async () => {
    runner = createBetterSqliteRunner(new BetterSqlite3(':memory:'));
    await runMigrations(runner);
    repo = createProjectMemoryRepository(runner);
    const now = '2026-08-07T00:00:00Z';
    await runner.execute(
      `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at) VALUES (?,?,?,'{}',?,?)`,
      ['p1', 'P1', '/tmp/p1', now, now],
    );
    await runner.execute(
      `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at) VALUES (?,?,?,'{}',?,?)`,
      ['p2', 'P2', '/tmp/p2', now, now],
    );
  });

  it('creates a memory row on first upsert', async () => {
    const m = await repo.upsert('p1', { currentPhase: 'phase-1' });
    expect(m.projectId).toBe('p1');
    expect(m.currentPhase).toBe('phase-1');
    expect(m.stack).toEqual([]);
    expect(m.decisions).toEqual([]);
  });

  it('updates existing memory', async () => {
    await repo.upsert('p1', { currentPhase: 'phase-1' });
    const m = await repo.upsert('p1', { currentPhase: 'phase-2', stack: ['TypeScript', 'React'] });
    expect(m.currentPhase).toBe('phase-2');
    expect(m.stack).toEqual(['TypeScript', 'React']);
  });

  it('is project-isolated', async () => {
    await repo.upsert('p1', { currentPhase: 'alpha' });
    await repo.upsert('p2', { currentPhase: 'beta' });
    expect((await repo.getByProject('p1'))!.currentPhase).toBe('alpha');
    expect((await repo.getByProject('p2'))!.currentPhase).toBe('beta');
  });

  it('getByProject returns null for unknown', async () => {
    expect(await repo.getByProject('nonexistent')).toBeNull();
  });

  it('stores decisions as structured JSON', async () => {
    const m = await repo.upsert('p1', {
      decisions: [{ text: 'Use SQLite', at: '2026-08-07T00:00:00Z' }],
    });
    expect(m.decisions).toHaveLength(1);
    expect(m.decisions[0].text).toBe('Use SQLite');
  });

  it('stores blockers as structured JSON', async () => {
    const m = await repo.upsert('p1', {
      blockers: [{ text: 'Auth not ready', kind: 'risk', at: '2026-08-07T00:00:00Z' }],
    });
    expect(m.blockers).toHaveLength(1);
    expect(m.blockers[0].kind).toBe('risk');
  });
});
