import { describe, it, expect, beforeEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { createBetterSqliteRunner } from '../betterSqliteRunner';
import type { QueryRunner } from '../runner';
import { runMigrations } from '../migrate';
import {
  createContextDocsRepository,
  type ContextDocsRepository,
} from './contextDocs';

describe('contextDocs repository', () => {
  let runner: QueryRunner;
  let repo: ContextDocsRepository;

  beforeEach(async () => {
    runner = createBetterSqliteRunner(new BetterSqlite3(':memory:'));
    await runMigrations(runner);
    repo = createContextDocsRepository(runner);
    // context_docs has FK to projects — create a parent row.
    const now = '2026-08-07T00:00:00Z';
    await runner.execute(
      `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, '{}', ?, ?)`,
      ['p1', 'p1', '/tmp/p1', now, now],
    );
    await runner.execute(
      `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, '{}', ?, ?)`,
      ['p2', 'p2', '/tmp/p2', now, now],
    );
  });

  const newDoc = {
    id: 'p1:.promptforge/context/PRODUCT.md',
    projectId: 'p1',
    relPath: '.promptforge/context/PRODUCT.md',
    title: 'PRODUCT',
    contentHash: 'abc123',
    estTokens: 100,
    lastScannedAt: '2026-08-07T00:00:00Z',
  };

  it('upserts and retrieves a doc', async () => {
    const created = await repo.upsert(newDoc);
    expect(created.id).toBe(newDoc.id);
    expect(created.title).toBe('PRODUCT');
    expect(created.contentHash).toBe('abc123');

    const fetched = await repo.getById(newDoc.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe('PRODUCT');
  });

  it('upsert updates existing doc', async () => {
    await repo.upsert(newDoc);
    const updated = await repo.upsert({
      ...newDoc,
      title: 'PRODUCT updated',
      contentHash: 'def456',
    });
    expect(updated.contentHash).toBe('def456');
    expect(updated.title).toBe('PRODUCT updated');

    const fetched = await repo.getById(newDoc.id);
    expect(fetched!.contentHash).toBe('def456');
  });

  it('lists by project', async () => {
    await repo.upsert(newDoc);
    await repo.upsert({
      ...newDoc,
      id: 'p1:.promptforge/context/DESIGN.md',
      relPath: '.promptforge/context/DESIGN.md',
      title: 'DESIGN',
    });

    const docs = await repo.listByProject('p1');
    expect(docs).toHaveLength(2);
  });

  it('getByProjectAndPath finds by project + path', async () => {
    await repo.upsert(newDoc);
    const found = await repo.getByProjectAndPath('p1', newDoc.relPath);
    expect(found).not.toBeNull();
    const missing = await repo.getByProjectAndPath('p1', 'nonexistent.md');
    expect(missing).toBeNull();
  });

  it('getByProjectAndPath is project-isolated', async () => {
    await repo.upsert(newDoc);
    const missing = await repo.getByProjectAndPath('p2', newDoc.relPath);
    expect(missing).toBeNull();
  });

  it('listByProject is project-isolated', async () => {
    await repo.upsert(newDoc);
    await repo.upsert({
      ...newDoc,
      id: 'p2:.promptforge/context/PRODUCT.md',
      projectId: 'p2',
    });
    expect(await repo.listByProject('p1')).toHaveLength(1);
    expect(await repo.listByProject('p2')).toHaveLength(1);
  });

  it('removes a doc', async () => {
    await repo.upsert(newDoc);
    const removed = await repo.remove(newDoc.id);
    expect(removed).toBe(true);
    expect(await repo.getById(newDoc.id)).toBeNull();
  });

  it('remove returns false for missing doc', async () => {
    const removed = await repo.remove('nonexistent');
    expect(removed).toBe(false);
  });

  it('searchLike finds by title', async () => {
    await repo.upsert(newDoc);
    await repo.upsert({
      ...newDoc,
      id: 'p1:.promptforge/context/SECURITY.md',
      relPath: '.promptforge/context/SECURITY.md',
      title: 'SECURITY',
      tags: ['auth', 'secrets'],
    });

    const ids = await repo.searchLike('p1', 'security');
    expect(ids).toContain('p1:.promptforge/context/SECURITY.md');
  });

  it('searchLike finds by tag', async () => {
    await repo.upsert({
      ...newDoc,
      tags: ['product', 'vision'],
      taskTypes: ['feature'],
    });

    const ids = await repo.searchLike('p1', 'vision');
    expect(ids).toContain(newDoc.id);
  });

  it('searchLike is project-isolated', async () => {
    await repo.upsert(newDoc);
    const ids = await repo.searchLike('p2', 'product');
    expect(ids).toHaveLength(0);
  });

  it('handles FTS5 gracefully when unavailable', async () => {
    // In-memory SQLite may or may not have FTS5 compiled in.
    // The contract is: searchFts throws 'FTS5 unavailable' when it can't work.
    try {
      await repo.searchFts('p1', 'test');
    } catch (err: any) {
      expect(err.message).toContain('FTS5');
    }
  });
});
