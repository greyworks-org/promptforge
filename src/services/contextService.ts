import { getAppDb } from '../db/appDb';
import {
  createContextDocsRepository,
  type ContextDocRecord,
  type ContextDocsRepository,
} from '../db/repos/contextDocs';
import type { QueryRunner } from '../db/runner';
import { readTextFile, listDirectory, fileExists } from './projectFs';
import { estimateTokens } from './tokenBudget';

/**
 * Context registry service (Phase 4).
 *
 * Synchronises the `context_docs` table with the actual files in
 * `.promptforge/context/`.  Only files whose content hash changed are
 * re-summarised; untouched files keep their existing summary.
 *
 * All operations are project-scoped (`projectId` mandatory).
 */

const CONTEXT_DIR = '.promptforge/context';

let testRunner: QueryRunner | null = null;

/** Test seam: run against an in-memory database. */
export function setDbForTests(runner: QueryRunner | null): void {
  testRunner = runner;
}

async function repo(): Promise<ContextDocsRepository> {
  return createContextDocsRepository(testRunner ?? (await getAppDb()));
}

/**
 * SHA-256 hash of a string, hex-encoded.
 * Uses the Web Crypto API (available in Tauri webview and Node 19+).
 */
export async function sha256(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface SyncResult {
  /** Docs that were created or updated (content hash changed). */
  changed: ContextDocRecord[];
  /** Docs whose content hash matched — no update needed. */
  unchanged: ContextDocRecord[];
  /** Docs that were in the DB but the file no longer exists. */
  removed: string[];
  /** Errors encountered during sync (non-fatal; individual file failures). */
  errors: string[];
}

/**
 * Sync the context-doc registry for a project: scan the
 * `.promptforge/context/` directory, hash each file, and upsert
 * rows whose content has changed. Remove rows for files that
 * no longer exist.
 */
export async function syncContextRegistry(
  projectId: string,
): Promise<SyncResult> {
  const ctxRepo = await repo();
  const changed: ContextDocRecord[] = [];
  const unchanged: ContextDocRecord[] = [];
  const removed: string[] = [];
  const errors: string[] = [];

  // Check whether the context directory exists.
  const contextDirExists = await fileExists(projectId, CONTEXT_DIR);
  if (!contextDirExists) {
    // No context directory — remove all existing rows for this project.
    const existing = await ctxRepo.listByProject(projectId);
    for (const doc of existing) {
      await ctxRepo.remove(doc.id);
      removed.push(doc.relPath);
    }
    return { changed, unchanged, removed, errors };
  }

  // List files in the context directory.
  let entries: Array<{ name: string; isDir: boolean; sizeBytes: number }>;
  try {
    entries = await listDirectory(projectId, CONTEXT_DIR);
  } catch (err) {
    errors.push(`Could not list context directory: ${err instanceof Error ? err.message : String(err)}`);
    return { changed, unchanged, removed, errors };
  }

  const existingDocs = await ctxRepo.listByProject(projectId);
  const existingByPath = new Map(existingDocs.map((d) => [d.relPath, d]));
  const seenPaths = new Set<string>();

  for (const entry of entries) {
    if (entry.isDir) continue;
    if (!entry.name.endsWith('.md')) continue;

    const relPath = `${CONTEXT_DIR}/${entry.name}`;
    seenPaths.add(relPath);

    let content: string;
    try {
      content = await readTextFile(projectId, relPath);
    } catch (err) {
      errors.push(`Could not read ${relPath}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const contentHash = await sha256(content);
    const estTokens = estimateTokens(content);

    const existing = existingByPath.get(relPath);
    if (existing && existing.contentHash === contentHash) {
      unchanged.push(existing);
      continue;
    }

    const title = entry.name.replace(/\.md$/, '');
    const summary = existing?.summary ?? null;
    const tags = existing?.tags ?? [];
    const taskTypes = existing?.taskTypes ?? [];

    const id = existing?.id ?? `${projectId}:${relPath}`;
    const now = new Date().toISOString();

    const upserted = await ctxRepo.upsert({
      id,
      projectId,
      relPath,
      title,
      summary,
      tags,
      taskTypes,
      contentHash,
      estTokens,
      lastScannedAt: now,
    });

    if (existing && existing.contentHash !== contentHash) {
      changed.push(upserted);
    } else if (!existing) {
      changed.push(upserted);
    }
  }

  // Remove rows for files that no longer exist.
  for (const doc of existingDocs) {
    if (!seenPaths.has(doc.relPath)) {
      await ctxRepo.remove(doc.id);
      removed.push(doc.relPath);
    }
  }

  return { changed, unchanged, removed, errors };
}

/**
 * Return all context docs for a project, sorted by relPath.
 */
export async function listContextDocs(
  projectId: string,
): Promise<ContextDocRecord[]> {
  const ctxRepo = await repo();
  return ctxRepo.listByProject(projectId);
}

/**
 * Read the full content of a context doc (from disk, not DB).
 */
export async function readContextContent(
  projectId: string,
  relPath: string,
): Promise<string> {
  return readTextFile(projectId, relPath);
}
