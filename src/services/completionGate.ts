import type { TaskSpec } from '../schemas/taskspec';

export const completionOutcomeSchema = {
  READY: 'READY',
  NEEDS_HUMAN_REVIEW: 'NEEDS HUMAN REVIEW',
  BLOCKED: 'BLOCKED',
} as const;

export type CompletionOutcome = typeof completionOutcomeSchema[keyof typeof completionOutcomeSchema];

export interface CompletionGate {
  acceptanceCriteria: string[];
  coreLoop: string[];
  verification: string[];
  qualityChecks: string[];
  testPlan: string[];
  humanReview: string[];
  stopConditions: string[];
}

export interface CompletionEvidence {
  /** Each key must be the exact TaskSpec item. True means evidence was recorded. */
  acceptance?: Record<string, boolean>;
  coreLoop?: Record<string, boolean>;
  verification?: Record<string, boolean>;
  qualityChecks?: Record<string, boolean>;
  testPlan?: Record<string, boolean>;
  humanReview?: Record<string, boolean>;
  /** Required dependencies, decisions, environment fixes or out-of-scope prerequisites. */
  blockers?: string[];
  /** Stop conditions that were actually triggered by the current execution. */
  stopConditionsTriggered?: string[];
  /** Optional explicit pending subjective-review descriptions. */
  humanReviewPending?: string[];
}

export interface CompletionResolution {
  status: CompletionOutcome;
  unresolvedCritical: string[];
  pendingHumanReview: string[];
  blockers: string[];
}

export function deriveCompletionGate(task: TaskSpec): CompletionGate {
  return {
    acceptanceCriteria: [...task.acceptance_criteria],
    coreLoop: [...(task.execution_contract?.core_loop ?? [])],
    verification: [...(task.execution_contract?.verification ?? [])],
    qualityChecks: [...(task.quality_profile?.completion_checks ?? [])],
    testPlan: [...task.test_plan],
    humanReview: task.quality_profile?.visual_review === true
      ? ['Required product/visual review']
      : [],
    stopConditions: [...task.stop_conditions],
  };
}

function unresolved(
  section: string,
  items: string[],
  evidence: Record<string, boolean> | undefined,
): string[] {
  return items
    .filter((item) => evidence?.[item] !== true)
    .map((item) => `${section}: ${item}`);
}

/**
 * Resolve a final-report outcome from TaskSpec-derived checks and explicit
 * evidence. This does not mutate session persistence or invent a fourth state.
 */
export function resolveCompletionOutcome(
  task: TaskSpec,
  evidence: CompletionEvidence,
): CompletionResolution {
  const gate = deriveCompletionGate(task);
  const unresolvedCritical = [
    ...unresolved('Acceptance', gate.acceptanceCriteria, evidence.acceptance),
    ...unresolved('Core flow', gate.coreLoop, evidence.coreLoop),
    ...unresolved('Verification', gate.verification, evidence.verification),
    ...unresolved('Quality check', gate.qualityChecks, evidence.qualityChecks),
    ...unresolved('Test plan', gate.testPlan, evidence.testPlan),
  ];
  const pendingHumanReview = [
    ...gate.humanReview.filter((item) => evidence.humanReview?.[item] !== true),
    ...(evidence.humanReviewPending ?? []),
  ];
  const blockers = [
    ...(evidence.blockers ?? []),
    ...(evidence.stopConditionsTriggered ?? []).map((item) => `Stop condition triggered: ${item}`),
  ].filter((item) => item.trim().length > 0);

  if (blockers.length > 0 || unresolvedCritical.length > 0) {
    return { status: completionOutcomeSchema.BLOCKED, unresolvedCritical, pendingHumanReview, blockers };
  }
  if (pendingHumanReview.length > 0) {
    return { status: completionOutcomeSchema.NEEDS_HUMAN_REVIEW, unresolvedCritical, pendingHumanReview, blockers };
  }
  return { status: completionOutcomeSchema.READY, unresolvedCritical, pendingHumanReview, blockers };
}
