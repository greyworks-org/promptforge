import { z } from 'zod';
import type { QueryRunner } from '../runner';

const rowSchema = z.object({
  project_id: z.string().min(1),
  rel_path: z.string().min(1),
  selected_at: z.string().min(1),
});

export interface ProjectContextDocument {
  projectId: string;
  relPath: string;
  selectedAt: string;
}

function toRecord(row: unknown): ProjectContextDocument {
  const parsed = rowSchema.parse(row);
  return { projectId: parsed.project_id, relPath: parsed.rel_path, selectedAt: parsed.selected_at };
}

export interface ProjectContextDocumentsRepository {
  listByProject(projectId: string): Promise<ProjectContextDocument[]>;
  add(projectId: string, relPath: string): Promise<ProjectContextDocument>;
  remove(projectId: string, relPath: string): Promise<boolean>;
}

export function createProjectContextDocumentsRepository(runner: QueryRunner): ProjectContextDocumentsRepository {
  const select = async (projectId: string, relPath?: string): Promise<ProjectContextDocument[]> => {
    const suffix = relPath === undefined ? '' : ' AND rel_path = ?';
    const params = relPath === undefined ? [projectId] : [projectId, relPath];
    const rows = await runner.select<Record<string, unknown>>(
      `SELECT project_id, rel_path, selected_at
       FROM project_context_documents WHERE project_id = ?${suffix}
       ORDER BY rel_path COLLATE NOCASE ASC`,
      params,
    );
    return rows.map(toRecord);
  };

  return {
    listByProject: (projectId) => select(projectId),
    async add(projectId, relPath) {
      const selectedAt = new Date().toISOString();
      await runner.execute(
        `INSERT INTO project_context_documents (project_id, rel_path, selected_at)
         VALUES (?, ?, ?)
         ON CONFLICT(project_id, rel_path) DO UPDATE SET selected_at = excluded.selected_at`,
        [projectId, relPath, selectedAt],
      );
      const saved = (await select(projectId, relPath))[0];
      if (saved === undefined) throw new Error('Project context document was not persisted.');
      return saved;
    },
    async remove(projectId, relPath) {
      const affected = await runner.execute(
        'DELETE FROM project_context_documents WHERE project_id = ? AND rel_path = ?',
        [projectId, relPath],
      );
      return affected > 0;
    },
  };
}
