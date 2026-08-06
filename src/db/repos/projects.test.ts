import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBetterSqliteRunner } from '../betterSqliteRunner';
import { runMigrations } from '../migrate';
import type { QueryRunner } from '../runner';
import {
  DuplicateRepoPathError,
  ProjectNotFoundError,
  createProjectsRepository,
  projectRowSchema,
  type NewProject,
  type ProjectsRepository,
} from './projects';

let sqlite: BetterSqlite3.Database;
let runner: QueryRunner;
let repo: ProjectsRepository;

beforeEach(async () => {
  sqlite = new BetterSqlite3(':memory:');
  runner = createBetterSqliteRunner(sqlite);
  await runMigrations(runner);
  repo = createProjectsRepository(runner);
});

afterEach(() => {
  sqlite.close();
});

function makeNew(overrides: Partial<NewProject> = {}): NewProject {
  return {
    id: 'project-alpha',
    name: 'Alpha',
    repoPath: '/tmp/alpha',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('projects repository', () => {
  it('inserts and retrieves a project', async () => {
    const saved = await repo.insert(makeNew());
    expect(saved).toEqual({
      id: 'project-alpha',
      name: 'Alpha',
      repoPath: '/tmp/alpha',
      currentMilestone: null,
      createdAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-06T00:00:00.000Z',
    });
    expect(await repo.getById('project-alpha')).toEqual(saved);
    expect(await repo.getById('project-missing')).toBeNull();
    expect(await repo.getByRepoPath('/tmp/alpha')).toEqual(saved);
    expect(await repo.getByRepoPath('/tmp/missing')).toBeNull();
  });

  it('rejects a duplicate repo_path with a friendly error', async () => {
    await repo.insert(makeNew());
    const attempt = repo.insert(makeNew({ id: 'project-other', name: 'Other' }));
    await expect(attempt).rejects.toBeInstanceOf(DuplicateRepoPathError);
    await expect(attempt).rejects.toThrow(/already registered as "Alpha"/);
    expect(await repo.list()).toHaveLength(1);
  });

  it('lists projects ordered case-insensitively by name', async () => {
    await repo.insert(makeNew({ id: 'project-beta', name: 'beta', repoPath: '/tmp/beta' }));
    await repo.insert(makeNew());
    const names = (await repo.list()).map((p) => p.name);
    expect(names).toEqual(['Alpha', 'beta']);
  });

  it('updates name and milestone and bumps updated_at', async () => {
    await repo.insert(makeNew());
    const updated = await repo.update('project-alpha', {
      name: 'Alpha Prime',
      currentMilestone: 'Phase 2',
    });
    expect(updated.name).toBe('Alpha Prime');
    expect(updated.currentMilestone).toBe('Phase 2');
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse('2026-08-06T00:00:00.000Z'));
    expect(updated.repoPath).toBe('/tmp/alpha');
  });

  it('clears the milestone when updated to null', async () => {
    await repo.insert(makeNew());
    await repo.update('project-alpha', { currentMilestone: 'Phase 2' });
    const cleared = await repo.update('project-alpha', { currentMilestone: null });
    expect(cleared.currentMilestone).toBeNull();
  });

  it('rejects updates for missing projects and empty names', async () => {
    await expect(repo.update('project-missing', { name: 'X' })).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
    await repo.insert(makeNew());
    await expect(repo.update('project-alpha', { name: '   ' })).rejects.toThrow(
      /must not be empty/,
    );
  });

  it('removes a project once; second removal reports false', async () => {
    await repo.insert(makeNew());
    expect(await repo.remove('project-alpha')).toBe(true);
    expect(await repo.getById('project-alpha')).toBeNull();
    expect(await repo.remove('project-alpha')).toBe(false);
  });

  it('validates row shapes with Zod', () => {
    expect(() =>
      projectRowSchema.parse({
        id: '',
        name: 'X',
        repo_path: '/tmp/x',
        current_milestone: null,
        settings_json: '{}',
        created_at: 'now',
        updated_at: 'now',
      }),
    ).toThrow();
    expect(() =>
      projectRowSchema.parse({
        id: 'project-x',
        name: 'X',
        repo_path: '/tmp/x',
        created_at: 'now',
        updated_at: 'now',
      }),
    ).toThrow();
  });
});
