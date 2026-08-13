import type { TaskSpec } from '../schemas/taskspec';
import {
  deriveFunctionalVerificationPlan,
  isVisualReviewApplicable,
  type VerificationEvidence,
  type VisualReviewEvidence,
} from './verification';

export const completionOutcomeSchema = {
  READY: 'READY',
  NEEDS_HUMAN_REVIEW: 'NEEDS HUMAN REVIEW',
  BLOCKED: 'BLOCKED',
} as const;

export type CompletionOutcome = typeof completionOutcomeSchema[keyof typeof completionOutcomeSchema];

export interface CompletionGate {
  acceptanceCriteria: string[];
  functionalFlow: string[];
  functionalFlowSource: 'core_loop' | 'acceptance_criteria' | 'execution_contract.verification' | 'test_plan' | 'none';
  coreLoop: string[];
  verification: string[];
  qualityChecks: string[];
  testPlan: string[];
  humanReview: string[];
  visualReviewRequired: boolean;
  stopConditions: string[];
}

type CheckEvidence = boolean | VerificationEvidence;

export interface CompletionEvidence {
  /** Each key must be the exact TaskSpec item. True means evidence was recorded. */
  acceptance?: Record<string, CheckEvidence>;
  coreLoop?: Record<string, CheckEvidence>;
  verification?: Record<string, CheckEvidence>;
  qualityChecks?: Record<string, CheckEvidence>;
  testPlan?: Record<string, CheckEvidence>;
  functionalFlow?: VerificationEvidence[];
  visualReview?: VisualReviewEvidence;
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

/** Convert explicit persisted session progress into requirement-scoped evidence. */
export function deriveSessionFunctionalEvidence(
  task: TaskSpec,
  sessionState: { completed: string[]; lastValidation: string | null },
): VerificationEvidence[] {
  const plan = deriveFunctionalVerificationPlan(task);
  if (!plan.applicable) return [];
  const recorded = [
    ...sessionState.completed,
    ...(sessionState.lastValidation ? [sessionState.lastValidation] : []),
  ].map((item) => item.trim()).filter((item) => item.length > 0);
  return plan.requirements.map((requirement) => {
    const matchingRecord = recorded.find((item) => item === requirement || item.includes(requirement));
    return matchingRecord
      ? {
          requirement,
          status: 'VERIFIED' as const,
          evidence: matchingRecord,
          source: 'inspection' as const,
        }
      : {
          requirement,
          status: 'NOT VERIFIED' as const,
          evidence: 'No direct functional verification evidence is persisted for this requirement.',
          source: 'inspection' as const,
        };
  });
}

export function deriveCompletionGate(task: TaskSpec): CompletionGate {
  const functionalFlow = deriveFunctionalVerificationPlan(task);
  const visualReviewRequired = isVisualReviewApplicable(task);
  return {
    acceptanceCriteria: [...task.acceptance_criteria],
    functionalFlow: functionalFlow.requirements,
    functionalFlowSource: functionalFlow.source,
    coreLoop: functionalFlow.source === 'core_loop' ? [] : [...(task.execution_contract?.core_loop ?? [])],
    verification: [...(task.execution_contract?.verification ?? [])],
    qualityChecks: [...(task.quality_profile?.completion_checks ?? [])],
    testPlan: [...task.test_plan],
    humanReview: [],
    visualReviewRequired,
    stopConditions: [...task.stop_conditions],
  };
}

function unresolved(
  section: string,
  items: string[],
  evidence: Record<string, CheckEvidence> | undefined,
): string[] {
  return items
    .filter((item) => !isVerified(evidence?.[item]))
    .map((item) => `${section}: ${item}`);
}

function isVerified(value: CheckEvidence | undefined): boolean {
  if (value === true) return true;
  if (typeof value !== 'object' || value.status !== 'VERIFIED') return false;
  if (value.evidence.trim().length === 0) return false;
  if (/\b(?:should work|looks correct|likely works|tests should cover|probably works)\b/i.test(value.evidence)) return false;
  return true;
}

function unresolvedFunctionalFlow(
  gate: CompletionGate,
  evidence: CompletionEvidence,
): string[] {
  const byRequirement = new Map((evidence.functionalFlow ?? []).map((item) => [item.requirement, item]));
  const fallback = gate.functionalFlowSource === 'acceptance_criteria'
    ? evidence.acceptance
    : gate.functionalFlowSource === 'execution_contract.verification'
      ? evidence.verification
      : gate.functionalFlowSource === 'test_plan' ? evidence.testPlan : undefined;
  return gate.functionalFlow
    .filter((requirement) => !isVerified(byRequirement.get(requirement)) && !isVerified(fallback?.[requirement]))
    .map((requirement) => `Functional flow: ${requirement}`);
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
    ...unresolvedFunctionalFlow(gate, evidence),
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

  if (gate.visualReviewRequired) {
    if (evidence.visualReview?.status === 'FAIL') {
      unresolvedCritical.push(...(evidence.visualReview.issues.length > 0
        ? evidence.visualReview.issues.map((issue) => `Visual review: ${issue}`)
        : ['Visual review: concrete failure reported.']));
    } else if (evidence.visualReview?.status !== 'PASS' || evidence.visualReview.evidence.trim() === '') {
      pendingHumanReview.push('Required product/visual review');
    }
  }

  if (blockers.length > 0 || unresolvedCritical.length > 0) {
    return { status: completionOutcomeSchema.BLOCKED, unresolvedCritical, pendingHumanReview, blockers };
  }
  if (pendingHumanReview.length > 0) {
    return { status: completionOutcomeSchema.NEEDS_HUMAN_REVIEW, unresolvedCritical, pendingHumanReview, blockers };
  }
  return { status: completionOutcomeSchema.READY, unresolvedCritical, pendingHumanReview, blockers };
}
