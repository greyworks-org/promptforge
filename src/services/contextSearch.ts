import type { ContextDocsRepository } from '../db/repos/contextDocs';
import type { QueryRunner } from '../db/runner';

/**
 * Context search service (Phase 4).
 *
 * Creates the FTS5 virtual table lazily at first use (not via migration,
 * so FTS5-unavailable builds don't block startup). Falls back to LIKE
 * when FTS5 is unavailable. Both paths produce identical result shapes.
 */

export interface SearchResult {
  docId: string;
  source: 'fts5' | 'like';
}

export interface Fts5Availability {
  available: boolean;
  reason?: string;
}

const FTS5_DDL = `CREATE VIRTUAL TABLE IF NOT EXISTS context_docs_fts USING fts5(
  title, tags, summary, content='context_docs', content_rowid='rowid'
)`;

let fts5Cache: Fts5Availability | null = null;

/**
 * Check whether FTS5 is available.  Tries to create the virtual table
 * lazily; caches the result.  Failures are non-fatal — the caller falls
 * back to LIKE.
 */
export async function checkFts5Availability(
  runner: QueryRunner,
): Promise<Fts5Availability> {
  if (fts5Cache !== null) return fts5Cache;
  try {
    await runner.execute(FTS5_DDL);
    fts5Cache = { available: true };
  } catch (err) {
    fts5Cache = {
      available: false,
      reason: err instanceof Error ? err.message : 'FTS5 not available',
    };
  }
  return fts5Cache;
}

/**
 * Search context documents for a project.
 * Uses FTS5 when available; falls back to LIKE otherwise.
 */
export async function searchContextDocs(
  runner: QueryRunner,
  repo: ContextDocsRepository,
  projectId: string,
  query: string,
): Promise<SearchResult[]> {
  const fts5 = await checkFts5Availability(runner);

  if (fts5.available) {
    try {
      const ids = await repo.searchFts(projectId, query);
      return ids.map((docId) => ({ docId, source: 'fts5' as const }));
    } catch {
      // FTS5 failed at runtime — fall through to LIKE.
    }
  }

  const ids = await repo.searchLike(projectId, query);
  return ids.map((docId) => ({ docId, source: 'like' as const }));
}

/** Reset the FTS5 availability cache (test seam). */
export function resetFts5CacheForTests(): void {
  fts5Cache = null;
}
