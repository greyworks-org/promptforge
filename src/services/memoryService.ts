import { getAppDb } from '../db/appDb';
import { createProjectMemoryRepository, type MemoryRecord, type ProjectMemoryRepository } from '../db/repos/projectMemory';
import type { QueryRunner } from '../db/runner';

/**
 * Project memory service (Phase 9).
 *
 * Project-scoped reads and updates of the central per-project memory
 * record. Memory observes and references repository reality — it never
 * overrides it. All state changes require user-confirmed actions.
 */

let testRunner: QueryRunner | null = null;
export function setDbForTests(runner: QueryRunner | null): void { testRunner = runner; }

async function repo(): Promise<ProjectMemoryRepository> {
  return createProjectMemoryRepository(testRunner ?? (await getAppDb()));
}

/** Get or create the memory record for a project. */
export async function getMemory(projectId: string): Promise<MemoryRecord> {
  const r = await repo();
  const existing = await r.getByProject(projectId);
  return existing ?? r.upsert(projectId, {});
}

/** Update memory fields. Only the provided fields change. */
export async function updateMemory(
  projectId: string,
  patch: Partial<MemoryRecord>,
): Promise<MemoryRecord> {
  return (await repo()).upsert(projectId, patch);
}

/** Advance the task chain after a successful compilation. */
export async function recordCompileSuccess(
  projectId: string,
  taskId: string,
): Promise<MemoryRecord> {
  return updateMemory(projectId, {
    currentTaskId: taskId,
  });
}

/** Mark the current task as validated (done). Advances last_validated and clears current. */
export async function markTaskValidated(projectId: string): Promise<MemoryRecord> {
  const mem = await getMemory(projectId);
  return updateMemory(projectId, {
    lastValidatedTaskId: mem.currentTaskId,
    currentTaskId: null,
  });
}

/** Add a confirmed decision. */
export async function addDecision(
  projectId: string,
  text: string,
  taskId?: string,
): Promise<MemoryRecord> {
  const mem = await getMemory(projectId);
  return updateMemory(projectId, {
    decisions: [...mem.decisions, { text, at: new Date().toISOString(), taskId }],
  });
}

/** Add or update a blocker. */
export async function setBlockers(
  projectId: string,
  blockers: MemoryRecord['blockers'],
): Promise<MemoryRecord> {
  return updateMemory(projectId, { blockers });
}
