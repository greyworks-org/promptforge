import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBetterSqliteRunner } from '../db/betterSqliteRunner';
import { runMigrations } from '../db/migrate';
import type { QueryRunner } from '../db/runner';
import { invokeIpc } from '../ipc';
import {
  DuplicateRepoPathError,
  InvalidFolderError,
  ProjectNotFoundError,
  getActiveProject,
  getActiveProjectId,
  listProjects,
  normalizeFolderPath,
  registerProject,
  removeProject,
  setActiveProject,
  setDbForTests,
  updateProject,
} from './projectsService';

vi.mock('../ipc', () => ({ invokeIpc: vi.fn(), pickDirectory: vi.fn() }));

interface FsEntry {
  exists?: boolean;
  isDir?: boolean;
  canonicalPath?: string | null;
}

const invokeMock = vi.mocked(invokeIpc);

function mockFs(entries: Record<string, FsEntry>): void {
  invokeMock.mockImplementation(async (command, args) => {
    expect(command).toBe('fs_metadata');
    const path = (args as { path: string }).path;
    const entry = entries[path];
    if (entry === undefined) return { exists: false, isDir: false, canonicalPath: null };
    return {
      exists: entry.exists ?? true,
      isDir: entry.isDir ?? true,
      canonicalPath: entry.canonicalPath ?? path,
    };
  });
}

let sqlite: BetterSqlite3.Database;
let runner: QueryRunner;

beforeEach(async () => {
  sqlite = new BetterSqlite3(':memory:');
  runner = createBetterSqliteRunner(sqlite);
  await runMigrations(runner);
  setDbForTests(runner);
  invokeMock.mockReset();
});

afterEach(() => {
  setDbForTests(null);
  sqlite.close();
});

describe('normalizeFolderPath', () => {
  it('collapses separators and resolves dot segments', () => {
    expect(normalizeFolderPath('/a//b/./c/')).toBe('/a/b/c');
    expect(normalizeFolderPath('/a/b/../c')).toBe('/a/c');
    expect(normalizeFolderPath('  /tmp/alpha  ')).toBe('/tmp/alpha');
    expect(normalizeFolderPath('/')).toBe('/');
  });

  it('rejects empty and relative paths', () => {
    expect(() => normalizeFolderPath('')).toThrow(InvalidFolderError);
    expect(() => normalizeFolderPath('relative/path')).toThrow(/absolute/);
  });
});

describe('registerProject', () => {
  it('registers an arbitrary folder path with a slug id and default name', async () => {
    mockFs({ '/Users/someone/My Weird App (draft 2)': {} });
    const project = await registerProject({ folderPath: '/Users/someone/My Weird App (draft 2)' });
    expect(project.id).toBe('project-my-weird-app-draft-2');
    expect(project.name).toBe('My Weird App (draft 2)');
    expect(project.repoPath).toBe('/Users/someone/My Weird App (draft 2)');
    expect(await listProjects()).toHaveLength(1);
  });

  it('uses a custom name when provided', async () => {
    mockFs({ '/tmp/alpha': {} });
    const project = await registerProject({ folderPath: '/tmp/alpha', name: 'Alpha Service' });
    expect(project.name).toBe('Alpha Service');
    expect(project.id).toBe('project-alpha-service');
  });

  it('stores the canonical path reported by the OS', async () => {
    mockFs({ '/tmp/link': { canonicalPath: '/private/var/real/target' } });
    const project = await registerProject({ folderPath: '/tmp/link' });
    expect(project.repoPath).toBe('/private/var/real/target');
  });

  it('prevents duplicate registrations, including spelling variants', async () => {
    mockFs({
      '/tmp/alpha': {},
      '/tmp/alpha/': { canonicalPath: '/tmp/alpha' },
    });
    await registerProject({ folderPath: '/tmp/alpha', name: 'Alpha' });
    const second = registerProject({ folderPath: '/tmp/alpha/', name: 'Again' });
    await expect(second).rejects.toBeInstanceOf(DuplicateRepoPathError);
    await expect(second).rejects.toThrow(/already registered as "Alpha"/);
    expect(await listProjects()).toHaveLength(1);
  });

  it('allocates distinct ids for equal names from different folders', async () => {
    mockFs({ '/tmp/one': {}, '/tmp/two': {} });
    const first = await registerProject({ folderPath: '/tmp/one', name: 'App' });
    const second = await registerProject({ folderPath: '/tmp/two', name: 'App' });
    expect(first.id).toBe('project-app');
    expect(second.id).toBe('project-app-2');
  });

  it('rejects folders that do not exist or are not directories', async () => {
    mockFs({
      '/tmp/missing': { exists: false },
      '/tmp/file.txt': { isDir: false },
    });
    await expect(registerProject({ folderPath: '/tmp/missing' })).rejects.toThrow(/does not exist/);
    await expect(registerProject({ folderPath: '/tmp/file.txt' })).rejects.toThrow(/not a folder/);
    expect(await listProjects()).toHaveLength(0);
  });

  it('rejects relative paths before any IPC call', async () => {
    await expect(registerProject({ folderPath: 'relative/path' })).rejects.toThrow(/absolute/);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('project metadata and removal', () => {
  beforeEach(() => {
    mockFs({ '/tmp/alpha': {}, '/tmp/beta': {} });
  });

  it('updates name and milestone; empty milestone clears it', async () => {
    const created = await registerProject({ folderPath: '/tmp/alpha', name: 'Alpha' });
    const updated = await updateProject(created.id, { name: 'Alpha Prime', currentMilestone: 'Phase 2' });
    expect(updated.name).toBe('Alpha Prime');
    expect(updated.currentMilestone).toBe('Phase 2');
    const cleared = await updateProject(created.id, { currentMilestone: '   ' });
    expect(cleared.currentMilestone).toBeNull();
  });

  it('rejects empty names and unknown projects', async () => {
    const created = await registerProject({ folderPath: '/tmp/alpha', name: 'Alpha' });
    await expect(updateProject(created.id, { name: '  ' })).rejects.toThrow(/must not be empty/);
    await expect(updateProject('project-missing', { name: 'X' })).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });

  it('removes a project from the registry without touching the folder', async () => {
    const created = await registerProject({ folderPath: '/tmp/alpha', name: 'Alpha' });
    await removeProject(created.id);
    expect(await listProjects()).toHaveLength(0);
    // Removal only ever calls DELETE on the DB — no fs IPC besides registration.
    expect(invokeMock.mock.calls.every(([command]) => command === 'fs_metadata')).toBe(true);
  });

  it('removing an unknown project throws', async () => {
    await expect(removeProject('project-missing')).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('removing the active project clears the active selection', async () => {
    const created = await registerProject({ folderPath: '/tmp/alpha', name: 'Alpha' });
    await setActiveProject(created.id);
    expect(await getActiveProjectId()).toBe(created.id);
    await removeProject(created.id);
    expect(await getActiveProjectId()).toBeNull();
  });
});

describe('active project selection', () => {
  beforeEach(() => {
    mockFs({ '/tmp/alpha': {}, '/tmp/beta': {} });
  });

  it('selects and returns the active project', async () => {
    const alpha = await registerProject({ folderPath: '/tmp/alpha', name: 'Alpha' });
    const beta = await registerProject({ folderPath: '/tmp/beta', name: 'Beta' });
    expect(await getActiveProjectId()).toBeNull();
    expect(await getActiveProject()).toBeNull();

    await setActiveProject(beta.id);
    expect(await getActiveProjectId()).toBe(beta.id);
    const active = await getActiveProject();
    expect(active?.id).toBe(beta.id);

    await setActiveProject(alpha.id);
    expect(await getActiveProjectId()).toBe(alpha.id);
  });

  it('rejects selecting an unknown project', async () => {
    await expect(setActiveProject('project-missing')).rejects.toBeInstanceOf(ProjectNotFoundError);
  });
});
