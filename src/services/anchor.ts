import { invokeIpc } from '../ipc';
import { fileExists, readTextFile, writeTextFile } from './projectFs';
import type { ProjectRecord } from '../db/repos/projects';

/**
 * Anchor file handling (Phase 3, trust-boundary hardened).
 *
 * Post-registration reads and writes go through the scoped fs commands
 * (projectId → Rust resolves canonical root from registry).
 *
 * Pre-registration anchor checks use the narrow `fs_read_anchor` command
 * which is restricted to `.promptforge/project.json` files only.
 */

export interface AnchorPayload {
  schema: 'promptforge.anchor/1';
  projectId: string;
  name: string;
  createdAt: string;
}

const ANCHOR_SCHEMA = 'promptforge.anchor/1';
export const ANCHOR_REL_PATH = '.promptforge/project.json';

export function serializeAnchor(payload: AnchorPayload): string {
  return JSON.stringify(payload, null, 2) + '\n';
}

export function parseAnchor(raw: string): AnchorPayload | null {
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj === null || typeof obj !== 'object') return null;
    const candidate = obj as Record<string, unknown>;
    if (candidate.schema !== ANCHOR_SCHEMA) return null;
    if (typeof candidate.projectId !== 'string' || candidate.projectId === '') return null;
    if (typeof candidate.name !== 'string' || candidate.name === '') return null;
    if (typeof candidate.createdAt !== 'string' || candidate.createdAt === '') return null;
    return {
      schema: ANCHOR_SCHEMA,
      projectId: candidate.projectId as string,
      name: candidate.name as string,
      createdAt: candidate.createdAt as string,
    };
  } catch {
    return null;
  }
}

/** Read the anchor for a registered project. */
export async function readAnchor(projectId: string): Promise<AnchorPayload | null> {
  try {
    if (!(await fileExists(projectId, ANCHOR_REL_PATH))) return null;
    const raw = await readTextFile(projectId, ANCHOR_REL_PATH);
    return parseAnchor(raw);
  } catch {
    return null;
  }
}

/** Write the anchor for a registered project (overwrites allowed). */
export async function writeAnchor(projectId: string, project: ProjectRecord): Promise<void> {
  const payload: AnchorPayload = {
    schema: ANCHOR_SCHEMA,
    projectId: project.id,
    name: project.name,
    createdAt: project.createdAt,
  };
  await writeTextFile(projectId, ANCHOR_REL_PATH, serializeAnchor(payload), true);
}

/**
 * Check whether a candidate folder (user-selected, pre-registration) contains
 * an anchor matching an existing project at a different path.
 *
 * Uses the narrow `fs_read_anchor` Rust command — restricted to
 * `.promptforge/project.json` files only.
 */
export async function findReLinkCandidate(
  candidatePath: string,
  existingProjects: ProjectRecord[],
): Promise<ProjectRecord | null> {
  const anchorAbsPath = `${candidatePath}/${ANCHOR_REL_PATH}`;
  try {
    const raw = await invokeIpc<string | null>('fs_read_anchor', { path: anchorAbsPath });
    if (raw === null) return null;
    const anchor = parseAnchor(raw);
    if (anchor === null) return null;

    const match = existingProjects.find(
      (p) => p.id === anchor.projectId && p.repoPath !== candidatePath,
    );
    return match ?? null;
  } catch {
    return null;
  }
}
