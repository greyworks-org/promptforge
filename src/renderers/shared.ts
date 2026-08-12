import type { TaskSpec } from '../schemas/taskspec';
import type { ExecutionProfile } from '../profiles/registry';
import { deriveFunctionalVerificationPlan, isVisualReviewApplicable } from '../services/verification';

/**
 * Shared rendering helpers (Phase 7).
 *
 * Pure formatting functions used across all runtime renderers.
 * No renderer introduces content absent from the TaskSpec.
 */

/** Escape lines starting with `#` to prevent heading injection. */
export function sanitizeHeading(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.startsWith('#') ? `  ${line}` : line))
    .join('\n');
}

/** Format a list of items as a Markdown bullet list. */
export function bulletList(items: string[]): string {
  if (items.length === 0) return '';
  return items.map((item) => `- ${sanitizeHeading(item)}`).join('\n');
}

/** Format assumptions with `Assumption:` prefix, rendered verbatim. */
export function assumptionsBlock(assumptions: string[]): string {
  if (assumptions.length === 0) return '';
  const lines = assumptions.map((a) => `Assumption: ${sanitizeHeading(a)}`);
  return `## Assumptions\n\n${lines.join('\n\n')}`;
}

/** Format scope section. */
export function scopeBlock(scope: string[]): string {
  if (scope.length === 0) return '';
  return `## Scope\n\n${bulletList(scope)}`;
}

/** Format out-of-scope section. */
export function outOfScopeBlock(items: string[]): string {
  if (items.length === 0) return '';
  return `## Out of scope\n\n${bulletList(items)}`;
}

/**
 * Turn the canonical TaskSpec boundary into binding execution instructions.
 * The lists themselves are rendered by the surrounding sections; this block
 * explains what the executing agent must do when repository reality conflicts
 * with the requested work.
 */
export function scopeLockBlock(task: TaskSpec): string {
  const preserve = task.execution_contract?.preserve ?? [];
  const lines: string[] = [
    '## Scope lock',
    '',
    'Treat the TaskSpec boundary as binding:',
    '- Work only on changes necessary for the requested outcome and approved scope.',
    '- Preserve the protected architecture, behavior, data and interfaces listed below.',
    '- Do not perform unrelated cleanup, refactors, migrations, redesigns or dependency changes.',
    '- A pre-existing unrelated failure is not permission to fix unrelated code; record it instead.',
    '- If an out-of-scope issue is required to complete this task safely, stop and surface it as a blocker.',
    '- Do not start a later delivery slice automatically.',
    '',
    'Protected preserve rules:',
    ...(preserve.length > 0 ? preserve.map((item) => `- ${sanitizeHeading(item)}`) : ['- No additional preserve rules recorded; preserve existing behavior by default.']),
    '',
    'When an unrelated finding is discovered, record it exactly as:',
    'OUT OF SCOPE',
    'Finding:',
    'Impact on current task:',
    'Required to continue: yes/no',
  ];
  return lines.join('\n');
}

/** Format acceptance criteria. */
export function acceptanceBlock(criteria: string[]): string {
  if (criteria.length === 0) return '';
  return `## Acceptance criteria\n\n${bulletList(criteria)}`;
}

/** Render the canonical execution contract without adding provider-specific meaning. */
export function executionContractBlock(contract: TaskSpec['execution_contract']): string {
  if (!contract) return '';
  const lines: string[] = ['## Execution contract'];
  if (contract.core_loop && contract.core_loop.length > 0) {
    lines.push('', 'Core loop:');
    lines.push(...contract.core_loop.map((item, index) => `${index + 1}. ${sanitizeHeading(item)}`));
  }
  if (contract.invariants && contract.invariants.length > 0) {
    lines.push('', 'Invariants:');
    lines.push(bulletList(contract.invariants));
  }
  if (contract.preserve && contract.preserve.length > 0) {
    lines.push('', 'Preserve:');
    lines.push(bulletList(contract.preserve));
  }
  if (contract.verification && contract.verification.length > 0) {
    lines.push('', 'Verify:');
    lines.push(bulletList(contract.verification));
  }
  if (contract.delivery_slices && contract.delivery_slices.length > 0) {
    lines.push('', 'Delivery slices (execute only the first safe slice unless directed otherwise):');
    contract.delivery_slices.forEach((slice, index) => {
      lines.push(`${index + 1}. ${sanitizeHeading(slice.title)}`);
      lines.push(`   Scope: ${slice.scope.map(sanitizeHeading).join('; ')}`);
      lines.push(`   Verify: ${slice.verification.map(sanitizeHeading).join('; ')}`);
    });
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

/** Render the optional UI/copy quality profile. */
export function qualityProfileBlock(profile: TaskSpec['quality_profile']): string {
  if (!profile) return '';
  const lines: string[] = ['## Quality profile'];
  if (profile.product_outcome) lines.push('', `Product outcome: ${sanitizeHeading(profile.product_outcome)}`);
  if (profile.ux_constraints && profile.ux_constraints.length > 0) {
    lines.push('', 'UX constraints:', bulletList(profile.ux_constraints));
  }
  if (profile.preferences && profile.preferences.length > 0) {
    lines.push('', 'Explicit preferences:', bulletList(profile.preferences));
  }
  if (profile.anti_slop && profile.anti_slop.length > 0) {
    lines.push('', 'Avoid:', bulletList(profile.anti_slop));
  }
  if (profile.completion_checks && profile.completion_checks.length > 0) {
    lines.push('', 'Visual/copy completion checks:', bulletList(profile.completion_checks));
  }
  if (profile.visual_review === true) lines.push('', 'Visual review: required.');
  return lines.length > 1 ? lines.join('\n') : '';
}

/** Format context files to read first. */
export function readFirstBlock(files: string[]): string {
  if (files.length === 0) return '';
  return `## Read first\n\n${bulletList(files)}`;
}

/** Format stop conditions. */
export function stopConditionsBlock(items: string[]): string {
  if (items.length === 0) return '';
  return `## Stop conditions\n\n${bulletList(items)}`;
}

/** Format current state facts. */
export function currentStateBlock(items: string[]): string {
  if (items.length === 0) return '';
  return `## Current state\n\n${bulletList(items)}`;
}

/** Format requirements section. */
export function requirementsBlock(reqs: TaskSpec['requirements']): string {
  const categories = [
    { key: 'functional', label: 'Functional' },
    { key: 'frontend', label: 'Frontend' },
    { key: 'backend', label: 'Backend' },
    { key: 'data', label: 'Data' },
    { key: 'security', label: 'Security' },
    { key: 'accessibility', label: 'Accessibility' },
    { key: 'performance', label: 'Performance' },
  ] as const;

  const nonEmpty = categories.filter((c) => reqs[c.key].length > 0);
  if (nonEmpty.length === 0) return '';

  const lines: string[] = ['## Requirements'];
  for (const cat of nonEmpty) {
    lines.push(`\n### ${cat.label}`);
    lines.push(bulletList(reqs[cat.key]));
  }
  return lines.join('\n');
}

/**
 * Determine prompt complexity tier from execution mode + risk level.
 * Controls which sections are included in the rendered prompt.
 *
 * - 'minimal': simple/local tasks (quick mode, low risk)
 * - 'normal': standard tasks
 * - 'full': complex/high-risk tasks (deep mode, high risk)
 */
export function complexityTier(
  executionMode: string,
  riskLevel: string,
): 'minimal' | 'normal' | 'full' {
  if (executionMode === 'deep' || riskLevel === 'high') return 'full';
  if (executionMode === 'quick' && riskLevel === 'low') return 'minimal';
  return 'normal';
}

/** Whether a section should be included given the complexity tier. */
export function includeSection(
  tier: 'minimal' | 'normal' | 'full',
  sectionKind: 'planning' | 'requirements' | 'edgeCases' | 'executionPlan' | 'assumptions' | 'exploration' | 'retry' | 'stopConditions' | 'testPlan' | 'executionRules',
  hasContent: boolean,
): boolean {
  // Always include if there's real content.
  if (hasContent) return true;

  // Otherwise, include based on tier.
  switch (sectionKind) {
    case 'planning':
      return tier === 'full';
    case 'requirements':
    case 'edgeCases':
    case 'executionPlan':
    case 'assumptions':
    case 'stopConditions':
      return tier === 'full';
    case 'exploration':
      return tier !== 'minimal';
    case 'retry':
      return tier !== 'minimal';
    case 'testPlan':
      return tier !== 'minimal';
    case 'executionRules':
      return tier === 'full';
  }
}

/**
 * Derive risk-based verification guidance from task type.
 * Tells the agent what kind of verification is proportional to the task.
 * Uses only existing TaskSpec fields — no new schema required.
 */
export function verificationGuidanceBlock(
  taskType: string,
  riskLevel: string,
  executionMode: string,
): string {
  const lines: string[] = ['## Verification'];

  // Base verification principles (all task types).
  lines.push('');
  lines.push('Before reporting completion, verify the change at its real boundary:');
  lines.push('');

  // Task-type-specific guidance.
  const guidance: string[] = [];

  switch (taskType) {
    case 'database':
    case 'backend':
      guidance.push('- Verify against fresh state, existing/legacy state, and interrupted or partially-applied state.');
      guidance.push('- Test migration/rollback paths.');
      break;
    case 'feature':
    case 'ui':
      guidance.push('- Verify the new state, existing state, cancel/retry/error paths, and the real runtime flow.');
      guidance.push('- If the feature changes a user-visible workflow, test the actual UI path.');
      break;
    case 'bugfix':
      guidance.push('- Reproduce the original defect first, then verify it is resolved.');
      guidance.push('- Test the exact scenario that was broken — do not rely on unit tests alone.');
      break;
    case 'integration':
      guidance.push('- Verify the integration boundary end-to-end.');
      guidance.push('- Confirm the producer works, the consumer is actually connected, and the user-accessible path functions.');
      break;
    case 'refactor':
      guidance.push('- Verify behavior is preserved at every affected call site.');
      guidance.push('- Run existing regression tests before and after.');
      break;
    case 'security':
      guidance.push('- Test the expected path, the adversarial/negative case, and cross-project or escape attempts.');
      guidance.push('- Verify the trust boundary cannot be bypassed.');
      break;
    case 'testing':
    case 'deployment':
      guidance.push('- Verify the change against a representative real-world fixture or environment.');
      guidance.push('- Confirm the behavior matches the spec in the actual deployment configuration.');
      break;
    default:
      guidance.push('- Verify the changed behavior at its real integration boundary, not only through unit tests.');
      guidance.push('- Identify and test the highest-risk failure or existing-state case.');
  }

  // Risk-level additions.
  if (riskLevel === 'high') {
    guidance.push('- This task is classified as high risk. Verify all edge cases, failure modes, and recovery paths.');
  }
  if (executionMode === 'deep') {
    guidance.push('- Deep mode: verify the full pipeline including critic-suggested changes.');
  }

  lines.push(...guidance);
  lines.push('');
  lines.push('Unit tests + typecheck + build alone are not sufficient. Verify at the real boundary.');

  return lines.join('\n');
}

/** Format edge cases. */
export function edgeCasesBlock(items: string[]): string {
  if (items.length === 0) return '';
  return `## Edge cases\n\n${bulletList(items)}`;
}

/** Format execution plan. */
export function executionPlanBlock(items: string[]): string {
  if (items.length === 0) return '';
  const numbered = items.map((item, i) => `${i + 1}. ${sanitizeHeading(item)}`);
  return `## Execution plan\n\n${numbered.join('\n')}`;
}

/** Format test instructions based on execution profile. */
export function testInstructionsBlock(profile: ExecutionProfile): string {
  const parts: string[] = [];
  if (profile.test_strategy !== 'none') {
    parts.push(`Run ${profile.test_strategy} tests after each change.`);
  }
  if (profile.final_validation !== 'none') {
    parts.push(`Before reporting completion, run the ${profile.final_validation} validation.`);
  }
  if (parts.length === 0) return '';
  return parts.join(' ');
}

/** Format test plan from TaskSpec. */
export function testPlanBlock(items: string[]): string {
  if (items.length === 0) return '';
  return `## Test plan\n\n${bulletList(items)}`;
}

/** Format final report requirements. */
export function finalReportBlock(items: string[]): string {
  if (items.length === 0) return '';
  return `## Completion report\n\nReport the following on completion:\n\n${bulletList(items)}`;
}

/**
 * Derive the compact completion gate from canonical TaskSpec fields.
 * No new TaskSpec fields are needed: an empty category simply has no
 * applicable checks.
 */
export function completionControlBlock(task: TaskSpec): string {
  const contract = task.execution_contract;
  const quality = task.quality_profile;
  const functionalPlan = deriveFunctionalVerificationPlan(task);
  const lines: string[] = [
    '## Completion control',
    '',
    'Do not define success as implemented, tests pass, or build succeeds alone.',
    'Before reporting a successful completion, collect evidence for every applicable critical check below.',
    '',
    'Critical acceptance criteria:',
    ...task.acceptance_criteria.map((item) => `- ${sanitizeHeading(item)}`),
  ];

  if (functionalPlan.applicable) {
    lines.push('', 'Functional golden-path verification (required when runnable):');
    if (functionalPlan.source === 'acceptance_criteria') {
      lines.push('- The critical acceptance criteria above are the required functional path.');
    } else {
      lines.push(...functionalPlan.requirements.map((item) => `- ${sanitizeHeading(item)}`));
    }
    lines.push('- Record each result as VERIFIED with direct evidence, or NOT VERIFIED; do not convert assumptions into evidence.');
  }
  if (contract?.verification && contract.verification.length > 0 && functionalPlan.source !== 'execution_contract.verification') {
    lines.push('', 'Execution-contract verification:', ...contract.verification.map((item) => `- ${sanitizeHeading(item)}`));
  }
  if (quality?.completion_checks && quality.completion_checks.length > 0) {
    lines.push('', 'Quality-profile completion checks:', ...quality.completion_checks.map((item) => `- ${sanitizeHeading(item)}`));
  }
  if (task.test_plan.length > 0 && functionalPlan.source !== 'test_plan') {
    lines.push('', 'Task test plan:', ...task.test_plan.map((item) => `- ${sanitizeHeading(item)}`));
  }
  if (task.stop_conditions.length > 0) {
    lines.push('', 'Stop conditions:', ...task.stop_conditions.map((item) => `- ${sanitizeHeading(item)}`));
    lines.push('- If a stop condition applies, the task cannot be READY until it is resolved or explicitly accepted by the user.');
  }
  if (isVisualReviewApplicable(task)) {
    lines.push('', 'Required visual QA:', '- Use the existing local Qwen-MM Core `read_image` capability only for the relevant rendered surface.', '- Review structured TaskSpec criteria and return only PASS or FAIL with at most five concrete issues.', '- If the rendered surface or capability is unavailable, record NOT VERIFIED; do not claim READY.');
  }

  lines.push(
    '',
    'Use exactly one completion outcome:',
    'READY — every applicable critical acceptance, core-flow, verification, quality and test requirement is satisfied with evidence and no critical blocker remains.',
    'NEEDS HUMAN REVIEW — implementation and objective checks are complete, but a required subjective product/design/user decision remains.',
    'BLOCKED — a required dependency, missing decision, environment issue, unresolved critical check, stop condition or out-of-scope prerequisite prevents completion.',
    '',
    'Final report contract:',
    'STATUS: READY | NEEDS HUMAN REVIEW | BLOCKED',
    'OUTCOME',
    'What was actually completed.',
    'SCOPE',
    'What changed; confirm protected and out-of-scope areas were not intentionally modified.',
    'VERIFICATION',
    'Evidence for applicable acceptance criteria, tests, required checks and the core flow.',
    'KNOWN ISSUES',
    'Only unresolved relevant issues.',
    'OUT-OF-SCOPE FINDINGS',
    'Record findings using the required compact format; do not fix them.',
    'MANUAL REVIEW',
    'Include only when genuinely required.',
    '',
    'Do not report mostly done, should work, partial success, or an equivalent successful state.',
    'If verification finds concrete failures, allow at most one targeted corrective pass containing only failed criteria, evidence, relevant files/surface, and preserve/scope constraints. Then rerun only failed/relevant verification and one final regression check.',
    'Do not start a second automatic corrective pass or an open-ended debug loop.',
  );
  return lines.join('\n');
}

/** Format guardrail instructions based on profile strength. */
export function guardrailBlock(profile: ExecutionProfile, stopConditions: string[]): string {
  const lines: string[] = [];
  if (profile.guardrail_strength === 'strict') {
    lines.push('Stop and ask before any destructive or irreversible operation.');
    lines.push('Do not modify files outside the scope of this task.');
  } else if (profile.guardrail_strength === 'standard') {
    lines.push('Confirm before destructive operations.');
  }
  // relaxed: no extra guardrail instruction beyond stop conditions.
  if (stopConditions.length > 0) {
    lines.push(bulletList(stopConditions));
  }
  return lines.length > 0 ? lines.join('\n') : '';
}

/** Format retry budget instruction. */
export function retryBlock(profile: ExecutionProfile): string {
  if (profile.retry_budget <= 0) return '';
  return `If a change fails, retry up to ${profile.retry_budget} time${profile.retry_budget > 1 ? 's' : ''} before escalating.`;
}

/** Format exploration instruction. */
export function explorationBlock(profile: ExecutionProfile): string {
  switch (profile.exploration_budget) {
    case 'high':
      return 'Inspect the relevant codebase thoroughly before making changes.';
    case 'medium':
      return 'Inspect the relevant existing files before making changes.';
    case 'low':
      return 'Read only the files listed above before starting.';
  }
}
