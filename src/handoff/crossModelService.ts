import { getAppDb } from '../db/appDb';
import {
  createExecutionHandoffsRepository,
  type ExecutionHandoffsRepository,
} from '../db/repos/executionHandoffs';
import type { QueryRunner } from '../db/runner';
import { getCompilation } from '../services/historyService';
import { getGitSnapshot } from '../services/gitState';
import { getMemory } from '../services/memoryService';
import {
  getOpenCodeModelDiscovery,
  openCodeModelSchema,
  type OpenCodeModel,
} from '../services/opencodeModels';
import { getProject } from '../services/projectsService';
import {
  finishExecutionSession,
  getExecutionSession,
  launchExecutionSessionThroughOpenCode,
  listSessionEvents,
  startExecutionSession,
  updateSessionBinding,
} from '../sessions/executionSessionService';
import { emptyRuntimeBinding, type ExecutionSession } from '../sessions/types';
import { taskSpecSchema, type TaskSpec } from '../schemas/taskspec';
import { assembleSnapshot, type HandoffSnapshot } from './snapshot';
import {
  buildContinuationPackage,
  type ContinuationPackage,
  type HandoffArtifact,
} from './crossModel';

let testRunner: QueryRunner | null = null;
const pendingPreviews = new Map<string, PreparedHandoffPreview>();

/** Test seam for the handoff repository; production uses the app database. */
export function setDbForTests(runner: QueryRunner | null): void {
  testRunner = runner;
}

async function handoffs(): Promise<ExecutionHandoffsRepository> {
  return createExecutionHandoffsRepository(testRunner ?? (await getAppDb()));
}

function id(prefix: string): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${uuid}`;
}

function validateTargetModel(input: unknown): OpenCodeModel {
  const model = openCodeModelSchema.parse(input);
  if (!model.available && !model.configured) {
    throw new Error('The selected OpenCode model is not currently available or configured.');
  }
  if (model.modelRef !== `${model.providerId}/${model.modelId}`) {
    throw new Error('The selected OpenCode model reference does not match its provider and model identity.');
  }
  return model;
}

interface CanonicalSource {
  sourceSession: ExecutionSession;
  snapshot: HandoffSnapshot;
  task: TaskSpec;
  sourceEvents: Awaited<ReturnType<typeof listSessionEvents>>;
}

async function loadCanonicalSource(projectId: string, sourceSessionId: string): Promise<CanonicalSource> {
  const project = await getProject(projectId);
  if (project === null) throw new Error('The handoff project was not found.');

  const sourceSession = await getExecutionSession(projectId, sourceSessionId);
  if (sourceSession === null) throw new Error('The source execution session was not found for this project.');
  if (sourceSession.taskId === null) throw new Error('The source execution session has no canonical TaskSpec identity.');

  const memory = await getMemory(projectId);
  const compilationId = sourceSession.compilationId ?? memory.currentTaskId;
  if (compilationId === null) throw new Error('The source execution session has no persisted TaskSpec compilation.');
  if (memory.currentTaskId !== null && memory.currentTaskId !== compilationId) {
    throw new Error('The source session is not aligned with the project’s current canonical TaskSpec.');
  }

  const compilation = await getCompilation(compilationId);
  if (compilation === null || compilation.projectId !== projectId || compilation.taskspecJson === null) {
    throw new Error('The source execution session does not resolve to a canonical TaskSpec for this project.');
  }

  let task: TaskSpec;
  try {
    task = taskSpecSchema.parse(JSON.parse(compilation.taskspecJson));
  } catch {
    throw new Error('The source execution session has an invalid persisted TaskSpec.');
  }
  if (task.project_id !== projectId || task.task_id !== sourceSession.taskId) {
    throw new Error('The source execution session and canonical TaskSpec identities do not match.');
  }

  const git = await getGitSnapshot(projectId, memory.baseCommit ?? undefined);
  const snapshot = assembleSnapshot({
    projectId,
    projectName: project.name,
    repoPath: project.repoPath,
    memory,
    git,
    currentTask: task,
    currentCompilation: compilation,
  });
  return { sourceSession, snapshot, task, sourceEvents: await listSessionEvents(projectId, sourceSessionId) };
}

export interface CrossModelHandoffInput {
  /** Explicitly selected source session. */
  projectId: string;
  sourceSessionId: string;
  /** Explicitly selected OpenCode capability; no model is inferred. */
  targetModel: OpenCodeModel;
}

export interface CrossModelHandoffResult {
  handoff: HandoffArtifact;
  sourceSession: ExecutionSession;
  targetSession: ExecutionSession;
  continuation: ContinuationPackage;
}

export interface HandoffPreview {
  previewId: string;
  projectId: string;
  sourceSession: ExecutionSession;
  targetModel: OpenCodeModel;
  continuation: ContinuationPackage;
  createdAt: string;
}

interface PreparedHandoffPreview extends HandoffPreview {
  sourceLastActiveAt: string;
}

/** Builds the canonical bounded package without creating or launching a target session. */
export async function prepareHandoffPreview(input: CrossModelHandoffInput): Promise<HandoffPreview> {
  const targetModel = validateTargetModel(input.targetModel);
  const source = await loadCanonicalSource(input.projectId, input.sourceSessionId);
  const existing = await (await handoffs()).getPreparedBySource(input.projectId, input.sourceSessionId);
  if (existing !== null) throw new Error('A prepared handoff already exists for this source session.');
  const previewId = id('session-preview');
  const continuation = buildContinuationPackage({
    snapshot: source.snapshot,
    sourceSession: source.sourceSession,
    sourceEvents: source.sourceEvents,
    targetSessionId: previewId,
    targetModel,
  });
  const preview: PreparedHandoffPreview = {
    previewId,
    projectId: input.projectId,
    sourceSession: source.sourceSession,
    targetModel,
    continuation,
    createdAt: new Date().toISOString(),
    sourceLastActiveAt: source.sourceSession.lastActiveAt,
  };
  pendingPreviews.set(previewId, preview);
  return preview;
}

async function persistAndLaunch(
  input: CrossModelHandoffInput,
  source: CanonicalSource,
  targetModel: OpenCodeModel,
  targetSession: ExecutionSession,
  continuation: ContinuationPackage,
): Promise<CrossModelHandoffResult> {
  const repository = await handoffs();
  let handoff: HandoffArtifact;
  try {
    handoff = await repository.create({
      handoffId: id('handoff'),
      projectId: input.projectId,
      taskId: source.task.task_id,
      sourceExecutionSessionId: source.sourceSession.id,
      targetExecutionSessionId: targetSession.id,
      sourceRuntime: source.sourceSession.runtime,
      sourceProviderId: source.sourceSession.binding.providerId,
      sourceModelId: source.sourceSession.binding.modelId,
      sourceModelRef: source.sourceSession.binding.modelRef,
      targetProviderId: targetModel.providerId,
      targetModelId: targetModel.modelId,
      targetModelRef: targetModel.modelRef,
      continuation,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    await finishExecutionSession(input.projectId, targetSession.id, 'failed');
    throw error;
  }

  try {
    const launched = await launchExecutionSessionThroughOpenCode(
      input.projectId,
      targetSession.id,
      'start',
      continuation.rendered,
    );
    const boundTarget = await updateSessionBinding(input.projectId, targetSession.id, {
      ...launched.session.binding,
      runtimeSessionId: id('opencode-binding'),
    });
    const activated = await repository.updateStatus(input.projectId, handoff.handoffId, 'launched', new Date().toISOString());
    if (activated === null) throw new Error('The launched handoff could not be reloaded.');
    return { handoff: activated, sourceSession: source.sourceSession, targetSession: boundTarget, continuation };
  } catch (error) {
    await repository.updateStatus(input.projectId, handoff.handoffId, 'failed', null);
    throw error;
  }
}

/** Confirms a preview, creates its target session, and invokes the existing OpenCode launch path once. */
export async function confirmHandoffPreview(previewId: string): Promise<CrossModelHandoffResult> {
  const preview = pendingPreviews.get(previewId);
  if (preview === undefined) throw new Error('The handoff preview is no longer available. Open Handoff again.');
  const source = await loadCanonicalSource(preview.projectId, preview.sourceSession.id);
  if (source.sourceSession.lastActiveAt !== preview.sourceLastActiveAt) {
    throw new Error('The source session changed after the preview was prepared. Open Handoff again.');
  }
  const discovery = await getOpenCodeModelDiscovery(preview.projectId, preview.targetModel.modelRef);
  const currentModel = discovery.models.find((model) => model.modelRef === preview.targetModel.modelRef);
  if (currentModel === undefined || (!currentModel.available && !currentModel.configured)) {
    throw new Error('The selected OpenCode model is no longer available. Choose another model.');
  }
  const existing = await (await handoffs()).getPreparedBySource(preview.projectId, preview.sourceSession.id);
  if (existing !== null) throw new Error('A prepared handoff already exists for this source session.');
  const targetSession = await startExecutionSession({
    id: preview.continuation.targetExecution.sessionId,
    projectId: preview.projectId,
    runtime: 'opencode',
    task: source.task,
    compilation: source.snapshot.currentCompilation,
    memory: source.snapshot.memory,
    git: source.snapshot.git,
    binding: {
      ...emptyRuntimeBinding(),
      providerId: currentModel.providerId,
      modelId: currentModel.modelId,
      modelRef: currentModel.modelRef,
    },
  });
  try {
    const result = await persistAndLaunch(
      {
        projectId: preview.projectId,
        sourceSessionId: preview.sourceSession.id,
        targetModel: currentModel,
      },
      source,
      currentModel,
      targetSession,
      preview.continuation,
    );
    pendingPreviews.delete(previewId);
    return result;
  } catch (error) {
    pendingPreviews.delete(previewId);
    throw error;
  }
}

/**
 * Performs one explicit source-session → new OpenCode-session handoff.
 * The source is read only. The persisted handoff is prepared before the
 * existing OpenCode launch path is called, then marked launched only after it
 * succeeds.
 */
export async function handoffToOpenCode(input: CrossModelHandoffInput): Promise<CrossModelHandoffResult> {
  const targetModel = validateTargetModel(input.targetModel);
  const source = await loadCanonicalSource(input.projectId, input.sourceSessionId);
  const existing = await (await handoffs()).getPreparedBySource(input.projectId, input.sourceSessionId);
  if (existing !== null) throw new Error('A prepared handoff already exists for this source session.');

  const targetSession = await startExecutionSession({
    projectId: input.projectId,
    runtime: 'opencode',
    task: source.task,
    compilation: source.snapshot.currentCompilation,
    memory: source.snapshot.memory,
    git: source.snapshot.git,
    binding: {
      ...emptyRuntimeBinding(),
      providerId: targetModel.providerId,
      modelId: targetModel.modelId,
      modelRef: targetModel.modelRef,
    },
  });

  const continuation = buildContinuationPackage({
    snapshot: source.snapshot,
    sourceSession: source.sourceSession,
    sourceEvents: source.sourceEvents,
    targetSessionId: targetSession.id,
    targetModel,
  });

  return persistAndLaunch(input, source, targetModel, targetSession, continuation);
}
