import { getAppDb } from '../db/appDb';
import {
  createExecutionSessionsRepository,
  type ExecutionSessionsRepository,
} from '../db/repos/executionSessions';
import type { CompilationRecord } from '../db/repos/compilations';
import type { QueryRunner } from '../db/runner';
import type { MemoryRecord } from '../db/repos/projectMemory';
import type { TaskSpec } from '../schemas/taskspec';
import { getCompilation } from '../services/historyService';
import { getGitSnapshot, type GitSnapshot } from '../services/gitState';
import { getMemory } from '../services/memoryService';
import { getProject, listProjects } from '../services/projectsService';
import { detectRuntime, launchRuntimeProcess, type RuntimeAvailability } from '../services/runtimeService';
import type { OpenCodeModel } from '../services/opencodeModels';
import { adapterFor } from './adapters';
import {
  emptySessionState,
  emptyRuntimeBinding,
  runtimeSchema,
  type CanonicalSessionState,
  type ExecutionSession,
  type SessionEvent,
  type SessionEventKind,
  type SessionRuntime,
  type RuntimeBinding,
} from './types';

let testRunner: QueryRunner | null = null;
export function setDbForTests(runner: QueryRunner | null): void { testRunner = runner; }

async function repo(): Promise<ExecutionSessionsRepository> {
  return createExecutionSessionsRepository(testRunner ?? (await getAppDb()));
}

function id(prefix: string): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${uuid}`;
}

function initialState(task: TaskSpec | null, memory: MemoryRecord): CanonicalSessionState {
  const state = emptySessionState();
  return {
    ...state,
    objective: task?.objective ?? '',
    taskId: task?.task_id ?? null,
    pending: task?.acceptance_criteria ?? [],
    decisions: memory.decisions.map((item) => item.text),
    blockers: memory.blockers.map((item) => item.text),
    relevantFiles: memory.relevantFiles,
  };
}

function initialBinding(task: TaskSpec | null): RuntimeBinding {
  return { ...emptyRuntimeBinding(), modelId: task?.target_model ?? null };
}

export interface StartSessionInput {
  projectId: string;
  runtime: SessionRuntime;
  task: TaskSpec | null;
  compilation?: CompilationRecord | null;
  memory?: MemoryRecord;
  git?: GitSnapshot;
  binding?: RuntimeBinding;
}

export async function startExecutionSession(input: StartSessionInput): Promise<ExecutionSession> {
  const memory = input.memory ?? await getMemory(input.projectId);
  const git = input.git ?? await getGitSnapshot(input.projectId, memory.baseCommit ?? undefined);
  const session = await (await repo()).create({
    id: id('session'),
    projectId: input.projectId,
    compilationId: input.compilation?.id ?? null,
    taskId: input.task?.task_id ?? null,
    runtime: runtimeSchema.parse(input.runtime),
    binding: input.binding ?? initialBinding(input.task),
    state: initialState(input.task, memory),
    baseCommit: memory.baseCommit ?? git.head?.hash ?? null,
    lastKnownHead: git.head?.hash ?? null,
  });
  await appendSessionEvent(input.projectId, session.id, 'started', `Started on ${session.runtime}.`, session.runtime);
  return (await getExecutionSession(input.projectId, session.id))!;
}

export async function getExecutionSession(projectId: string, sessionId: string): Promise<ExecutionSession | null> {
  return (await repo()).getById(projectId, sessionId);
}

export async function listExecutionSessions(projectId: string): Promise<ExecutionSession[]> {
  return (await repo()).listByProject(projectId);
}

/** Reuse the persisted session for a compilation instead of creating duplicates. */
export async function ensureExecutionSession(input: StartSessionInput): Promise<ExecutionSession> {
  const existing = (await listExecutionSessions(input.projectId))
    .find((session) => session.compilationId === (input.compilation?.id ?? null));
  if (existing) return existing;
  return startExecutionSession(input);
}

export async function listSessionEvents(projectId: string, sessionId: string): Promise<SessionEvent[]> {
  return (await repo()).listEvents(projectId, sessionId);
}

export async function appendSessionEvent(
  projectId: string,
  sessionId: string,
  kind: SessionEventKind,
  content: string,
  runtime?: SessionRuntime | null,
): Promise<SessionEvent> {
  const sessions = await repo();
  const session = await sessions.getById(projectId, sessionId);
  if (session === null) throw new Error('Execution session was not found for this project.');
  const event = await sessions.appendEvent({
    id: id('event'), projectId, sessionId, kind, runtime: runtime ?? session.runtime, content,
  });
  await sessions.update(projectId, sessionId, {});
  return event;
}

export async function switchSessionRuntime(
  projectId: string,
  sessionId: string,
  runtime: SessionRuntime,
): Promise<ExecutionSession> {
  const sessions = await repo();
  const session = await sessions.getById(projectId, sessionId);
  if (session === null) throw new Error('Execution session was not found for this project.');
  const nextRuntime = runtimeSchema.parse(runtime);
  if (session.runtime === nextRuntime) return session;
  const binding: RuntimeBinding = {
    ...session.binding,
    runtimeSessionId: null,
    detectedVersion: null,
    capabilities: [],
  };
  await sessions.update(projectId, sessionId, { runtime: nextRuntime, binding, status: 'active', endedAt: null });
  await appendSessionEvent(projectId, sessionId, 'runtime_switch', `Runtime switched from ${session.runtime} to ${nextRuntime}.`, nextRuntime);
  return (await sessions.getById(projectId, sessionId))!;
}

export async function updateSessionState(
  projectId: string,
  sessionId: string,
  state: CanonicalSessionState,
): Promise<ExecutionSession> {
  const updated = await (await repo()).update(projectId, sessionId, { state });
  if (updated === null) throw new Error('Execution session was not found for this project.');
  return updated;
}

export async function updateSessionBinding(
  projectId: string,
  sessionId: string,
  binding: RuntimeBinding,
): Promise<ExecutionSession> {
  const updated = await (await repo()).update(projectId, sessionId, { binding });
  if (updated === null) throw new Error('Execution session was not found for this project.');
  return updated;
}

/** Persist the selected OpenCode model without creating a model-specific adapter. */
export async function selectOpenCodeModel(
  projectId: string,
  sessionId: string,
  model: OpenCodeModel,
): Promise<ExecutionSession> {
  if (model.runtime !== 'opencode') throw new Error('Only OpenCode models can be selected for an OpenCode session.');
  const session = await getExecutionSession(projectId, sessionId);
  if (session === null) throw new Error('Execution session was not found for this project.');
  if (session.runtime !== 'opencode') throw new Error('Switch the session to OpenCode before selecting an OpenCode model.');
  return updateSessionBinding(projectId, sessionId, {
    ...session.binding,
    providerId: model.providerId,
    modelId: model.modelId,
    modelRef: model.modelRef,
  });
}

export async function finishExecutionSession(
  projectId: string,
  sessionId: string,
  status: 'completed' | 'paused' | 'failed' = 'completed',
): Promise<ExecutionSession> {
  const sessions = await repo();
  const updated = await sessions.update(projectId, sessionId, {
    status,
    endedAt: status === 'completed' || status === 'failed' ? new Date().toISOString() : null,
  });
  if (updated === null) throw new Error('Execution session was not found for this project.');
  await appendSessionEvent(projectId, sessionId, status === 'completed' ? 'completed' : status === 'failed' ? 'runtime_failure' : 'checkpoint', `Session ${status}.`, updated.runtime);
  return (await sessions.getById(projectId, sessionId))!;
}

export interface ExecutionSessionView {
  session: ExecutionSession;
  events: SessionEvent[];
  changedFiles: string[];
  task: { id: string | null; objective: string };
  progress: { completed: string[]; pending: string[]; lastAction: string | null };
  completion: 'active' | 'completed' | 'failed' | 'interrupted';
  controls: { canStart: boolean; canResume: boolean; canCheckpoint: boolean };
}

export function deriveExecutionSessionControls(session: ExecutionSession, events: SessionEvent[]): ExecutionSessionView['controls'] {
  const terminal = session.status === 'completed' || session.status === 'failed';
  const opencode = session.runtime === 'opencode';
  const hasLaunch = events.some((event) => event.kind === 'runtime_launch' && event.runtime === 'opencode');
  return {
    canStart: opencode && !terminal && !hasLaunch,
    canResume: opencode && !terminal && hasLaunch
      && ['paused', 'interrupted', 'reconciled', 'external'].includes(session.status),
    canCheckpoint: !terminal,
  };
}

/** Stable, runtime-independent read model for a future VS Code panel. */
export async function getExecutionSessionView(projectId: string, sessionId: string): Promise<ExecutionSessionView> {
  const session = await getExecutionSession(projectId, sessionId);
  if (session === null) throw new Error('Execution session was not found for this project.');
  const [events, git] = await Promise.all([
    listSessionEvents(projectId, sessionId),
    getGitSnapshot(projectId, session.baseCommit ?? undefined),
  ]);
  const changedFiles = [...new Set([
    ...git.uncommitted.staged,
    ...git.uncommitted.unstaged,
    ...git.uncommitted.untracked,
  ])].sort();
  const completion = session.status === 'completed' ? 'completed'
    : session.status === 'failed' ? 'failed'
      : session.status === 'interrupted' ? 'interrupted' : 'active';
  return {
    session,
    events,
    changedFiles,
    task: { id: session.taskId, objective: session.state.objective },
    progress: {
      completed: session.state.completed,
      pending: session.state.pending,
      lastAction: session.state.lastAction,
    },
    completion,
    controls: deriveExecutionSessionControls(session, events),
  };
}

export async function launchExecutionSessionThroughOpenCode(
  projectId: string,
  sessionId: string,
  mode: 'start' | 'resume',
  continuationPrompt?: string | null,
): Promise<{ session: ExecutionSession; availability: RuntimeAvailability }> {
  let session = await getExecutionSession(projectId, sessionId);
  if (session === null) throw new Error('Execution session was not found for this project.');
  if (session.runtime !== 'opencode') {
    session = await switchSessionRuntime(projectId, sessionId, 'opencode');
  }
  const availability = await detectRuntime('opencode');
  if (!availability.installed) {
    await appendSessionEvent(projectId, sessionId, 'runtime_failure', 'OpenCode is not installed or could not be detected.', 'opencode');
    await finishExecutionSession(projectId, sessionId, 'failed');
    throw new Error(availability.error ?? 'OpenCode is not installed.');
  }
  try {
    await launchRuntimeProcess({
      runtime: 'opencode',
      projectId,
      resume: mode === 'resume',
      externalSessionId: session.binding.runtimeSessionId,
      modelRef: session.binding.modelRef,
      continuationPrompt: continuationPrompt ?? null,
    });
    const binding: RuntimeBinding = {
      ...session.binding,
      detectedVersion: availability.version,
      capabilities: availability.capabilities,
    };
    session = await updateSessionBinding(projectId, sessionId, binding);
    await appendSessionEvent(projectId, sessionId, 'runtime_launch', `OpenCode ${mode} requested.`, 'opencode');
    return { session, availability };
  } catch (err) {
    await appendSessionEvent(projectId, sessionId, 'runtime_failure', 'OpenCode could not be launched.', 'opencode');
    await finishExecutionSession(projectId, sessionId, 'failed');
    throw err;
  }
}

function hasRepositoryEvidence(git: GitSnapshot): boolean {
  return git.head !== null || git.uncommitted.staged.length + git.uncommitted.unstaged.length + git.uncommitted.untracked.length > 0;
}

export async function reconcileProjectSessions(projectId: string): Promise<ExecutionSession[]> {
  const project = await getProject(projectId);
  if (project === null) throw new Error('The registered project could not be found.');
  const memory = await getMemory(projectId);
  let sessions = await listExecutionSessions(projectId);

  // A task compiled before this feature existed is recoverable without a model call.
  if (memory.currentTaskId && !sessions.some((session) => session.compilationId === memory.currentTaskId)) {
    const compilation = await getCompilation(memory.currentTaskId);
    if (compilation?.taskspecJson) {
      const task = JSON.parse(compilation.taskspecJson) as TaskSpec;
      const git = await getGitSnapshot(projectId, memory.baseCommit ?? undefined);
      const recovered = await startExecutionSession({
        projectId, runtime: runtimeSchema.parse(task.agent_runtime), task, compilation, memory, git,
      });
      const sessionsRepo = await repo();
      await sessionsRepo.update(projectId, recovered.id, { status: 'external', recoveryReason: 'Recovered from persisted project memory after restart.' });
      await appendSessionEvent(projectId, recovered.id, 'external_recovery', 'Recovered from persisted TaskSpec and project memory; no external transcript was available.', recovered.runtime);
      sessions = await listExecutionSessions(projectId);
    }
  }

  for (const session of sessions.filter((item) => item.status === 'active')) {
    const git = await getGitSnapshot(projectId, session.baseCommit ?? undefined);
    const changed = session.lastKnownHead !== (git.head?.hash ?? null)
      || git.uncommitted.staged.length > 0
      || git.uncommitted.unstaged.length > 0
      || git.uncommitted.untracked.length > 0;
    const sessionsRepo = await repo();
    const status = changed && hasRepositoryEvidence(git) ? 'interrupted' : 'reconciled';
    await sessionsRepo.update(projectId, session.id, {
      status,
      lastKnownHead: git.head?.hash ?? null,
      recoveryReason: changed ? 'Repository state changed while PromptForge was closed.' : 'Restart reconciled the session with the current repository.',
    });
    await appendSessionEvent(projectId, session.id, 'reconciled', changed
      ? 'Restart reconciliation found repository evidence since the last checkpoint; review before continuing.'
      : 'Restart reconciliation found no repository changes since the last checkpoint.', session.runtime);
  }
  return listExecutionSessions(projectId);
}

export async function reconcileAllProjects(): Promise<void> {
  const projectIds = (await listProjects()).map((project) => project.id);
  for (const projectId of projectIds) {
    try { await reconcileProjectSessions(projectId); } catch { /* one unavailable project must not block startup */ }
  }
}

export async function renderSessionContinuation(projectId: string, sessionId: string): Promise<string> {
  const session = await getExecutionSession(projectId, sessionId);
  if (session === null) throw new Error('Execution session was not found for this project.');
  const events = await listSessionEvents(projectId, sessionId);
  return adapterFor(session.runtime).renderContinuation(session, events);
}
