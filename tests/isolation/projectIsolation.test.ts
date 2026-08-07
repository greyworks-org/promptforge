/**
 * Phase 2 isolation suite (IMPLEMENTATION_PLAN.md): with two seeded projects,
 * no repository call can read or write another project's rows without
 * explicitly passing its id, and removal cascades only the removed project's
 * data.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBetterSqliteRunner } from '../../src/db/betterSqliteRunner';
import { runMigrations } from '../../src/db/migrate';
import { createProjectsRepository, type ProjectsRepository } from '../../src/db/repos/projects';
import type { QueryRunner } from '../../src/db/runner';

const NOW = '2026-08-06T00:00:00.000Z';

let sqlite: BetterSqlite3.Database;
let runner: QueryRunner;
let repo: ProjectsRepository;

beforeEach(async () => {
  sqlite = new BetterSqlite3(':memory:');
  runner = createBetterSqliteRunner(sqlite);
  await runMigrations(runner);
  repo = createProjectsRepository(runner);

  await repo.insert({ id: 'project-alpha', name: 'Alpha', repoPath: '/tmp/alpha', createdAt: NOW, updatedAt: NOW });
  await repo.insert({ id: 'project-beta', name: 'Beta', repoPath: '/tmp/beta', createdAt: NOW, updatedAt: NOW });

  // Seed project-scoped rows directly to prove cascade + scoping on tables
  // that later phases will use.
  const doc = sqlite.prepare(
    'INSERT INTO context_docs (id, project_id, rel_path, title, content_hash, est_tokens, last_scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  doc.run('doc-a', 'project-alpha', '.promptforge/context/PRODUCT.md', 'Alpha product', 'hash-a', 10, NOW);
  doc.run('doc-b', 'project-beta', '.promptforge/context/PRODUCT.md', 'Beta product', 'hash-b', 10, NOW);

  const compilation = sqlite.prepare(
    `INSERT INTO compilations (id, project_id, created_at, raw_request, task_type, execution_mode, target_model, agent_runtime, execution_profile, profile_version, provider_label, model_id, context_sent, status) VALUES (?, ?, ?, ?, ?, ?, '', '', '', '1.0.0', ?, ?, ?, ?)`,
  );
  compilation.run('comp-a', 'project-alpha', NOW, 'raw a', 'feature', 'standard', 'Default', 'm', 'sent a', 'done');
  compilation.run('comp-b', 'project-beta', NOW, 'raw b', 'feature', 'standard', 'Default', 'm', 'sent b', 'done');

  const outcome = sqlite.prepare(
    'INSERT INTO task_outcomes (compilation_id, completion_result, recorded_at) VALUES (?, ?, ?)',
  );
  outcome.run('comp-a', 'success', NOW);
  outcome.run('comp-b', 'success', NOW);
});

afterEach(() => {
  sqlite.close();
});

function count(sql: string, param: string): number {
  return (sqlite.prepare(sql).get(param) as { n: number }).n;
}

describe('project isolation', () => {
  it('every lookup returns only the explicitly requested project', async () => {
    const alpha = await repo.getById('project-alpha');
    const beta = await repo.getById('project-beta');
    expect(alpha?.name).toBe('Alpha');
    expect(alpha?.repoPath).toBe('/tmp/alpha');
    expect(beta?.name).toBe('Beta');
    expect(beta?.repoPath).toBe('/tmp/beta');
    expect(await repo.getById('project-missing')).toBeNull();
    expect((await repo.getByRepoPath('/tmp/alpha'))?.id).toBe('project-alpha');
    expect((await repo.getByRepoPath('/tmp/beta'))?.id).toBe('project-beta');
    expect(await repo.getByRepoPath('/tmp/other')).toBeNull();
  });

  it('list returns each project with only its own fields', async () => {
    const listed = await repo.list();
    expect(listed.map((p) => p.id).sort()).toEqual(['project-alpha', 'project-beta']);
    const alpha = listed.find((p) => p.id === 'project-alpha');
    expect(alpha?.repoPath).toBe('/tmp/alpha');
  });

  it('updating one project never touches the other', async () => {
    const betaBefore = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get('project-beta');
    await repo.update('project-alpha', { name: 'Alpha Renamed', currentMilestone: 'M1' });
    const betaAfter = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get('project-beta');
    expect(betaAfter).toEqual(betaBefore);
    expect((await repo.getById('project-alpha'))?.name).toBe('Alpha Renamed');
  });

  it('removing a project cascades only its own rows', async () => {
    expect(await repo.remove('project-alpha')).toBe(true);

    expect(count('SELECT COUNT(*) AS n FROM projects WHERE id = ?', 'project-alpha')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM context_docs WHERE project_id = ?', 'project-alpha')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM compilations WHERE project_id = ?', 'project-alpha')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM task_outcomes WHERE compilation_id = ?', 'comp-a')).toBe(0);

    // Beta's data is untouched.
    expect(count('SELECT COUNT(*) AS n FROM projects WHERE id = ?', 'project-beta')).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM context_docs WHERE project_id = ?', 'project-beta')).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM compilations WHERE project_id = ?', 'project-beta')).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM task_outcomes WHERE compilation_id = ?', 'comp-b')).toBe(1);
  });

  it('foreign keys block project-scoped rows for unknown projects', async () => {
    expect(() =>
      sqlite
        .prepare(
          'INSERT INTO context_docs (id, project_id, rel_path, title, content_hash, est_tokens, last_scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('doc-x', 'project-ghost', 'x.md', 'X', 'hash-x', 1, NOW),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});
