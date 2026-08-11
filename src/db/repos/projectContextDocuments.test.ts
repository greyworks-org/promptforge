import { beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { createBetterSqliteRunner } from '../betterSqliteRunner';
import { runMigrations } from '../migrate';
import type { QueryRunner } from '../runner';
import { createProjectContextDocumentsRepository } from './projectContextDocuments';

describe('project context document allowlist', () => {
  let runner: QueryRunner;

  beforeEach(async () => {
    runner = createBetterSqliteRunner(new BetterSqlite3(':memory:'));
    await runMigrations(runner);
    await runner.execute(
      `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, '{}', ?, ?)`,
      ['p1', 'p1', '/tmp/p1', 'now', 'now'],
    );
  });

  it('stores only project-scoped relative references and reloads them', async () => {
    const repository = createProjectContextDocumentsRepository(runner);
    await repository.add('p1', 'docs/offerpath-v2/offerpath-source-of-truth.md');

    expect(await repository.listByProject('p1')).toMatchObject([
      { projectId: 'p1', relPath: 'docs/offerpath-v2/offerpath-source-of-truth.md' },
    ]);
    expect(await repository.listByProject('other')).toEqual([]);
  });

  it('removes a selected reference without touching repository files', async () => {
    const repository = createProjectContextDocumentsRepository(runner);
    await repository.add('p1', 'README.md');

    expect(await repository.remove('p1', 'README.md')).toBe(true);
    expect(await repository.listByProject('p1')).toEqual([]);
  });
});
