import { getAppDb } from '../db/appDb';
import {
  createExecutionSessionsRepository,
  type ExecutionSessionsRepository,
} from '../db/repos/executionSessions';
import type { CompilationRecord } from '../db/repos/compilations';
import type { QueryRunner } from '../db/runner';
import { createProjectContextDocumentsRepository } from '../db/repos/projectContextDocuments';
import type { MemoryRecord } from '../db/repos/projectMemory';
import { taskSpecSchema, type TaskSpec } from '../schemas/taskspec';
import { getCompilationForProject } from '../services/historyService';
import { getGitSnapshot, type GitSnapshot } from '../services/gitState';
import { getMemory } from '../services/memoryService';
import { getProject, listProjects } from '../services/projectsService';
import {
  deriveSessionFunctionalEvidence,
  resolveCompletionOutcome,
  type CompletionResolution,
} from '../services/completionGate';
import {
  detectRuntime,
  launchRuntimeProcess,
  validateRuntimeProject,
  type RuntimeAvailability,
} from '../services/runtimeService';
import { getOpenCodeModelDiscovery, type OpenCodeModel } from '../services/opencodeModels';
import { runAutomaticVisualReview, type AutomaticVisualReviewResult } from '../services/visualReview';
import { adapterFor } from './adapters';
import { deriveContinuationState } from '../handoff/continuationState';
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
  sessionModelSelectionSchema,
  type SessionModelSelection,
} from './types';

let testRunner: QueryRunner | null = null;
export function setDbForTests(runner: QueryRunner | null): void { testRunner = runner; }

async function repo(): Promise<ExecutionSessionsRepository> {
  return createExecutionSessionsRepository(testRunner ?? (await getAppDb()));
}

async function selectedContextPaths(projectId: string): Promise<string[]> {
  const contextRepository = createProjectContextDocumentsRepository(testRunner ?? (await getAppDb()));
  return (await contextRepository.listByProject(projectId)).map((document) => document.relPath);
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
  /** Optional stable id used by a confirmation-gated handoff preview. */
  id?: string;
  runtime: SessionRuntime;
  task: TaskSpec | null;
  compilation?: CompilationRecord | null;
  memory?: MemoryRecord;
  git?: GitSnapshot;
  binding?: RuntimeBinding;
}

function validateSessionInputOwnership(input: StartSessionInput): void {
  if (input.task !== null && input.task.project_id !== input.projectId) {
    throw new Error(`Session/project mismatch: TaskSpec belongs to project '${input.task.project_id}', not '${input.projectId}'.`);
  }
  if (input.compilation !== undefined && input.compilation !== null && input.compilation.projectId !== input.projectId) {
    throw new Error(`Session/project mismatch: compilation belongs to project '${input.compilation.projectId}', not '${input.projectId}'.`);
  }
  if (input.memory !== undefined && input.memory.projectId !== input.projectId) {
    throw new Error(`Session/project mismatch: memory belongs to project '${input.memory.projectId}', not '${input.projectId}'.`);
  }
}

function validatePersistedSessionBinding(
  projectId: string,
  projectRoot: string,
  session: ExecutionSession,
  requireBoundRoot = false,
): void {
  if (session.projectId !== projectId) {
    throw new Error(`Session/project mismatch: session belongs to project '${session.projectId}', not '${projectId}'.`);
  }
  if (requireBoundRoot && session.runtimeCwd === null) {
    throw new Error(`OpenCode launch blocked: session for project '${projectId}' has no persisted runtime cwd.`);
  }
  if (session.runtimeCwd !== null && session.runtimeCwd !== projectRoot) {
    throw new Error(`OpenCode launch blocked: session cwd ${session.runtimeCwd ?? 'not bound'} differs from registered project root ${projectRoot}.`);
  }
}

export async function startExecutionSession(input: StartSessionInput): Promise<ExecutionSession> {
  const project = await getProject(input.projectId);
  if (project === null) throw new Error('The registered project could not be found.');
  validateSessionInputOwnership(input);
  const memory = input.memory ?? await getMemory(input.projectId);
  const git = input.git ?? await getGitSnapshot(input.projectId, memory.baseCommit ?? undefined);
  const session = await (await repo()).create({
    id: input.id ?? id('session'),
    projectId: input.projectId,
    compilationId: input.compilation?.id ?? null,
    taskId: input.task?.task_id ?? null,
    runtime: runtimeSchema.parse(input.runtime),
    runtimeCwd: project.repoPath,
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

export interface ExecutionVerificationResult {
  taskId: string;
  visualReview: AutomaticVisualReviewResult;
  outcome: CompletionResolution;
}

/** Run the existing bounded verification contract before a session is completed. */
export async function verifyExecutionSession(
  projectId: string,
  sessionId: string,
): Promise<ExecutionVerificationResult> {
  const session = await getExecutionSession(projectId, sessionId);
  if (session === null) throw new Error('Execution session was not found for this project.');
  if (session.compilationId === null) throw new Error('This session has no canonical TaskSpec to verify.');
  const compilation = await getCompilationForProject(projectId, session.compilationId);
  if (compilation?.taskspecJson === null || compilation?.taskspecJson === undefined) {
    throw new Error('This session has no persisted canonical TaskSpec to verify.');
  }
  const task = taskSpecSchema.parse(JSON.parse(compilation.taskspecJson));
  if (task.project_id !== projectId || task.task_id !== session.taskId) {
    throw new Error('The session and canonical TaskSpec do not belong to the same project/task.');
  }

  const visualReview = await runAutomaticVisualReview(task, {
    projectId,
    applyCorrectivePass: session.runtime === 'opencode' && session.status !== 'completed'
      ? async (instruction) => {
          await updateSessionInstruction(projectId, sessionId, instruction);
          await launchExecutionSessionThroughOpenCode(projectId, sessionId, 'resume', instruction);
        }
      : undefined,
  });
  const outcome = resolveCompletionOutcome(task, {
    functionalFlow: deriveSessionFunctionalEvidence(task, session.state),
    ...(visualReview.evidence ? { visualReview: visualReview.evidence } : {}),
  });
  const verifiedItems = outcome.status === 'READY'
    ? [...task.acceptance_criteria]
    : deriveSessionFunctionalEvidence(task, session.state)
      .filter((item) => item.status === 'VERIFIED')
      .map((item) => item.requirement);
  await appendSessionEvent(
    projectId,
    sessionId,
    'tool_observation',
    `Completion verification: ${outcome.status}. Visual review: ${visualReview.evidence?.status ?? 'not applicable'}; screenshots: ${visualReview.screenshotCount}; reviews: ${visualReview.reviewCount}; corrective passes: ${visualReview.correctivePasses}.`,
    session.runtime,
    { outcome: outcome.status, verified_items: JSON.stringify(verifiedItems) },
  );
  return { taskId: task.task_id, visualReview, outcome };
}

export async function listExecutionSessions(projectId: string): Promise<ExecutionSession[]> {
  return (await repo()).listByProject(projectId);
}

/** Reuse the persisted session for a compilation instead of creating duplicates. */
export async function ensureExecutionSession(input: StartSessionInput): Promise<ExecutionSession> {
  validateSessionInputOwnership(input);
  const compilationId = input.compilation?.id ?? null;
  // A session without a compilation is intentionally never reusable. It is
  // the creation path for a genuinely new handoff/session, so matching NULL
  // values must not turn it into a recovered session resume.
  if (compilationId !== null) {
    const project = await getProject(input.projectId);
    if (project === null) throw new Error('The registered project could not be found.');
    const existing = (await listExecutionSessions(input.projectId))
      .find((session) => session.compilationId === compilationId);
    if (existing) {
      validatePersistedSessionBinding(input.projectId, project.repoPath, existing, true);
      return existing;
    }
  }
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
  metadata?: Record<string, string>,
): Promise<SessionEvent> {
  const sessions = await repo();
  const session = await sessions.getById(projectId, sessionId);
  if (session === null) throw new Error('Execution session was not found for this project.');
  const event = await sessions.appendEvent({
    id: id('event'), projectId, sessionId, kind, runtime: runtime ?? session.runtime, content, metadata,
  });
  await sessions.update(projectId, sessionId, {});
  return event;
}

/** Persist local checkpoint knowledge independently of runtime execution state. */
export async function saveSessionCheckpoint(
  projectId: string,
  sessionId: string,
  content: string,
): Promise<SessionEvent> {
  const normalized = content.trim();
  if (normalized === '') throw new Error('Checkpoint knowledge must not be empty.');
  if (normalized.length > 20000) throw new Error('Checkpoint knowledge is too long.');
  return appendSessionEvent(projectId, sessionId, 'user_note', normalized);
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

/** Change only the model identity for the next model-dependent execution. */
export async function switchSessionModel(
  projectId: string,
  sessionId: string,
  selection: SessionModelSelection & { available?: boolean; configured?: boolean },
): Promise<ExecutionSession> {
  const session = await getExecutionSession(projectId, sessionId);
  if (session === null) throw new Error('Execution session was not found for this project.');
  if (session.runtime === 'opencode' && selection.available === false && selection.configured !== true) {
    throw new Error('MODEL UNAVAILABLE IN OPENCODE');
  }
  const validated = sessionModelSelectionSchema.parse({
    providerId: selection.providerId,
    modelId: selection.modelId,
    modelRef: selection.modelRef,
  });
  return updateSessionBinding(projectId, sessionId, {
    ...session.binding,
    providerId: validated.providerId,
    modelId: validated.modelId,
    modelRef: validated.modelRef,
  });
}

export async function updateSessionInstruction(
  projectId: string,
  sessionId: string,
  instruction: string,
): Promise<ExecutionSession> {
  const normalized = instruction.trim();
  if (normalized.length > 20000) throw new Error('New instruction is too long.');
  const updated = await (await repo()).update(projectId, sessionId, { userInstruction: normalized });
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
  return switchSessionModel(projectId, sessionId, model);
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
  context: { status: 'fresh' | 'stale' | 'unavailable'; checkpoint: string | null };
  projectContextDocuments: string[];
  completion: 'active' | 'completed' | 'failed' | 'interrupted';
  controls: { canStart: boolean; canResume: boolean; canCheckpoint: boolean };
  continuationState: ReturnType<typeof deriveContinuationState>;
}

export function deriveExecutionSessionControls(session: ExecutionSession, events: SessionEvent[]): ExecutionSessionView['controls'] {
  const terminal = session.status === 'completed' || session.status === 'failed';
  const opencode = session.runtime === 'opencode';
  const hasLaunch = events.some((event) => event.kind === 'runtime_launch' && event.runtime === 'opencode');
  return {
    canStart: opencode && !terminal && !hasLaunch,
    canResume: opencode && !terminal && hasLaunch
      && ['paused', 'interrupted', 'reconciled', 'external'].includes(session.status),
    // Checkpoint knowledge is local project/session management data. It stays
    // writable after runtime completion so the user can prepare continuation.
    canCheckpoint: true,
  };
}

/** Stable, runtime-independent read model for a future VS Code panel. */
export async function getExecutionSessionView(projectId: string, sessionId: string): Promise<ExecutionSessionView> {
  const session = await getExecutionSession(projectId, sessionId);
  if (session === null) throw new Error('Execution session was not found for this project.');
  const project = await getProject(projectId);
  if (project === null) throw new Error('The registered project could not be found.');
  validatePersistedSessionBinding(projectId, project.repoPath, session);
  const [events, git, memory, projectContextDocuments] = await Promise.all([
    listSessionEvents(projectId, sessionId),
    getGitSnapshot(projectId, session.baseCommit ?? undefined),
    getMemory(projectId),
    selectedContextPaths(projectId),
  ]);
  const changedFiles = [...new Set([
    ...git.uncommitted.staged,
    ...git.uncommitted.unstaged,
    ...git.uncommitted.untracked,
  ])].sort();
  let task: TaskSpec | null = null;
  let compilationProvider: string | null = null;
  if (session.compilationId !== null) {
    const compilation = await getCompilationForProject(projectId, session.compilationId);
    compilationProvider = compilation?.providerLabel ?? null;
    if (compilation?.taskspecJson) {
      try {
        const parsed = taskSpecSchema.parse(JSON.parse(compilation.taskspecJson));
        if (parsed.project_id === projectId && parsed.task_id === session.taskId) task = parsed;
      } catch {
        // Legacy sessions remain readable from their persisted session state.
      }
    }
  }
  const continuationState = deriveContinuationState({
    task, session, events, memory, git, currentCompilationProvider: compilationProvider,
    target: { runtime: session.runtime, binding: session.binding },
  });
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
    context: {
      status: memory.semanticContext === null ? 'unavailable' : memory.semanticContext.status === 'fresh' ? 'fresh' : 'stale',
      checkpoint: [...events].reverse().find((event) => event.kind === 'checkpoint' || event.kind === 'user_note')?.content ?? null,
    },
    projectContextDocuments,
    completion,
    controls: deriveExecutionSessionControls(session, events),
    continuationState,
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
    await appendSessionEvent(projectId, sessionId, 'runtime_failure', availability.error ?? 'OpenCode is not installed or could not be detected.', 'opencode');
    await finishExecutionSession(projectId, sessionId, 'failed');
    throw new Error(availability.error ?? 'OpenCode is not installed.');
  }
  try {
    const project = await getProject(projectId);
    if (project === null) throw new Error('The registered project could not be found.');
    validatePersistedSessionBinding(projectId, project.repoPath, session);
    const projectRoot = await validateRuntimeProject(projectId, session.runtimeCwd);
    if (session.runtimeCwd === null) {
      session = await (await repo()).update(projectId, sessionId, { runtimeCwd: projectRoot }) ?? session;
    }
    if (session === null) throw new Error('Execution session was not found after runtime cwd binding.');
    const modelRef = session.binding.modelRef;
    if (modelRef !== null) {
      const discovery = await getOpenCodeModelDiscovery(projectId, modelRef);
      const selectedModel = discovery.models.find((model) => model.modelRef === modelRef);
      if (selectedModel === undefined || (!selectedModel.available && !selectedModel.configured)) {
        throw new Error('MODEL UNAVAILABLE IN OPENCODE');
      }
    }
    const launchResult = await launchRuntimeProcess({
      runtime: 'opencode',
      projectId,
      projectRoot,
      resume: mode === 'resume',
      externalSessionId: session.binding.runtimeSessionId,
      modelRef: session.binding.modelRef,
      continuationPrompt: continuationPrompt ?? null,
    });
    if (!launchResult.started) {
      const details = [
        launchResult.exitCode === null ? null : `exit code ${launchResult.exitCode}`,
        launchResult.stderr,
      ].filter((value): value is string => value !== null && value.trim() !== '').join(': ');
      throw new Error(`OpenCode exited before it could start${details ? ` (${details})` : '.'}`);
    }
    const binding: RuntimeBinding = {
      ...session.binding,
      detectedVersion: availability.version,
      capabilities: availability.capabilities,
    };
    session = await updateSessionBinding(projectId, sessionId, binding);
    await appendSessionEvent(
      projectId,
      sessionId,
      'runtime_launch',
      `OpenCode ${mode} started${launchResult.pid === null ? '' : ` (process ${launchResult.pid})`}.`,
      'opencode',
    );
    return { session, availability };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OpenCode could not be launched.';
    await appendSessionEvent(projectId, sessionId, 'runtime_failure', message, 'opencode');
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
  const sessionsRepo = await repo();

  for (const session of sessions) {
    if (session.runtimeCwd === null) {
      await sessionsRepo.update(projectId, session.id, { runtimeCwd: project.repoPath });
    }
  }
  sessions = await listExecutionSessions(projectId);

  // A task compiled before this feature existed is recoverable without a model call.
  if (memory.currentTaskId && !sessions.some((session) => session.compilationId === memory.currentTaskId)) {
    const compilation = await getCompilationForProject(projectId, memory.currentTaskId);
    if (compilation?.projectId === projectId && compilation.taskspecJson) {
      const task = JSON.parse(compilation.taskspecJson) as TaskSpec;
      const git = await getGitSnapshot(projectId, memory.baseCommit ?? undefined);
      const recovered = await startExecutionSession({
        projectId, runtime: runtimeSchema.parse(task.agent_runtime), task, compilation, memory, git,
      });
      await sessionsRepo.update(projectId, recovered.id, { status: 'external', recoveryReason: 'Recovered from persisted project memory after restart.' });
      await appendSessionEvent(projectId, recovered.id, 'external_recovery', 'Recovered from persisted TaskSpec and project memory; no external transcript was available.', recovered.runtime);
      sessions = await listExecutionSessions(projectId);
    }
  }

  for (const session of sessions.filter((item) => item.status === 'active')) {
    if (session.projectId !== projectId || (session.runtimeCwd !== null && session.runtimeCwd !== project.repoPath)) {
      // Keep a cross-project or stale-cwd session visible for diagnosis, but
      // do not inspect or reconcile repository state through the wrong root.
      continue;
    }
    const git = await getGitSnapshot(projectId, session.baseCommit ?? undefined);
    const changed = session.lastKnownHead !== (git.head?.hash ?? null)
      || git.uncommitted.staged.length > 0
      || git.uncommitted.unstaged.length > 0
      || git.uncommitted.untracked.length > 0;
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
  let task: TaskSpec | null = null;
  if (session.compilationId !== null) {
    const compilation = await getCompilationForProject(projectId, session.compilationId);
    if (compilation?.taskspecJson) {
      try {
        const parsed = taskSpecSchema.parse(JSON.parse(compilation.taskspecJson));
        if (parsed.project_id === projectId && parsed.task_id === session.taskId) task = parsed;
      } catch {
        // Older or externally-written sessions remain renderable from state.
      }
    }
  }
  const project = await getProject(projectId);
  if (project === null) throw new Error('The registered project could not be found.');
  let memory: MemoryRecord;
  try {
    memory = await getMemory(projectId);
  } catch {
    memory = {
      projectId, stack: [], currentPhase: null, lastValidatedTaskId: null,
      currentTaskId: session.compilationId, nextTask: null, decisions: [], blockers: [],
      relevantFiles: session.state.relevantFiles, lastTest: null, baseCommit: session.baseCommit,
      semanticContext: null, updatedAt: session.lastActiveAt,
    };
  }
  let git: GitSnapshot;
  try {
    git = await getGitSnapshot(projectId, session.baseCommit ?? memory.baseCommit ?? undefined);
  } catch {
    git = {
      isRepo: false, head: session.lastKnownHead ? { hash: session.lastKnownHead, subject: 'last known HEAD', committedAt: session.lastActiveAt } : null,
      uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' }, branch: null, diff: '', recentCommits: [],
    };
  }
  const continuationState = deriveContinuationState({
    task,
    session,
    events,
    memory,
    git,
    target: { runtime: session.runtime, binding: session.binding },
  });
  return adapterFor(session.runtime).renderContinuation(
    session,
    events,
    await selectedContextPaths(projectId),
    task,
    continuationState,
  );
}

/** Compose the read-only canonical continuation with the explicit user instruction. */
export async function renderSessionTask(projectId: string, sessionId: string, instruction: string): Promise<string> {
  const canonical = await renderSessionContinuation(projectId, sessionId);
  const normalized = instruction.trim();
  return normalized === '' ? canonical : `${canonical}\n\n## New user instruction\n${normalized}`;
}
