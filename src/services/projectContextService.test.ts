import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { createBetterSqliteRunner } from '../db/betterSqliteRunner';
import { runMigrations } from '../db/migrate';
import type { QueryRunner } from '../db/runner';

vi.mock('../ipc', () => ({ invokeIpc: vi.fn() }));

import { invokeIpc } from '../ipc';
import {
  listProjectContextDocuments,
  normalizeProjectContextPath,
  projectContextPathInputError,
  selectProjectContextDocument,
  setProjectContextDbForTests,
} from './projectContextService';

const offerpathSource = 'docs/offerpath-v2/offerpath-source-of-truth.md';
const offerpathChecklist = 'docs/offerpath-v2/O0-RECONCILIATION-CHECKLIST.md';

let runner: QueryRunner;

beforeEach(async () => {
  runner = createBetterSqliteRunner(new BetterSqlite3(':memory:'));
  await runMigrations(runner);
  await runner.execute(
    `INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at)
     VALUES (?, ?, ?, '{}', ?, ?), (?, ?, ?, '{}', ?, ?)`,
    [
      'project-offerpath', 'Offerpath', '/Users/utku/projects/offerpath', 'now', 'now',
      'project-promptforge', 'PromptForge', '/Users/utku/Desktop/PromptForge', 'now', 'now',
    ],
  );
  setProjectContextDbForTests(runner);
  vi.mocked(invokeIpc).mockReset();
});

afterEach(async () => {
  setProjectContextDbForTests(null);
  await runner.close();
});

function readableFileProbe() {
  return { exists: true, isDir: false, isFile: true, readable: true };
}

describe('project context document management', () => {
  it('adds both Offerpath documents, de-duplicates, and reads them back from storage', async () => {
    vi.mocked(invokeIpc).mockResolvedValue(readableFileProbe());

    await selectProjectContextDocument('project-offerpath', offerpathSource);
    await selectProjectContextDocument('project-offerpath', offerpathChecklist);
    await selectProjectContextDocument('project-offerpath', offerpathSource);

    expect(await listProjectContextDocuments('project-offerpath')).toMatchObject([
      { projectId: 'project-offerpath', relPath: offerpathChecklist },
      { projectId: 'project-offerpath', relPath: offerpathSource },
    ]);
    expect(await listProjectContextDocuments('project-offerpath')).toHaveLength(2);
    expect(vi.mocked(invokeIpc)).toHaveBeenCalledTimes(3);
  });

  it('keeps context documents isolated between Offerpath and PromptForge', async () => {
    vi.mocked(invokeIpc).mockResolvedValue(readableFileProbe());

    await selectProjectContextDocument('project-offerpath', offerpathSource);
    await selectProjectContextDocument('project-promptforge', 'docs/PROJECT_STATE.md');

    expect((await listProjectContextDocuments('project-offerpath')).map((doc) => doc.relPath))
      .toEqual([offerpathSource]);
    expect((await listProjectContextDocuments('project-promptforge')).map((doc) => doc.relPath))
      .toEqual(['docs/PROJECT_STATE.md']);
  });

  it('rejects absolute paths and every parent traversal before filesystem access', async () => {
    await expect(selectProjectContextDocument('project-offerpath', '/tmp/outside.md'))
      .rejects.toThrow('relative');
    await expect(selectProjectContextDocument('project-offerpath', '../outside.md'))
      .rejects.toThrow('parent traversal');
    await expect(selectProjectContextDocument('project-offerpath', 'docs/../outside.md'))
      .rejects.toThrow('parent traversal');
    expect(invokeIpc).not.toHaveBeenCalled();
  });

  it('reports missing, directory, non-regular, and unreadable paths', async () => {
    vi.mocked(invokeIpc)
      .mockResolvedValueOnce({ exists: false, isDir: false, isFile: false, readable: false })
      .mockResolvedValueOnce({ exists: true, isDir: true, isFile: false, readable: false })
      .mockResolvedValueOnce({ exists: true, isDir: false, isFile: false, readable: false })
      .mockResolvedValueOnce({ exists: true, isDir: false, isFile: true, readable: false });

    await expect(selectProjectContextDocument('project-offerpath', 'missing.md'))
      .rejects.toThrow('does not exist');
    await expect(selectProjectContextDocument('project-offerpath', 'docs'))
      .rejects.toThrow('regular file');
    await expect(selectProjectContextDocument('project-offerpath', 'device'))
      .rejects.toThrow('regular file');
    await expect(selectProjectContextDocument('project-offerpath', 'secret.md'))
      .rejects.toThrow('not readable');
  });

  it('exposes syntactic errors for inline UI validation and accepts a valid relative path', () => {
    expect(projectContextPathInputError('')).toBeNull();
    expect(projectContextPathInputError('docs/offerpath-v2/source.md')).toBeNull();
    expect(projectContextPathInputError('C:/outside.md')).toContain('relative');
    expect(projectContextPathInputError('docs/../outside.md')).toContain('parent traversal');
    expect(normalizeProjectContextPath('docs/offerpath-v2/source.md')).toBe('docs/offerpath-v2/source.md');
  });
});
