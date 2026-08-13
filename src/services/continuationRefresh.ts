import type { CompilationRecord } from '../db/repos/compilations';
import type { MemoryRecord } from '../db/repos/projectMemory';
import type { TaskSpec } from '../schemas/taskspec';
import type { GitSnapshot } from './gitState';
import { deriveContinuationState, type ContinuationState } from '../handoff/continuationState';
import { listExecutionSessions, listSessionEvents } from '../sessions/executionSessionService';
import type { SessionRuntime } from '../sessions/types';

/** Load the active compilation session when the session store is available. */
export async function deriveActiveSessionContinuation(input: {
  projectId: string;
  task: TaskSpec | null;
  compilation: CompilationRecord | null;
  memory: MemoryRecord;
  git: GitSnapshot;
  runtime: SessionRuntime;
}): Promise<ContinuationState | null> {
  try {
    if (typeof listExecutionSessions !== 'function') return null;
    const sessions = await listExecutionSessions(input.projectId);
    const session = input.compilation
      ? sessions.find((candidate) => candidate.compilationId === input.compilation?.id) ?? null
      : null;
    if (session === null) return null;
    const events = await listSessionEvents(input.projectId, session.id);
    return deriveContinuationState({
      task: input.task,
      session,
      events,
      memory: input.memory,
      git: input.git,
      currentCompilationProvider: input.compilation?.providerLabel ?? null,
      target: { runtime: input.runtime, binding: session.runtime === input.runtime ? session.binding : {} },
    });
  } catch {
    return null;
  }
}
