import { z } from 'zod';
import type { QueryRunner, SqlParam } from '../runner';
import {
  handoffArtifactSchema,
  handoffStatusSchema,
  type HandoffArtifact,
  type HandoffStatus,
} from '../../handoff/crossModel';

const handoffRowSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  task_id: z.string().min(1),
  source_execution_session_id: z.string().min(1),
  target_execution_session_id: z.string().min(1),
  source_runtime: z.string().min(1),
  source_provider_id: z.string().nullable(),
  source_model_id: z.string().nullable(),
  source_model_ref: z.string().nullable(),
  target_runtime: z.literal('opencode'),
  target_provider_id: z.string().min(1),
  target_model_id: z.string().min(1),
  target_model_ref: z.string().min(3),
  status: handoffStatusSchema,
  continuation_json: z.string(),
  created_at: z.string().min(1),
  activated_at: z.string().nullable(),
});

function toArtifact(row: unknown): HandoffArtifact {
  const parsed = handoffRowSchema.parse(row);
  return handoffArtifactSchema.parse({
    handoffId: parsed.id,
    projectId: parsed.project_id,
    taskId: parsed.task_id,
    sourceExecutionSessionId: parsed.source_execution_session_id,
    targetExecutionSessionId: parsed.target_execution_session_id,
    sourceRuntime: parsed.source_runtime,
    sourceProviderId: parsed.source_provider_id,
    sourceModelId: parsed.source_model_id,
    sourceModelRef: parsed.source_model_ref,
    targetRuntime: parsed.target_runtime,
    targetProviderId: parsed.target_provider_id,
    targetModelId: parsed.target_model_id,
    targetModelRef: parsed.target_model_ref,
    createdAt: parsed.created_at,
    status: parsed.status,
    activatedAt: parsed.activated_at,
    continuation: JSON.parse(parsed.continuation_json),
  });
}
const SELECT = `SELECT id, project_id, task_id, source_execution_session_id,
  target_execution_session_id, source_runtime, source_provider_id,
  source_model_id, source_model_ref, target_runtime, target_provider_id,
  target_model_id, target_model_ref, status, continuation_json, created_at,
  activated_at FROM execution_handoffs`;

export interface NewExecutionHandoff {
  handoffId: string;
  projectId: string;
  taskId: string;
  sourceExecutionSessionId: string;
  targetExecutionSessionId: string;
  sourceRuntime: string;
  sourceProviderId: string | null;
  sourceModelId: string | null;
  sourceModelRef: string | null;
  targetProviderId: string;
  targetModelId: string;
  targetModelRef: string;
  continuation: HandoffArtifact['continuation'];
  createdAt: string;
}

export interface ExecutionHandoffsRepository {
  create(input: NewExecutionHandoff): Promise<HandoffArtifact>;
  getById(projectId: string, handoffId: string): Promise<HandoffArtifact | null>;
  getByTargetSession(projectId: string, targetSessionId: string): Promise<HandoffArtifact | null>;
  getPreparedBySource(projectId: string, sourceSessionId: string): Promise<HandoffArtifact | null>;
  updateStatus(projectId: string, handoffId: string, status: HandoffStatus, activatedAt: string | null): Promise<HandoffArtifact | null>;
}

export function createExecutionHandoffsRepository(runner: QueryRunner): ExecutionHandoffsRepository {
  async function getById(projectId: string, handoffId: string): Promise<HandoffArtifact | null> {
    const rows = await runner.select<Record<string, unknown>>(
      `${SELECT} WHERE project_id = ? AND id = ?`, [projectId, handoffId],
    );
    return rows.length === 0 ? null : toArtifact(rows[0]);
  }

  return {
    create: async (input) => {
      await runner.execute(
        `INSERT INTO execution_handoffs
          (id, project_id, task_id, source_execution_session_id, target_execution_session_id,
           source_runtime, source_provider_id, source_model_id, source_model_ref,
           target_runtime, target_provider_id, target_model_id, target_model_ref,
           status, continuation_json, created_at, activated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'opencode', ?, ?, ?, 'prepared', ?, ?, NULL)`,
        [
          input.handoffId, input.projectId, input.taskId, input.sourceExecutionSessionId,
          input.targetExecutionSessionId, input.sourceRuntime, input.sourceProviderId,
          input.sourceModelId, input.sourceModelRef, input.targetProviderId,
          input.targetModelId, input.targetModelRef, JSON.stringify(input.continuation), input.createdAt,
        ],
      );
      const saved = await getById(input.projectId, input.handoffId);
      if (saved === null) throw new Error('Cross-model handoff was not persisted.');
      return saved;
    },

    getById,

    async getByTargetSession(projectId, targetSessionId) {
      const rows = await runner.select<Record<string, unknown>>(
        `${SELECT} WHERE project_id = ? AND target_execution_session_id = ? ORDER BY created_at DESC LIMIT 1`,
        [projectId, targetSessionId],
      );
      return rows.length === 0 ? null : toArtifact(rows[0]);
    },

    async getPreparedBySource(projectId, sourceSessionId) {
      const rows = await runner.select<Record<string, unknown>>(
        `${SELECT} WHERE project_id = ? AND source_execution_session_id = ? AND status = 'prepared' LIMIT 1`,
        [projectId, sourceSessionId],
      );
      return rows.length === 0 ? null : toArtifact(rows[0]);
    },

    async updateStatus(projectId, handoffId, status, activatedAt) {
      await runner.execute(
        'UPDATE execution_handoffs SET status = ?, activated_at = ? WHERE project_id = ? AND id = ?',
        [status, activatedAt, projectId, handoffId] as SqlParam[],
      );
      return getById(projectId, handoffId);
    },
  };
}
