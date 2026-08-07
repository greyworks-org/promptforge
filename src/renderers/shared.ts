import type { TaskSpec } from '../schemas/taskspec';
import type { ExecutionProfile } from '../profiles/registry';

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

/** Format acceptance criteria. */
export function acceptanceBlock(criteria: string[]): string {
  if (criteria.length === 0) return '';
  return `## Acceptance criteria\n\n${bulletList(criteria)}`;
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
