import { z } from 'zod';
import type { QueryRunner } from '../runner';
import {
  projectIntelligenceDocumentSchema,
  type ProjectIntelligence,
  type ProjectIntelligenceDocument,
} from '../../intelligence/types';

const intelligenceRowSchema = z.object({
  project_id: z.string().min(1),
  schema_version: z.string().min(1),
  document_json: z.string().min(1),
  source_head: z.string().nullable(),
  bootstrapped_at: z.string().min(1),
  reconciled_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export interface IntelligenceUpsert {
  schemaVersion: string;
  document: ProjectIntelligenceDocument;
  sourceHead: string | null;
  /** Preserved on reconciliation; only set when the record is created. */
  bootstrappedAt: string;
  reconciledAt: string;
}

export interface ProjectIntelligenceRepository {
  getByProject(projectId: string): Promise<ProjectIntelligence | null>;
  upsert(projectId: string, input: IntelligenceUpsert): Promise<ProjectIntelligence>;
}

function rowToRecord(row: z.infer<typeof intelligenceRowSchema>): ProjectIntelligence {
  const document = projectIntelligenceDocumentSchema.parse(JSON.parse(row.document_json));
  return {
    ...document,
    projectId: row.project_id,
    schemaVersion: row.schema_version,
    sourceHead: row.source_head,
    bootstrappedAt: row.bootstrapped_at,
    reconciledAt: row.reconciled_at,
    updatedAt: row.updated_at,
  };
}

export function createProjectIntelligenceRepository(runner: QueryRunner): ProjectIntelligenceRepository {
  const getByProject = async (projectId: string): Promise<ProjectIntelligence | null> => {
    const rows = await runner.select<Record<string, unknown>>(
      'SELECT project_id, schema_version, document_json, source_head, bootstrapped_at, reconciled_at, updated_at FROM project_intelligence WHERE project_id = ?',
      [projectId],
    );
    return rows.length > 0 ? rowToRecord(intelligenceRowSchema.parse(rows[0])) : null;
  };

  return {
    getByProject,

    async upsert(projectId, input) {
      const document = projectIntelligenceDocumentSchema.parse(input.document);
      const now = new Date().toISOString();
      const existing = await getByProject(projectId);
      if (existing === null) {
        await runner.execute(
          `INSERT INTO project_intelligence (project_id, schema_version, document_json, source_head,
           bootstrapped_at, reconciled_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
          [projectId, input.schemaVersion, JSON.stringify(document), input.sourceHead, input.bootstrappedAt, input.reconciledAt, now],
        );
      } else {
        await runner.execute(
          `UPDATE project_intelligence SET schema_version = ?, document_json = ?, source_head = ?,
           reconciled_at = ?, updated_at = ? WHERE project_id = ?`,
          [input.schemaVersion, JSON.stringify(document), input.sourceHead, input.reconciledAt, now, projectId],
        );
      }
      const saved = await getByProject(projectId);
      if (saved === null) throw new Error('Project intelligence could not be persisted.');
      return saved;
    },
  };
}
