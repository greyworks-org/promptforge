import { invokeIpc } from '../ipc';
import type { TaskSpec } from '../schemas/taskspec';
import {
  buildCorrectivePass,
  buildVisualReviewRequest,
  isVisualReviewApplicable,
  parseVisualReviewOutput,
  type CorrectiveFailure,
  type VisualReviewEvidence,
  type VisualReviewRequest,
} from './verification';

interface NativeVisualReviewResult {
  output: string;
  target: string;
  screenshotCaptured: boolean;
}

export interface AutomaticVisualReviewOptions {
  projectId: string;
  target?: string | null;
  projectGuidance?: string[];
  applyCorrectivePass?: (instruction: string) => Promise<void>;
  invokeReview?: (request: VisualReviewRequest, projectId: string) => Promise<NativeVisualReviewResult>;
}

export interface AutomaticVisualReviewResult {
  applicable: boolean;
  evidence: VisualReviewEvidence | null;
  target: string | null;
  screenshotCount: number;
  reviewCount: number;
  correctivePasses: number;
  correctiveInstruction: string | null;
}

function unavailableEvidence(message: string): VisualReviewEvidence {
  return {
    status: 'NOT VERIFIED',
    issues: [],
    evidence: message + ' Human visual review is required.',
    source: 'human',
  };
}

async function invokeNativeReview(
  request: VisualReviewRequest,
  projectId: string,
): Promise<NativeVisualReviewResult> {
  return invokeIpc<NativeVisualReviewResult>('run_visual_review', {
    projectId,
    target: request.target,
    instruction: request.instruction,
    criteria: request.criteria,
  });
}

/**
 * Runs the existing visual contract only for rendered UI tasks. Native
 * capture/OpenCode failures remain a human-review boundary, never VERIFIED.
 */
export async function runAutomaticVisualReview(
  task: TaskSpec,
  options: AutomaticVisualReviewOptions,
): Promise<AutomaticVisualReviewResult> {
  if (!isVisualReviewApplicable(task)) {
    return {
      applicable: false,
      evidence: null,
      target: null,
      screenshotCount: 0,
      reviewCount: 0,
      correctivePasses: 0,
      correctiveInstruction: null,
    };
  }

  const request = buildVisualReviewRequest(task, options.target ?? null, options.projectGuidance ?? []);
  if (request === null) {
    return {
      applicable: true,
      evidence: unavailableEvidence('The rendered target could not be resolved.'),
      target: null,
      screenshotCount: 0,
      reviewCount: 0,
      correctivePasses: 0,
      correctiveInstruction: null,
    };
  }

  const invokeReview = options.invokeReview ?? invokeNativeReview;
  let first: NativeVisualReviewResult;
  try {
    first = await invokeReview(request, options.projectId);
  } catch {
    return {
      applicable: true,
      evidence: unavailableEvidence('Automatic screenshot or Qwen-MM visual evidence is unavailable.'),
      target: request.target,
      screenshotCount: 0,
      reviewCount: 0,
      correctivePasses: 0,
      correctiveInstruction: null,
    };
  }

  const firstEvidence = parseVisualReviewOutput(first.output);
  const target = first.target || request.target;
  if (firstEvidence.status !== 'FAIL') {
    return {
      applicable: true,
      evidence: firstEvidence,
      target,
      screenshotCount: first.screenshotCaptured ? 1 : 0,
      reviewCount: 1,
      correctivePasses: 0,
      correctiveInstruction: null,
    };
  }

  const failures: CorrectiveFailure[] = firstEvidence.issues.map((issue) => ({
    requirement: 'Relevant rendered surface visual quality',
    evidence: issue,
    relevantFiles: target ? [target] : undefined,
  }));
  const corrective = buildCorrectivePass(task, failures, 0);
  if (!corrective.allowed || corrective.instruction === null || options.applyCorrectivePass === undefined) {
    return {
      applicable: true,
      evidence: firstEvidence,
      target,
      screenshotCount: first.screenshotCaptured ? 1 : 0,
      reviewCount: 1,
      correctivePasses: 0,
      correctiveInstruction: corrective.instruction,
    };
  }

  try {
    await options.applyCorrectivePass(corrective.instruction);
  } catch {
    return {
      applicable: true,
      evidence: firstEvidence,
      target,
      screenshotCount: first.screenshotCaptured ? 1 : 0,
      reviewCount: 1,
      correctivePasses: 1,
      correctiveInstruction: corrective.instruction,
    };
  }

  try {
    const second = await invokeReview(request, options.projectId);
    const secondEvidence = parseVisualReviewOutput(second.output);
    return {
      applicable: true,
      evidence: secondEvidence,
      target: second.target || target,
      screenshotCount: (first.screenshotCaptured ? 1 : 0) + (second.screenshotCaptured ? 1 : 0),
      reviewCount: 2,
      correctivePasses: 1,
      correctiveInstruction: corrective.instruction,
    };
  } catch {
    return {
      applicable: true,
      evidence: unavailableEvidence('The corrected surface could not be re-reviewed automatically.'),
      target,
      screenshotCount: first.screenshotCaptured ? 1 : 0,
      reviewCount: 1,
      correctivePasses: 1,
      correctiveInstruction: corrective.instruction,
    };
  }
}
