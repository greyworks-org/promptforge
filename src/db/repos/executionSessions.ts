import { z } from 'zod';
import type { QueryRunner, SqlParam } from '../runner';
import {
  canonicalSessionStateSchema,
  runtimeBindingSchema,
  runtimeSchema,
  sessionEventKindSchema,
  sessionStatusSchema,
  type CanonicalSessionState,
  type ExecutionSession,
  type SessionEvent,
  type SessionEventKind,
  type SessionRuntime,
  type SessionStatus,
  type RuntimeBinding,
} from '../../sessions/types';

const sessionRowSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  compilation_id: z.string().nullable(),
  task_id: z.string().nullable(),
  runtime: runtimeSchema,
  status: sessionStatusSchema,
  runtime_metadata_json: z.string().default('{}'),
  user_instruction: z.string().default(''),
  state_json: z.string(),
  base_commit: z.string().nullable(),
  last_known_head: z.string().nullable(),
  recovery_reason: z.string().nullable(),
  started_at: z.string().min(1),
  last_active_at: z.string().min(1),
  ended_at: z.string().nullable(),
});

const eventRowSchema = z.object({
  id: z.string().min(1),
  session_id: z.string().min(1),
  project_id: z.string().min(1),
  kind: sessionEventKindSchema,
  runtime: runtimeSchema.nullable(),
  content: z.string(),
  metadata_json: z.string(),
  created_at: z.string().min(1),
});

function parseState(raw: string): CanonicalSessionState {
  return canonicalSessionStateSchema.parse(JSON.parse(raw));
}

function parseMetadata(raw: string): Record<string, string> {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item;
  }
  return result;
}

function parseBinding(raw: string): RuntimeBinding {
  return runtimeBindingSchema.parse(JSON.parse(raw));
}

function toSession(row: unknown): ExecutionSession {
  const parsed = sessionRowSchema.parse(row);
  return {
    id: parsed.id,
    projectId: parsed.project_id,
    compilationId: parsed.compilation_id,
    taskId: parsed.task_id,
    runtime: parsed.runtime,
    status: parsed.status,
    binding: parseBinding(parsed.runtime_metadata_json),
    userInstruction: parsed.user_instruction,
    state: parseState(parsed.state_json),
    baseCommit: parsed.base_commit,
    lastKnownHead: parsed.last_known_head,
    recoveryReason: parsed.recovery_reason,
    startedAt: parsed.started_at,
    lastActiveAt: parsed.last_active_at,
    endedAt: parsed.ended_at,
  };
}

function toEvent(row: unknown): SessionEvent {
  const parsed = eventRowSchema.parse(row);
  return {
    id: parsed.id,
    sessionId: parsed.session_id,
    projectId: parsed.project_id,
    kind: parsed.kind,
    runtime: parsed.runtime,
    content: parsed.content,
    metadata: parseMetadata(parsed.metadata_json),
    createdAt: parsed.created_at,
  };
}

const SESSION_SELECT = `SELECT id, project_id, compilation_id, task_id, runtime, status,
  runtime_metadata_json, user_instruction, state_json, base_commit, last_known_head, recovery_reason, started_at, last_active_at, ended_at
FROM execution_sessions`;

const EVENT_SELECT = `SELECT id, session_id, project_id, kind, runtime, content,
  metadata_json, created_at FROM session_events`;

export interface NewExecutionSession {
  id: string;
  projectId: string;
  compilationId?: string | null;
  taskId?: string | null;
  runtime: SessionRuntime;
  binding?: RuntimeBinding;
  userInstruction?: string;
  status?: SessionStatus;
  state: CanonicalSessionState;
  baseCommit?: string | null;
  lastKnownHead?: string | null;
}

export interface SessionPatch {
  runtime?: SessionRuntime;
  binding?: RuntimeBinding;
  userInstruction?: string;
  status?: SessionStatus;
  state?: CanonicalSessionState;
  lastKnownHead?: string | null;
  recoveryReason?: string | null;
  endedAt?: string | null;
}

export interface NewSessionEvent {
  id: string;
  sessionId: string;
  projectId: string;
  kind: SessionEventKind;
  runtime?: SessionRuntime | null;
  content: string;
  metadata?: Record<string, string>;
}

export interface ExecutionSessionsRepository {
  create(input: NewExecutionSession): Promise<ExecutionSession>;
  getById(projectId: string, sessionId: string): Promise<ExecutionSession | null>;
  listByProject(projectId: string, limit?: number): Promise<ExecutionSession[]>;
  update(projectId: string, sessionId: string, patch: SessionPatch): Promise<ExecutionSession | null>;
  appendEvent(input: NewSessionEvent): Promise<SessionEvent>;
  listEvents(projectId: string, sessionId: string, limit?: number): Promise<SessionEvent[]>;
}

export function createExecutionSessionsRepository(runner: QueryRunner): ExecutionSessionsRepository {
  async function getById(projectId: string, sessionId: string): Promise<ExecutionSession | null> {
    const rows = await runner.select<Record<string, unknown>>(
      `${SESSION_SELECT} WHERE project_id = ? AND id = ?`, [projectId, sessionId],
    );
    return rows.length === 0 ? null : toSession(rows[0]);
  }

  return {
    async create(input) {
      const now = new Date().toISOString();
      await runner.execute(
        `INSERT INTO execution_sessions
          (id, project_id, compilation_id, task_id, runtime, status, runtime_metadata_json, user_instruction, state_json,
           base_commit, last_known_head, recovery_reason, started_at, last_active_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
        [
          input.id, input.projectId, input.compilationId ?? null, input.taskId ?? null,
          input.runtime, input.status ?? 'active', JSON.stringify(input.binding ?? {
            providerId: null, modelId: null, modelRef: null, variant: null,
            runtimeSessionId: null, detectedVersion: null, capabilities: [],
          }), input.userInstruction ?? '', JSON.stringify(input.state),
          input.baseCommit ?? null, input.lastKnownHead ?? null, now, now,
        ],
      );
      const saved = await getById(input.projectId, input.id);
      if (saved === null) throw new Error('Execution session was not persisted.');
      return saved;
    },

    getById,

    async listByProject(projectId, limit = 50) {
      const rows = await runner.select<Record<string, unknown>>(
        `${SESSION_SELECT} WHERE project_id = ? ORDER BY last_active_at DESC LIMIT ?`, [projectId, limit],
      );
      return rows.map(toSession);
    },

    async update(projectId, sessionId, patch) {
      const existing = await getById(projectId, sessionId);
      if (existing === null) return null;
      const sets: string[] = [];
      const params: SqlParam[] = [];
      if (patch.runtime !== undefined) { sets.push('runtime = ?'); params.push(patch.runtime); }
      if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
      if (patch.binding !== undefined) { sets.push('runtime_metadata_json = ?'); params.push(JSON.stringify(patch.binding)); }
      if (patch.userInstruction !== undefined) { sets.push('user_instruction = ?'); params.push(patch.userInstruction); }
      if (patch.state !== undefined) { sets.push('state_json = ?'); params.push(JSON.stringify(patch.state)); }
      if (patch.lastKnownHead !== undefined) { sets.push('last_known_head = ?'); params.push(patch.lastKnownHead); }
      if (patch.recoveryReason !== undefined) { sets.push('recovery_reason = ?'); params.push(patch.recoveryReason); }
      if (patch.endedAt !== undefined) { sets.push('ended_at = ?'); params.push(patch.endedAt); }
      sets.push('last_active_at = ?'); params.push(new Date().toISOString());
      params.push(sessionId, projectId);
      await runner.execute(`UPDATE execution_sessions SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`, params);
      return getById(projectId, sessionId);
    },

    async appendEvent(input) {
      const owner = await getById(input.projectId, input.sessionId);
      if (owner === null) throw new Error('Execution session was not found for this project.');
      const now = new Date().toISOString();
      await runner.execute(
        `INSERT INTO session_events
          (id, session_id, project_id, kind, runtime, content, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id, input.sessionId, input.projectId, input.kind, input.runtime ?? null,
          input.content, JSON.stringify(input.metadata ?? {}), now,
        ],
      );
      const rows = await runner.select<Record<string, unknown>>(
        `${EVENT_SELECT} WHERE project_id = ? AND session_id = ? AND id = ?`,
        [input.projectId, input.sessionId, input.id],
      );
      if (rows.length === 0) throw new Error('Session event was not persisted.');
      return toEvent(rows[0]);
    },

    async listEvents(projectId, sessionId, limit = 200) {
      const rows = await runner.select<Record<string, unknown>>(
        `${EVENT_SELECT} WHERE project_id = ? AND session_id = ? ORDER BY created_at ASC LIMIT ?`,
        [projectId, sessionId, limit],
      );
      return rows.map(toEvent);
    },
  };
}
