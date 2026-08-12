import type { TaskSpec } from '../schemas/taskspec';

export type EvidenceStatus = 'VERIFIED' | 'NOT VERIFIED';

export interface VerificationEvidence {
  requirement: string;
  status: EvidenceStatus;
  evidence: string;
  source?: 'test' | 'flow' | 'inspection' | 'visual' | 'manual';
  relevantFiles?: string[];
}

export interface FunctionalVerificationPlan {
  applicable: boolean;
  source: 'core_loop' | 'acceptance_criteria' | 'execution_contract.verification' | 'test_plan' | 'none';
  requirements: string[];
}

const NON_RUNNABLE_TASK_TYPES = new Set(['planning', 'review']);
const DOCUMENTATION_OR_CONFIG = /\b(documentation|docs?|readme|config(?:uration)?|metadata|manifest)\b|\.(?:md|mdx|json|ya?ml|toml|ini)$/i;

function isDocumentationOrConfigOnly(task: TaskSpec): boolean {
  if (NON_RUNNABLE_TASK_TYPES.has(task.task_type)) return true;
  const hasImplementationRequirement = Object.values(task.requirements).some((items) => items.length > 0);
  return task.scope.length > 0
    && task.scope.every((item) => DOCUMENTATION_OR_CONFIG.test(item))
    && !hasImplementationRequirement;
}

/** Derive only a flow that the canonical TaskSpec actually supports. */
export function deriveFunctionalVerificationPlan(task: TaskSpec): FunctionalVerificationPlan {
  if (task.execution_contract?.core_loop && task.execution_contract.core_loop.length > 0) {
    return { applicable: true, source: 'core_loop', requirements: [...task.execution_contract.core_loop] };
  }
  if (isDocumentationOrConfigOnly(task)) {
    return { applicable: false, source: 'none', requirements: [] };
  }
  if (task.acceptance_criteria.length > 0) {
    return { applicable: true, source: 'acceptance_criteria', requirements: [...task.acceptance_criteria] };
  }
  if (task.execution_contract?.verification && task.execution_contract.verification.length > 0) {
    return {
      applicable: true,
      source: 'execution_contract.verification',
      requirements: [...task.execution_contract.verification],
    };
  }
  if (task.test_plan.length > 0) {
    return { applicable: true, source: 'test_plan', requirements: [...task.test_plan] };
  }
  return { applicable: false, source: 'none', requirements: [] };
}

const VISUAL_BASELINE = [
  'Hierarchy',
  'Alignment',
  'Spacing consistency',
  'Information density',
  'Unnecessary container/card repetition',
  'Duplicated labels/content',
  'Interaction clarity',
  'Typography hierarchy',
  'Clipping, overflow or broken layout',
  'Relevant responsive behavior',
  'Relevant loading, empty, error and success state quality',
  'Accessibility-visible issues where reasonably observable',
];

function hasRenderedVisualSurface(task: TaskSpec): boolean {
  if (task.quality_profile?.visual_review !== true) return false;
  if (['backend', 'database', 'security', 'testing', 'deployment', 'planning', 'review'].includes(task.task_type)) return false;
  if (task.task_type === 'ui') return true;
  if (task.requirements.frontend.length > 0) return true;
  return (task.quality_profile?.ux_constraints?.length ?? 0) > 0
    || (task.quality_profile?.completion_checks?.length ?? 0) > 0;
}

export interface VisualReviewRequest {
  capability: 'qwen-mm-plugins-core';
  tool: 'read_image';
  target: string | null;
  criteria: string[];
  projectGuidance: string[];
  instruction: string;
}

export function isVisualReviewApplicable(task: TaskSpec): boolean {
  return hasRenderedVisualSurface(task);
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter((item) => item.length > 0))];
}

/** Builds a small structured request for the already-configured local Qwen-MM capability. */
export function buildVisualReviewRequest(
  task: TaskSpec,
  target: string | null,
  projectGuidance: string[] = [],
): VisualReviewRequest | null {
  if (!hasRenderedVisualSurface(task)) return null;
  const quality = task.quality_profile;
  const criteria = unique([
    ...VISUAL_BASELINE,
    ...(quality?.product_outcome ? [`Product outcome: ${quality.product_outcome}`] : []),
    ...(quality?.ux_constraints ?? []),
    ...(quality?.preferences ?? []),
    ...(quality?.anti_slop ?? []),
    ...(quality?.completion_checks ?? []),
  ]).slice(0, 20);
  return {
    capability: 'qwen-mm-plugins-core',
    tool: 'read_image',
    target,
    criteria,
    projectGuidance: unique(projectGuidance).slice(0, 10),
    instruction: [
      'Review only the supplied rendered surface against the listed criteria and project guidance.',
      'Do not make a generic aesthetic judgment and do not infer behavior that is not visible.',
      'Ignore cards, shadows, gradients, badges and borders unless they create a concrete conflict or UX problem.',
      'Return exactly PASS or FAIL followed by at most five numbered concrete issues ordered by user impact.',
    ].join(' '),
  };
}

export interface VisualReviewEvidence {
  status: 'PASS' | 'FAIL' | 'NOT VERIFIED';
  issues: string[];
  evidence: string;
  source: 'qwen-mm-plugins-core' | 'human';
}

/** Parse the deliberately narrow Qwen-MM response contract. */
export function parseVisualReviewOutput(
  raw: string,
  source: VisualReviewEvidence['source'] = 'qwen-mm-plugins-core',
): VisualReviewEvidence {
  const lines = raw.trim().split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 1 && lines[0] === 'PASS') {
    return { status: 'PASS', issues: [], evidence: 'Structured visual review returned PASS.', source };
  }
  if (lines[0] === 'FAIL') {
    const parsedIssues = lines.slice(1)
      .map((line) => line.match(/^\d+\.\s+(.+)$/)?.[1] ?? '')
      .filter((issue) => issue.length > 0);
    if (parsedIssues.length > 0 && parsedIssues.length === lines.length - 1) {
      const issues = parsedIssues.slice(0, 5);
      return { status: 'FAIL', issues, evidence: `Structured visual review reported ${issues.length} concrete issue(s).`, source };
    }
  }
  return {
    status: 'NOT VERIFIED',
    issues: [],
    evidence: 'Visual review output was not in the required PASS/FAIL format.',
    source,
  };
}

export interface CorrectiveFailure {
  requirement: string;
  evidence: string;
  relevantFiles?: string[];
}

export interface CorrectivePass {
  allowed: boolean;
  attempt: number;
  instruction: string | null;
}

/** Creates one bounded repair instruction; callers must retain the attempt count. */
export function buildCorrectivePass(
  task: TaskSpec,
  failures: CorrectiveFailure[],
  attempt: number,
): CorrectivePass {
  if (attempt !== 0 || failures.length === 0) return { allowed: false, attempt, instruction: null };
  const boundedFailures = failures.slice(0, 5);
  const lines = [
    'ONE TARGETED CORRECTIVE PASS',
    '',
    'Fix only these failed verification requirements:',
    ...boundedFailures.map((failure, index) => [
      `${index + 1}. ${failure.requirement}`,
      `   Evidence: ${failure.evidence}`,
      ...(failure.relevantFiles && failure.relevantFiles.length > 0
        ? [`   Relevant files/surface: ${failure.relevantFiles.join(', ')}`]
        : []),
    ].join('\n')),
    '',
    'Preserve:',
    ...(task.execution_contract?.preserve?.map((item) => `- ${item}`) ?? ['- Existing architecture, behavior, data and interfaces.']),
    '',
    'Scope constraints:',
    ...task.scope.map((item) => `- ${item}`),
    ...task.out_of_scope.map((item) => `- Do not change: ${item}`),
    '',
    'Do not fix unrelated findings. After this pass, rerun only the failed/relevant verification and one final relevant regression check. Do not retry automatically again.',
  ];
  return { allowed: true, attempt, instruction: lines.join('\n') };
}
