import { getAppDb } from '../db/appDb';
import {
  createProjectContextDocumentsRepository,
  type ProjectContextDocument,
} from '../db/repos/projectContextDocuments';
import { invokeIpc } from '../ipc';
import type { QueryRunner } from '../db/runner';

interface ScopedFsMetadata {
  exists: boolean;
  isDir: boolean;
  isFile: boolean;
  readable: boolean;
}

let testRunner: QueryRunner | null = null;

export function setProjectContextDbForTests(runner: QueryRunner | null): void {
  testRunner = runner;
}

async function repository() {
  return createProjectContextDocumentsRepository(testRunner ?? (await getAppDb()));
}

/** Keep the stored allowlist portable and prevent filesystem escape at the UI boundary. */
export function normalizeProjectContextPath(raw: string): string {
  const value = raw.trim().replaceAll('\\', '/');
  if (
    value === ''
    || value.startsWith('/')
    || /^[A-Za-z]:\//.test(value)
    || value.includes('\0')
  ) {
    throw new Error('Context document path must be a non-empty relative path.');
  }
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      throw new Error('Context document path cannot contain parent traversal (..).');
    }
    parts.push(part);
  }
  const normalized = parts.join('/');
  if (normalized === '' || normalized.length > 512) {
    throw new Error('Context document path is invalid or too long.');
  }
  return normalized;
}

/** Return an inline validation error without probing the filesystem. */
export function projectContextPathInputError(raw: string): string | null {
  if (raw.trim() === '') return null;
  try {
    normalizeProjectContextPath(raw);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Context document path is invalid.';
  }
}

export async function listProjectContextDocuments(projectId: string): Promise<ProjectContextDocument[]> {
  return (await repository()).listByProject(projectId);
}

export async function selectProjectContextDocument(projectId: string, rawPath: string): Promise<ProjectContextDocument> {
  const relPath = normalizeProjectContextPath(rawPath);
  const metadata = await invokeIpc<ScopedFsMetadata>('fs_metadata_scoped', { projectId, path: relPath });
  if (!metadata.exists) throw new Error(`Context document does not exist: ${relPath}`);
  if (metadata.isDir || !metadata.isFile) throw new Error(`Context document must be a regular file: ${relPath}`);
  if (!metadata.readable) throw new Error(`Context document is not readable: ${relPath}`);
  return (await repository()).add(projectId, relPath);
}

export async function removeProjectContextDocument(projectId: string, rawPath: string): Promise<boolean> {
  const relPath = normalizeProjectContextPath(rawPath);
  return (await repository()).remove(projectId, relPath);
}
