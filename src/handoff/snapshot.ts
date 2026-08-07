import type { MemoryRecord } from '../db/repos/projectMemory';
import type { TaskSpec } from '../schemas/taskspec';
import type { GitSnapshot } from '../services/gitState';

/**
 * Handoff snapshot assembly (Phase 10).
 *
 * Combines project memory, live git snapshot, and the current canonical
 * TaskSpec into a single HandoffSnapshot. Assembly is local-only —
 * zero provider calls. Project-id consistency is validated at assembly
 * time.
 */

export interface HandoffSnapshot {
  /** The project this handoff is for. */
  projectId: string;
  /** The project's name (from the registry). */
  projectName: string;
  /** The project's current memory record. */
  memory: MemoryRecord;
  /** Live git state (computed on every assembly). */
  git: GitSnapshot;
  /** The current canonical TaskSpec (if a task is in flight). */
  currentTask: TaskSpec | null;
  /** When the snapshot was assembled. */
  assembledAt: string;
}

export class HandoffIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandoffIsolationError';
  }
}

export interface AssembleSnapshotInput {
  projectId: string;
  projectName: string;
  memory: MemoryRecord;
  git: GitSnapshot;
  currentTask: TaskSpec | null;
}

/**
 * Assemble a HandoffSnapshot. Validates that the project identifiers
 * are consistent — mismatched project/task IDs throw.
 */
export function assembleSnapshot(input: AssembleSnapshotInput): HandoffSnapshot {
  // Validate project-id consistency.
  if (input.memory.projectId !== input.projectId) {
    throw new HandoffIsolationError(
      `Memory projectId '${input.memory.projectId}' does not match handoff projectId '${input.projectId}'`,
    );
  }

  // If a task is in flight, it must belong to this project.
  if (input.currentTask !== null) {
    if (input.currentTask.project_id !== input.projectId) {
      throw new HandoffIsolationError(
        `Task project_id '${input.currentTask.project_id}' does not match handoff projectId '${input.projectId}'`,
      );
    }
    if (input.memory.currentTaskId !== null && input.memory.currentTaskId !== input.currentTask.task_id) {
      throw new HandoffIsolationError(
        `Memory currentTaskId '${input.memory.currentTaskId}' does not match task_id '${input.currentTask.task_id}'`,
      );
    }
  }

  return {
    ...input,
    assembledAt: new Date().toISOString(),
  };
}
