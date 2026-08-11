import { z } from 'zod';

export const runtimeSchema = z.enum(['claude-code', 'qwen-code', 'codex', 'opencode']);
export type SessionRuntime = z.infer<typeof runtimeSchema>;

export const sessionStatusSchema = z.enum([
  'active',
  'paused',
  'interrupted',
  'reconciled',
  'completed',
  'external',
  'failed',
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/** Opaque runtime/model binding. PromptForge stores identity, not provider-specific state. */
export const runtimeBindingSchema = z.object({
  providerId: z.string().nullable(),
  modelId: z.string().nullable(),
  modelRef: z.string().nullable(),
  variant: z.string().nullable(),
  runtimeSessionId: z.string().nullable(),
  detectedVersion: z.string().nullable(),
  capabilities: z.array(z.string()),
}).strict();
export type RuntimeBinding = z.infer<typeof runtimeBindingSchema>;

/** Canonical state shared by every runtime adapter. It contains no CLI-specific fields. */
export const canonicalSessionStateSchema = z.object({
  objective: z.string(),
  taskId: z.string().nullable(),
  completed: z.array(z.string()),
  pending: z.array(z.string()),
  decisions: z.array(z.string()),
  blockers: z.array(z.string()),
  relevantFiles: z.array(z.string()),
  lastAction: z.string().nullable(),
  lastValidation: z.string().nullable(),
}).strict();
export type CanonicalSessionState = z.infer<typeof canonicalSessionStateSchema>;

export const sessionEventKindSchema = z.enum([
  'started',
  'user_note',
  'assistant_note',
  'tool_observation',
  'checkpoint',
  'runtime_switch',
  'reconciled',
  'external_recovery',
  'completed',
  'runtime_launch',
  'runtime_failure',
]);
export type SessionEventKind = z.infer<typeof sessionEventKindSchema>;

export interface ExecutionSession {
  id: string;
  projectId: string;
  compilationId: string | null;
  taskId: string | null;
  runtime: SessionRuntime;
  binding: RuntimeBinding;
  status: SessionStatus;
  state: CanonicalSessionState;
  baseCommit: string | null;
  lastKnownHead: string | null;
  recoveryReason: string | null;
  startedAt: string;
  lastActiveAt: string;
  endedAt: string | null;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  projectId: string;
  kind: SessionEventKind;
  runtime: SessionRuntime | null;
  content: string;
  metadata: Record<string, string>;
  createdAt: string;
}

export function emptySessionState(): CanonicalSessionState {
  return {
    objective: '',
    taskId: null,
    completed: [],
    pending: [],
    decisions: [],
    blockers: [],
    relevantFiles: [],
    lastAction: null,
    lastValidation: null,
  };
}

export function emptyRuntimeBinding(): RuntimeBinding {
  return {
    providerId: null,
    modelId: null,
    modelRef: null,
    variant: null,
    runtimeSessionId: null,
    detectedVersion: null,
    capabilities: [],
  };
}
