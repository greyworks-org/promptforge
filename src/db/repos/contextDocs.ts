import { z } from 'zod';
import type { QueryRunner } from '../runner';

/**
 * Repository for the `context_docs` table (DATA_MODEL.md §1.2).
 * All operations are project-scoped — projectId is mandatory.
 */

export const contextDocRowSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  rel_path: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().nullable(),
  tags_json: z.string(),
  task_types_json: z.string(),
  content_hash: z.string().min(1),
  est_tokens: z.number().int().nonnegative(),
  last_scanned_at: z.string().min(1),
});

export interface ContextDocRecord {
  id: string;
  projectId: string;
  relPath: string;
  title: string;
  summary: string | null;
  tags: string[];
  taskTypes: string[];
  contentHash: string;
  estTokens: number;
  lastScannedAt: string;
}

export interface NewContextDoc {
  id: string;
  projectId: string;
  relPath: string;
  title: string;
  summary?: string | null;
  tags?: string[];
  taskTypes?: string[];
  contentHash: string;
  estTokens: number;
  lastScannedAt: string;
}

function rowToRecord(row: z.infer<typeof contextDocRowSchema>): ContextDocRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    relPath: row.rel_path,
    title: row.title,
    summary: row.summary,
    tags: safeJsonParseArray(row.tags_json),
    taskTypes: safeJsonParseArray(row.task_types_json),
    contentHash: row.content_hash,
    estTokens: row.est_tokens,
    lastScannedAt: row.last_scanned_at,
  };
}

function safeJsonParseArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export class ContextDocNotFoundError extends Error {
  constructor(id: string) {
    super(`Context document not found: ${id}`);
    this.name = 'ContextDocNotFoundError';
  }
}

export interface ContextDocsRepository {
  getById(id: string): Promise<ContextDocRecord | null>;
  getByProjectAndPath(projectId: string, relPath: string): Promise<ContextDocRecord | null>;
  listByProject(projectId: string): Promise<ContextDocRecord[]>;
  upsert(doc: NewContextDoc): Promise<ContextDocRecord>;
  remove(id: string): Promise<boolean>;
  /** Search with FTS5 or LIKE fallback. Returns matching doc IDs ordered by rank. */
  searchFts(projectId: string, query: string): Promise<string[]>;
  /** LIKE-based search — always available, used when FTS5 is unavailable. */
  searchLike(projectId: string, query: string): Promise<string[]>;
}

export function createContextDocsRepository(runner: QueryRunner): ContextDocsRepository {
  return {
    async getById(id) {
      const rows = await runner.select<Record<string, unknown>>(
        `SELECT id, project_id, rel_path, title, summary, tags_json,
                task_types_json, content_hash, est_tokens, last_scanned_at
         FROM context_docs WHERE id = ?`,
        [id],
      );
      if (rows.length === 0) return null;
      return rowToRecord(contextDocRowSchema.parse(rows[0]));
    },

    async getByProjectAndPath(projectId, relPath) {
      const rows = await runner.select<Record<string, unknown>>(
        `SELECT id, project_id, rel_path, title, summary, tags_json,
                task_types_json, content_hash, est_tokens, last_scanned_at
         FROM context_docs WHERE project_id = ? AND rel_path = ?`,
        [projectId, relPath],
      );
      if (rows.length === 0) return null;
      return rowToRecord(contextDocRowSchema.parse(rows[0]));
    },

    async listByProject(projectId) {
      const rows = await runner.select<Record<string, unknown>>(
        `SELECT id, project_id, rel_path, title, summary, tags_json,
                task_types_json, content_hash, est_tokens, last_scanned_at
         FROM context_docs
         WHERE project_id = ?
         ORDER BY rel_path COLLATE NOCASE ASC`,
        [projectId],
      );
      return rows.map((r) => rowToRecord(contextDocRowSchema.parse(r)));
    },

    async upsert(doc) {
      const now = new Date().toISOString();
      const id = doc.id;
      const tags = JSON.stringify(doc.tags ?? []);
      const taskTypes = JSON.stringify(doc.taskTypes ?? []);
      const summary = doc.summary ?? null;

      const existing = await this.getByProjectAndPath(doc.projectId, doc.relPath);
      if (existing) {
        await runner.execute(
          `UPDATE context_docs
           SET title = ?, summary = ?, tags_json = ?, task_types_json = ?,
               content_hash = ?, est_tokens = ?, last_scanned_at = ?
           WHERE id = ?`,
          [doc.title, summary, tags, taskTypes, doc.contentHash, doc.estTokens, now, existing.id],
        );
        return (await this.getById(existing.id))!;
      }

      await runner.execute(
        `INSERT INTO context_docs (id, project_id, rel_path, title, summary,
           tags_json, task_types_json, content_hash, est_tokens, last_scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, doc.projectId, doc.relPath, doc.title, summary, tags, taskTypes, doc.contentHash, doc.estTokens, now],
      );
      return (await this.getById(id))!;
    },

    async remove(id) {
      const affected = await runner.execute('DELETE FROM context_docs WHERE id = ?', [id]);
      return affected > 0;
    },

    async searchFts(projectId, query) {
      // Escape FTS5 special characters and build a prefix query.
      const safeQuery = query.replace(/['"*^()]/g, '').trim();
      if (safeQuery === '') return [];
      try {
        const rows = await runner.select<{ id: string; rank: number }>(
          `SELECT context_docs.id, rank
           FROM context_docs_fts
           JOIN context_docs ON context_docs.rowid = context_docs_fts.rowid
           WHERE context_docs_fts MATCH ? AND context_docs.project_id = ?
           ORDER BY rank
           LIMIT 50`,
          [`"${safeQuery}"*`, projectId],
        );
        return rows.map((r) => r.id);
      } catch {
        // FTS5 unavailable — caller should fall back to LIKE.
        throw new Error('FTS5 unavailable');
      }
    },

    async searchLike(projectId, query) {
      const pattern = `%${query.replace(/[%_]/g, '').trim()}%`;
      if (pattern === '%%') return [];
      const rows = await runner.select<{ id: string }>(
        `SELECT id FROM context_docs
         WHERE project_id = ?
           AND (title LIKE ? OR tags_json LIKE ? OR summary LIKE ?)
         ORDER BY rel_path COLLATE NOCASE ASC
         LIMIT 50`,
        [projectId, pattern, pattern, pattern],
      );
      return rows.map((r) => r.id);
    },
  };
}
