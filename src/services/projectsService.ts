import { getAppDb } from '../db/appDb';
import {
  createProjectsRepository,
  DuplicateRepoPathError,
  ProjectNotFoundError,
  type ProjectRecord,
  type ProjectsRepository,
} from '../db/repos/projects';
import { createSettingsRepository, type SettingsRepository } from '../db/repos/settingsRepo';
import type { QueryRunner } from '../db/runner';
import { invokeIpc } from '../ipc';

/**
 * Project registry (Phase 2). Projects are registered by folder: the path is
 * validated and canonicalized via the read-only Rust `fs_metadata` command,
 * duplicates are rejected, and all lookups are project-scoped. Removing a
 * project deletes only app-DB rows — the folder on disk is never touched.
 */

export { DuplicateRepoPathError, ProjectNotFoundError } from '../db/repos/projects';

export class InvalidFolderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFolderError';
  }
}

const ACTIVE_PROJECT_KEY = 'projects.active';

let testRunner: QueryRunner | null = null;

/** Test seam: run against an in-memory database instead of the app DB. */
export function setDbForTests(runner: QueryRunner | null): void {
  testRunner = runner;
}

async function repos(): Promise<{ projects: ProjectsRepository; settings: SettingsRepository }> {
  const runner = testRunner ?? (await getAppDb());
  return { projects: createProjectsRepository(runner), settings: createSettingsRepository(runner) };
}

interface FsMetadata {
  exists: boolean;
  isDir: boolean;
  canonicalPath: string | null;
}

/**
 * Textual normalization before OS-level canonicalization: trims, requires an
 * absolute path, collapses duplicate separators and resolves `.`/`..`
 * segments. Symlink resolution happens in Rust (`fs_metadata`).
 */
export function normalizeFolderPath(raw: string): string {
  const path = raw.trim();
  if (path === '') throw new InvalidFolderError('Folder path is required.');
  if (!path.startsWith('/')) throw new InvalidFolderError('Folder path must be absolute.');
  const segments: string[] = [];
  for (const segment of path.replace(/\/{2,}/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

export function slugifyProjectId(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'project' : slug;
}

function basename(path: string): string {
  const segments = path.split('/').filter((s) => s !== '');
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

async function allocateProjectId(projects: ProjectsRepository, name: string): Promise<string> {
  const base = `project-${slugifyProjectId(name)}`;
  let candidate = base;
  let suffix = 2;
  while ((await projects.getById(candidate)) !== null) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
    if (suffix > 1000) throw new Error('Could not allocate a unique project id.');
  }
  return candidate;
}

export async function registerProject(input: { folderPath: string; name?: string }): Promise<ProjectRecord> {
  const normalized = normalizeFolderPath(input.folderPath);
  const meta = await invokeIpc<FsMetadata>('fs_metadata', { path: normalized });
  if (!meta.exists) throw new InvalidFolderError('Folder does not exist.');
  if (!meta.isDir) throw new InvalidFolderError('Selected path is not a folder.');
  if (meta.canonicalPath === null) throw new InvalidFolderError('Folder could not be resolved.');
  const repoPath = meta.canonicalPath;

  const { projects } = await repos();
  const existing = await projects.getByRepoPath(repoPath);
  if (existing !== null) throw new DuplicateRepoPathError(repoPath, existing.name);

  const trimmedName = (input.name ?? '').trim();
  const name = trimmedName !== '' ? trimmedName : basename(repoPath);
  const now = new Date().toISOString();
  const id = await allocateProjectId(projects, name);
  return projects.insert({ id, name, repoPath, createdAt: now, updatedAt: now });
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const { projects } = await repos();
  return projects.list();
}

export async function getProject(projectId: string): Promise<ProjectRecord | null> {
  const { projects } = await repos();
  return projects.getById(projectId);
}

export interface ProjectMetadataPatch {
  name?: string;
  currentMilestone?: string | null;
}

export async function updateProject(projectId: string, patch: ProjectMetadataPatch): Promise<ProjectRecord> {
  if (patch.name !== undefined && patch.name.trim() === '') {
    throw new Error('Project name must not be empty.');
  }
  const { projects } = await repos();
  const milestone = patch.currentMilestone;
  return projects.update(projectId, {
    name: patch.name?.trim(),
    currentMilestone:
      milestone === undefined ? undefined : milestone === null || milestone.trim() === '' ? null : milestone.trim(),
  });
}

/**
 * Remove a project from PromptForge: deletes the registry row (project-scoped
 * rows cascade). The folder on disk is never touched (DATA_MODEL.md §5).
 */
export async function removeProject(projectId: string): Promise<void> {
  const { projects, settings } = await repos();
  const removed = await projects.remove(projectId);
  if (!removed) throw new ProjectNotFoundError(projectId);
  const activeId = await settings.get(ACTIVE_PROJECT_KEY);
  if (activeId === projectId) await settings.remove(ACTIVE_PROJECT_KEY);
}

export async function setActiveProject(projectId: string): Promise<void> {
  const { projects, settings } = await repos();
  const project = await projects.getById(projectId);
  if (project === null) throw new ProjectNotFoundError(projectId);
  await settings.set(ACTIVE_PROJECT_KEY, projectId);
}

export async function getActiveProjectId(): Promise<string | null> {
  const { settings } = await repos();
  const value = await settings.get(ACTIVE_PROJECT_KEY);
  return typeof value === 'string' && value !== '' ? value : null;
}

export async function getActiveProject(): Promise<ProjectRecord | null> {
  const id = await getActiveProjectId();
  if (id === null) return null;
  const { projects } = await repos();
  return projects.getById(id);
}
