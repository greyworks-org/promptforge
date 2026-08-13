import type { MemoryRecord } from '../db/repos/projectMemory';
import type { TaskSpec } from '../schemas/taskspec';
import type { GitSnapshot } from '../services/gitState';
import { deriveFunctionalVerificationPlan } from '../services/verification';
import type { ExecutionSession, SessionEvent, SessionRuntime, RuntimeBinding } from '../sessions/types';
import { filterHandoffPaths } from './metadata';

export type ContinuationStatus = 'active' | 'completed' | 'blocked' | 'needs reconciliation';

export interface ExecutionIdentity {
  runtime: SessionRuntime | null;
  providerId: string | null;
  modelId: string | null;
  modelRef: string | null;
}

export interface ContinuationState {
  currentHead: string | null;
  branch: string | null;
  clean: boolean;
  relevantChangedFiles: string[];
  relevantRecentCommits: Array<{ hash: string; subject: string; committedAt: string }>;
  baseCommit: string | null;
  taskStatus: ContinuationStatus;
  verifiedCompleted: string[];
  unverified: string[];
  remaining: string[];
  blockers: string[];
  decisions: string[];
  checkpointNotes: string[];
  verificationEvidence: string[];
  lastExecution: ExecutionIdentity & { checkpoint: string | null; result: string | null };
  continueWith: ExecutionIdentity;
  nextAction: string;
  externalChange: boolean;
  noProgressEvidence: boolean;
  scopeConstraints: string[];
  originalTaskReference: string | null;
}

export interface DeriveContinuationStateInput {
  task: TaskSpec | null;
  session: ExecutionSession | null;
  events: SessionEvent[];
  memory: MemoryRecord;
  git: GitSnapshot;
  currentCompilationProvider?: string | null;
  target?: { runtime?: SessionRuntime | null; binding?: Partial<RuntimeBinding> };
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter((item) => item.length > 0))];
}

function changedFiles(git: GitSnapshot): string[] {
  const diffPaths = (git.diff ?? '')
    .split('\n')
    .map((line) => line.match(/^diff --git a\/(.+) b\/(.+)$/)?.[2] ?? null)
    .filter((path): path is string => path !== null);
  return filterHandoffPaths(unique([
    ...git.uncommitted.staged,
    ...git.uncommitted.unstaged,
    ...git.uncommitted.untracked,
    ...diffPaths,
  ])).sort();
}

function taskItems(task: TaskSpec | null): string[] {
  if (task === null) return [];
  const functional = deriveFunctionalVerificationPlan(task).requirements;
  if (functional.length > 0) return unique([...functional, ...task.acceptance_criteria]);
  if (task.acceptance_criteria.length > 0) return unique(task.acceptance_criteria);
  return unique(task.scope);
}

function completionMetadata(events: SessionEvent[]): { outcome: string | null; verified: string[]; result: string | null } {
  const completion = [...events].reverse().find((event) => event.kind === 'tool_observation' && (
    event.metadata.outcome !== undefined || /Completion verification:/i.test(event.content)
  ));
  if (!completion) return { outcome: null, verified: [], result: null };
  let verified: string[] = [];
  try {
    const parsed: unknown = JSON.parse(completion.metadata.verified_items ?? '[]');
    if (Array.isArray(parsed)) verified = parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    // Legacy events have no structured verification metadata.
  }
  const outcome = completion.metadata.outcome
    ?? completion.content.match(/Completion verification:\s*(READY|BLOCKED|NEEDS HUMAN REVIEW)/i)?.[1]?.toUpperCase()
    ?? null;
  return { outcome, verified, result: completion.content };
}

function identity(session: ExecutionSession | null, task: TaskSpec | null, provider: string | null): ExecutionIdentity {
  return session
    ? {
        runtime: session.runtime,
        providerId: session.binding.providerId,
        modelId: session.binding.modelId,
        modelRef: session.binding.modelRef,
      }
    : {
        runtime: task?.agent_runtime ?? null,
        providerId: provider,
        modelId: task?.target_model ?? null,
        modelRef: null,
      };
}

function isSatisfied(item: string, evidence: string[]): boolean {
  return evidence.some((entry) => entry === item || entry.includes(item));
}

/**
 * Reconciles persisted state and live repository evidence at render time.
 * Repository changes are deliberately unverified until a persisted state or
 * verification record proves the corresponding TaskSpec item.
 */
export function deriveContinuationState(input: DeriveContinuationStateInput): ContinuationState {
  const { task, session, events, memory, git } = input;
  const files = changedFiles(git);
  const completion = completionMetadata(events);
  const items = taskItems(task);
  const persistedCompleted = unique([
    ...(session?.state.completed ?? []),
    ...completion.verified,
  ]);
  const ready = completion.outcome === 'READY'
    || session?.status === 'completed'
    || memory.lastValidatedTaskId === task?.task_id;
  const verifiedItems = ready ? items : items.filter((item) => isSatisfied(item, persistedCompleted));
  const verifiedCompleted = unique([
    ...persistedCompleted,
    ...verifiedItems,
  ]);
  const remaining = items.filter((item) => !verifiedItems.includes(item));
  const semantic = memory.semanticContext?.status === 'fresh' ? memory.semanticContext.snapshot : null;
  const unverified = unique([
    ...(semantic?.observed_completed ?? []).map((item) => `Observed repository progress (UNVERIFIED): ${item}`),
    ...(semantic?.observed_partial ?? []).map((item) => `Observed partial progress (UNVERIFIED): ${item}`),
    ...(files.length > 0 ? [`Repository changes (UNVERIFIED): ${files.join(', ')}`] : []),
  ]);
  const checkpointNotes = unique(events
    .filter((event) => event.kind === 'checkpoint' || event.kind === 'user_note')
    .map((event) => event.content));
  const verificationEvidence = unique([
    ...(semantic?.validation_evidence ?? []),
    ...(memory.lastTest ? [`${memory.lastTest.commands.join(' && ')} — ${memory.lastTest.results}`] : []),
    ...(session?.state.lastValidation ? [session.state.lastValidation] : []),
    ...(completion.result ? [completion.result] : []),
  ]);
  const blockers = unique([
    ...(session?.state.blockers ?? []),
    ...memory.blockers.map((item) => item.text),
    ...(completion.outcome === 'BLOCKED' ? ['Completion verification is BLOCKED.'] : []),
    ...(session?.status === 'failed' ? ['The last execution failed.'] : []),
  ]);
  const decisions = unique([
    ...(session?.state.decisions ?? []),
    ...memory.decisions.map((item) => item.text),
  ]);
  const lastNote = checkpointNotes.at(-1) ?? null;
  const lastEvent = [...events].reverse().find((event) => ['tool_observation', 'runtime_failure', 'runtime_launch', 'completed', 'reconciled', 'external_recovery'].includes(event.kind));
  const lastExecution = identity(session, task, input.currentCompilationProvider ?? null);
  const targetBinding = input.target?.binding ?? {};
  const continueWith: ExecutionIdentity = {
    runtime: input.target?.runtime ?? session?.runtime ?? task?.agent_runtime ?? null,
    providerId: targetBinding.providerId ?? (input.target === undefined ? session?.binding.providerId ?? input.currentCompilationProvider ?? null : null),
    modelId: targetBinding.modelId ?? (input.target === undefined ? session?.binding.modelId ?? task?.target_model ?? null : null),
    modelRef: targetBinding.modelRef ?? (input.target === undefined ? session?.binding.modelRef ?? null : null),
  };
  const observedHead = session?.lastKnownHead
    ?? (memory.semanticContext?.status === 'fresh' ? memory.semanticContext.snapshot?.head_commit ?? null : null);
  const currentHead = git.head?.hash ?? null;
  const headChanged = git.isRepo && observedHead !== null && currentHead !== null && observedHead !== currentHead;
  const dirtyRepository = git.uncommitted.staged.length > 0
    || git.uncommitted.unstaged.length > 0
    || git.uncommitted.untracked.length > 0;
  // recentCommits are bounded context from the task/base commit. They are not
  // reconciliation evidence because that base can predate the last observed HEAD.
  const externalChange = headChanged || dirtyRepository || session?.status === 'interrupted';
  const taskStatus: ContinuationStatus = ready
    ? 'completed'
    : blockers.length > 0
      ? 'blocked'
      : externalChange
        ? 'needs reconciliation'
        : 'active';
  const noProgressEvidence = verifiedCompleted.length === 0 && unverified.length === 0 && checkpointNotes.length === 0 && verificationEvidence.length === 0;
  const nextAction = taskStatus === 'completed'
    ? 'TASK COMPLETE — run/use Verify & complete or start a new Compiler task.'
    : blockers.length > 0
      ? `Resolve or document the blocker first: ${blockers[0]}`
      : taskStatus === 'needs reconciliation'
        ? 'PROJECT CHANGED OUTSIDE CURRENT SESSION — Reconciliation required. Validate the changed repository state against the intended task before editing.'
        : remaining.length > 0
          ? `Validate and complete the next remaining item: ${remaining[0]}`
          : unverified.length > 0
            ? 'Review the unverified repository progress and record evidence before changing code.'
            : noProgressEvidence
              ? 'No progress evidence exists. Inspect the current repository against the canonical TaskSpec before acting.'
              : 'Reconcile the current repository evidence and choose the smallest safe next step.';
  const scopeConstraints = unique([
    ...(task?.execution_contract?.preserve ?? []),
    ...(task?.execution_contract?.invariants ?? []),
    ...(task?.execution_contract?.verification ?? []),
    ...(task?.quality_profile?.anti_slop ?? []),
    ...(task?.out_of_scope ?? []).map((item) => `Out of scope: ${item}`),
    ...(task?.stop_conditions ?? []).map((item) => `Stop condition: ${item}`),
    ...(task?.scope ?? []).filter((item) => !isSatisfied(item, verifiedCompleted)),
  ]);

  return {
    currentHead: git.head?.hash ?? null,
    branch: git.branch,
    clean: files.length === 0,
    relevantChangedFiles: files,
    relevantRecentCommits: git.recentCommits ?? [],
    baseCommit: session?.baseCommit ?? memory.baseCommit,
    taskStatus,
    verifiedCompleted,
    unverified,
    remaining,
    blockers,
    decisions,
    checkpointNotes,
    verificationEvidence,
    lastExecution: { ...lastExecution, checkpoint: lastNote, result: completion.result ?? lastEvent?.content ?? null },
    continueWith,
    nextAction,
    externalChange,
    noProgressEvidence,
    scopeConstraints,
    originalTaskReference: task?.task_id ?? null,
  };
}
