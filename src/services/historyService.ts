import { getAppDb } from '../db/appDb';
import {
  createCompilationsRepository,
  type CompilationsRepository,
  type CompilationRecord,
  type NewCompilation,
} from '../db/repos/compilations';
import type { QueryRunner } from '../db/runner';

/**
 * History service (Phase 8).
 *
 * Records every compilation attempt. Failures are recorded with their
 * user-safe error. Project-scoped — all access requires projectId.
 */

let testRunner: QueryRunner | null = null;
export function setDbForTests(runner: QueryRunner | null): void { testRunner = runner; }

async function repo(): Promise<CompilationsRepository> {
  return createCompilationsRepository(testRunner ?? (await getAppDb()));
}

export interface RecordCompileInput {
  projectId: string;
  rawRequest: string;
  taskType: string;
  executionMode: string;
  targetModel?: string;
  agentRuntime?: string;
  executionProfile?: string;
  profileVersion?: string;
  providerLabel: string;
  modelId: string;
  contextDocIds: string[];
  contextSent: string;
  status: string;
  taskspecJson?: string | null;
  error?: string | null;
}

export async function recordCompilation(input: RecordCompileInput): Promise<CompilationRecord> {
  const r = await repo();
  const id = `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return r.insert({
    id,
    ...input,
    taskType: input.taskType,
    executionMode: input.executionMode,
    providerLabel: input.providerLabel,
    modelId: input.modelId,
    contextSent: input.contextSent,
    rawRequest: input.rawRequest,
    status: input.status,
  });
}

export async function updateCompilation(
  id: string,
  patch: Partial<NewCompilation>,
): Promise<CompilationRecord | null> {
  const r = await repo();
  return r.update(id, patch);
}

export async function getCompilation(id: string): Promise<CompilationRecord | null> {
  return (await repo()).getById(id);
}

export async function listHistory(
  projectId: string,
  limit = 50,
  offset = 0,
): Promise<CompilationRecord[]> {
  return (await repo()).listByProject(projectId, limit, offset);
}
