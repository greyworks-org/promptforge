import { z } from 'zod';
import type { QueryRunner } from '../runner';

/** Row shape as stored in SQLite; validated on every read (boundary rule). */
export const projectRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  repo_path: z.string().min(1),
  current_milestone: z.string().nullable(),
  settings_json: z.string().min(1),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export interface ProjectRecord {
  id: string;
  name: string;
  repoPath: string;
  currentMilestone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewProject {
  id: string;
  name: string;
  repoPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPatch {
  name?: string;
  currentMilestone?: string | null;
}

export class DuplicateRepoPathError extends Error {
  constructor(
    public readonly repoPath: string,
    public readonly existingProjectName: string,
  ) {
    super(`This folder is already registered as "${existingProjectName}".`);
    this.name = 'DuplicateRepoPathError';
  }
}

export class ProjectNotFoundError extends Error {
  constructor(public readonly projectId: string) {
    super(`Project "${projectId}" was not found.`);
    this.name = 'ProjectNotFoundError';
  }
}

export interface ProjectsRepository {
  insert(project: NewProject): Promise<ProjectRecord>;
  getById(id: string): Promise<ProjectRecord | null>;
  getByRepoPath(repoPath: string): Promise<ProjectRecord | null>;
  list(): Promise<ProjectRecord[]>;
  update(id: string, patch: ProjectPatch): Promise<ProjectRecord>;
  /** Returns false when no row was removed. Cascades to project-scoped tables. */
  remove(id: string): Promise<boolean>;
}

function toRecord(row: unknown): ProjectRecord {
  const parsed = projectRowSchema.parse(row);
  return {
    id: parsed.id,
    name: parsed.name,
    repoPath: parsed.repo_path,
    currentMilestone: parsed.current_milestone,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  };
}

function isRepoPathUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed: projects\.repo_path/.test(err.message);
}

export function createProjectsRepository(runner: QueryRunner): ProjectsRepository {
  const getById = async (id: string): Promise<ProjectRecord | null> => {
    const rows = await runner.select<Record<string, unknown>>(
      'SELECT id, name, repo_path, current_milestone, settings_json, created_at, updated_at FROM projects WHERE id = ?',
      [id],
    );
    return rows.length > 0 ? toRecord(rows[0]) : null;
  };

  const getByRepoPath = async (repoPath: string): Promise<ProjectRecord | null> => {
    const rows = await runner.select<Record<string, unknown>>(
      'SELECT id, name, repo_path, current_milestone, settings_json, created_at, updated_at FROM projects WHERE repo_path = ?',
      [repoPath],
    );
    return rows.length > 0 ? toRecord(rows[0]) : null;
  };

  return {
    async insert(project: NewProject): Promise<ProjectRecord> {
      try {
        await runner.execute(
          'INSERT INTO projects (id, name, repo_path, current_milestone, settings_json, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?)',
          [project.id, project.name, project.repoPath, '{}', project.createdAt, project.updatedAt],
        );
      } catch (err) {
        if (isRepoPathUniqueViolation(err)) {
          const existing = await getByRepoPath(project.repoPath);
          throw new DuplicateRepoPathError(project.repoPath, existing?.name ?? 'another project');
        }
        throw err;
      }
      const saved = await getById(project.id);
      if (saved === null) throw new Error('Project insert failed unexpectedly.');
      return saved;
    },

    getById,
    getByRepoPath,

    async list(): Promise<ProjectRecord[]> {
      const rows = await runner.select<Record<string, unknown>>(
        'SELECT id, name, repo_path, current_milestone, settings_json, created_at, updated_at FROM projects ORDER BY name COLLATE NOCASE ASC',
      );
      return rows.map(toRecord);
    },

    async update(id: string, patch: ProjectPatch): Promise<ProjectRecord> {
      const existing = await getById(id);
      if (existing === null) throw new ProjectNotFoundError(id);
      const name = patch.name ?? existing.name;
      if (name.trim() === '') throw new Error('Project name must not be empty.');
      const milestone =
        patch.currentMilestone === undefined ? existing.currentMilestone : patch.currentMilestone;
      await runner.execute('UPDATE projects SET name = ?, current_milestone = ?, updated_at = ? WHERE id = ?', [
        name,
        milestone,
        new Date().toISOString(),
        id,
      ]);
      const fresh = await getById(id);
      if (fresh === null) throw new ProjectNotFoundError(id);
      return fresh;
    },

    async remove(id: string): Promise<boolean> {
      const affected = await runner.execute('DELETE FROM projects WHERE id = ?', [id]);
      return affected > 0;
    },
  };
}
