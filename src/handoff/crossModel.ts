import { z } from 'zod';
import type { OpenCodeModel } from '../services/opencodeModels';
import type { ExecutionSession, SessionEvent } from '../sessions/types';
import type { HandoffSnapshot } from './snapshot';
import type { TaskSpec } from '../schemas/taskspec';
import { filterHandoffPaths } from './metadata';
import { completionControlBlock, scopeLockBlock } from '../renderers/shared';

export const handoffStatusSchema = z.enum(['prepared', 'launched', 'failed']);
export type HandoffStatus = z.infer<typeof handoffStatusSchema>;

const executionReferenceSchema = z.object({
  sessionId: z.string().min(1),
  runtime: z.string().min(1),
  providerId: z.string().nullable(),
  modelId: z.string().nullable(),
  modelRef: z.string().nullable(),
}).strict();

export const continuationPackageSchema = z.object({
  repository: z.string().min(1),
  task: z.object({ id: z.string().min(1), goal: z.string() }).strict(),
  currentStatus: z.string().min(1),
  observedCompleted: z.array(z.string()),
  observedPartial: z.array(z.string()),
  decisions: z.array(z.string()),
  constraints: z.array(z.string()),
  checkpointNotes: z.array(z.string()),
  changedFiles: z.array(z.string()),
  validationEvidence: z.array(z.string()),
  acceptanceRequiringVerification: z.array(z.string()),
  knownBlockers: z.array(z.string()),
  immediateNextAction: z.string(),
  projectStateReferences: z.array(z.string()),
  sourceExecution: executionReferenceSchema,
  targetExecution: executionReferenceSchema,
  instruction: z.string(),
  rendered: z.string().min(1),
}).strict();
export type ContinuationPackage = z.infer<typeof continuationPackageSchema>;

export const handoffArtifactSchema = z.object({
  handoffId: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  sourceExecutionSessionId: z.string().min(1),
  targetExecutionSessionId: z.string().min(1),
  sourceRuntime: z.string().min(1),
  sourceProviderId: z.string().nullable(),
  sourceModelId: z.string().nullable(),
  sourceModelRef: z.string().nullable(),
  targetRuntime: z.literal('opencode'),
  targetProviderId: z.string().min(1),
  targetModelId: z.string().min(1),
  targetModelRef: z.string().min(3),
  createdAt: z.string().min(1),
  status: handoffStatusSchema,
  activatedAt: z.string().nullable(),
  continuation: continuationPackageSchema,
}).strict();
export type HandoffArtifact = z.infer<typeof handoffArtifactSchema>;

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter((item) => item.length > 0))];
}
function checkpointNotes(events: SessionEvent[]): string[] {
  return unique(events
    .filter((event) => event.kind === 'checkpoint' || event.kind === 'user_note')
    .map((event) => event.content));
}

function changedFiles(snapshot: HandoffSnapshot, source: ExecutionSession): string[] {
  const semantic = snapshot.memory.semanticContext?.status === 'fresh'
    ? snapshot.memory.semanticContext.snapshot?.changed_files.map((file) => file.path) ?? []
    : [];
  return filterHandoffPaths(unique([
    ...snapshot.git.uncommitted.staged,
    ...snapshot.git.uncommitted.unstaged,
    ...snapshot.git.uncommitted.untracked,
    ...semantic,
    ...source.state.relevantFiles,
  ])).sort();
}

function sourceReference(session: ExecutionSession) {
  return {
    sessionId: session.id,
    runtime: session.runtime,
    providerId: session.binding.providerId,
    modelId: session.binding.modelId,
    modelRef: session.binding.modelRef,
  };
}

function targetReference(sessionId: string, model: OpenCodeModel) {
  return {
    sessionId,
    runtime: 'opencode',
    providerId: model.providerId,
    modelId: model.modelId,
    modelRef: model.modelRef,
  };
}

export interface BuildContinuationPackageInput {
  snapshot: HandoffSnapshot;
  sourceSession: ExecutionSession;
  sourceEvents: SessionEvent[];
  targetSessionId: string;
  targetModel: OpenCodeModel;
}

/** Builds bounded, local-only evidence for a new model session. */
export function buildContinuationPackage(input: BuildContinuationPackageInput): ContinuationPackage {
  const { snapshot, sourceSession, sourceEvents, targetSessionId, targetModel } = input;
  const task = snapshot.currentTask;
  if (task === null) throw new Error('A cross-model handoff requires a canonical TaskSpec.');
  const semantic = snapshot.memory.semanticContext?.status === 'fresh'
    ? snapshot.memory.semanticContext.snapshot
    : null;
  const source = sourceReference(sourceSession);
  const target = targetReference(targetSessionId, targetModel);
  const observedCompleted = unique([
    ...(semantic?.observed_completed ?? []),
    ...sourceSession.state.completed,
  ]);
  const observedPartial = unique([
    ...(semantic?.observed_partial ?? []),
  ]);
  const decisions = unique([
    ...sourceSession.state.decisions,
    ...snapshot.memory.decisions.map((decision) => decision.text),
  ]);
  const constraints = unique([
    ...task.stop_conditions,
    ...task.out_of_scope.map((item) => `Out of scope: ${item}`),
  ]);
  const validationEvidence = unique([
    ...(semantic?.validation_evidence ?? []),
    ...(sourceSession.state.lastValidation ? [sourceSession.state.lastValidation] : []),
    ...(snapshot.memory.lastTest ? [`${snapshot.memory.lastTest.commands.join(' && ')} — ${snapshot.memory.lastTest.results}`] : []),
  ]);
  const acceptanceRequiringVerification = unique([
    ...task.acceptance_criteria,
    ...(semantic?.acceptance_requiring_verification ?? []),
    ...sourceSession.state.pending.map((item) => `Session-reported pending item: ${item}`),
  ]);
  const knownBlockers = unique([
    ...sourceSession.state.blockers,
    ...snapshot.memory.blockers.map((blocker) => blocker.text),
    ...(semantic?.blockers_observed ?? []),
    ...(sourceSession.recoveryReason ? [sourceSession.recoveryReason] : []),
  ]);
  const immediateNextAction = semantic?.immediate_next_action
    || 'Inspect the current repository and reconcile acceptance criteria against verified evidence before acting.';
  const instruction = 'The current repository and PromptForge canonical state are authoritative. Continue the existing task. Verify ambiguous items. Do not redo already-implemented work. Do not depend on the previous conversation.';
  const packageWithoutRendered = {
    repository: snapshot.repoPath,
    task: { id: task.task_id, goal: task.objective },
    currentStatus: sourceSession.status,
    observedCompleted,
    observedPartial,
    decisions,
    constraints,
    checkpointNotes: checkpointNotes(sourceEvents),
    changedFiles: changedFiles(snapshot, sourceSession),
    validationEvidence,
    acceptanceRequiringVerification,
    knownBlockers,
    immediateNextAction,
    projectStateReferences: ['AGENTS.md', 'docs/PROJECT_STATE.md'],
    sourceExecution: source,
    targetExecution: target,
    instruction,
  };
  const rendered = renderContinuationPackage(packageWithoutRendered, task);
  return continuationPackageSchema.parse({ ...packageWithoutRendered, rendered });
}

export function renderContinuationPackage(input: Omit<ContinuationPackage, 'rendered'>, task?: TaskSpec): string {
  const list = (title: string, items: string[]): string[] => [
    `${title}:`,
    ...(items.length > 0 ? items.map((item) => `- ${item}`) : ['- None recorded.']),
    '',
  ];
  const execution = (label: string, reference: ContinuationPackage['sourceExecution']): string[] => [
    `${label}:`,
    `${reference.runtime}/${reference.modelRef ?? reference.modelId ?? 'runtime default'} · session ${reference.sessionId}`,
    '',
  ];
  return [
    `Repository: ${input.repository}`,
    '',
    `Task: ${input.task.id} — ${input.task.goal}`,
    '',
    `Current execution status: ${input.currentStatus}`,
    '',
    ...list('Observed completed', input.observedCompleted),
    ...list('Observed partial', input.observedPartial),
    ...list('Decisions / constraints', unique([...input.decisions, ...input.constraints])),
    ...list('Checkpoint', input.checkpointNotes),
    ...list('Changed / relevant files', input.changedFiles),
    ...list('Validation evidence', input.validationEvidence),
    ...list('Acceptance requiring verification', input.acceptanceRequiringVerification),
    ...list('Known blockers', input.knownBlockers),
    'Immediate continuation:',
    input.immediateNextAction,
    '',
    'Relevant project-state references:',
    ...input.projectStateReferences.map((item) => `- ${item}`),
    '',
    ...execution('Source execution', input.sourceExecution),
    ...execution('Target execution', input.targetExecution),
    ...(task ? ['', scopeLockBlock(task), '', completionControlBlock(task)] : []),
    'Instruction:',
    input.instruction,
  ].join('\n');
}
