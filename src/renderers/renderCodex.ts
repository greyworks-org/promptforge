import type { TaskSpec } from '../schemas/taskspec';
import type { ExecutionProfile } from '../profiles/registry';
import {
  scopeBlock,
  outOfScopeBlock,
  acceptanceBlock,
  assumptionsBlock,
  currentStateBlock,
  requirementsBlock,
  edgeCasesBlock,
  executionPlanBlock,
  testInstructionsBlock,
  testPlanBlock,
  finalReportBlock,
  guardrailBlock,
  retryBlock,
  explorationBlock,
  sanitizeHeading,
} from './shared';

/**
 * Codex renderer (Phase 7).
 *
 * Outcome-first, constraints, report list. Reads AGENTS.md.
 * Profile-aware.
 */

export function renderCodex(
  task: TaskSpec,
  profile: ExecutionProfile,
): string {
  const sections: string[] = [];

  // Header
  sections.push(`Use AGENTS.md as the repository instruction source. Inspect the existing implementation before making changes.`);
  sections.push('');

  // Objective — outcome-first framing
  sections.push(`Implement: ${sanitizeHeading(task.objective)}`);
  sections.push('');

  // Required outcome (scope as outcome)
  sections.push(`## Required outcome`);
  sections.push('');
  sections.push(scopeBlock(task.scope).replace('## Scope', ''));
  sections.push('');

  // Out of scope
  if (task.out_of_scope && task.out_of_scope.length > 0) {
    sections.push(outOfScopeBlock(task.out_of_scope));
    sections.push('');
  }

  // Constraints (profile-driven + stop conditions)
  sections.push(`## Constraints`);
  sections.push('');
  const constraints: string[] = [];
  constraints.push(explorationBlock(profile));
  if (profile.autonomy === 'low') {
    constraints.push('Ask before making design decisions.');
  }
  const guardrail = guardrailBlock(profile, task.stop_conditions ?? []);
  if (guardrail) {
    constraints.push(guardrail);
  }
  sections.push(constraints.join('\n'));
  sections.push('');

  // Current state
  if (task.current_state && task.current_state.length > 0) {
    sections.push(currentStateBlock(task.current_state));
    sections.push('');
  }

  // Requirements
  const reqBlock = requirementsBlock(task.requirements);
  if (reqBlock) {
    sections.push(reqBlock);
    sections.push('');
  }

  // Edge cases
  if (task.edge_cases && task.edge_cases.length > 0) {
    sections.push(edgeCasesBlock(task.edge_cases));
    sections.push('');
  }

  // Acceptance criteria
  sections.push(acceptanceBlock(task.acceptance_criteria));
  sections.push('');

  // Execution plan
  if (task.execution_plan && task.execution_plan.length > 0) {
    sections.push(executionPlanBlock(task.execution_plan));
    sections.push('');
  }

  // Assumptions
  if (task.assumptions && task.assumptions.length > 0) {
    sections.push(assumptionsBlock(task.assumptions));
    sections.push('');
  }

  // Test instructions
  const testInstr = testInstructionsBlock(profile);
  if (testInstr) {
    sections.push(testInstr);
    sections.push('');
  }
  if (task.test_plan && task.test_plan.length > 0) {
    sections.push(testPlanBlock(task.test_plan));
    sections.push('');
  }

  // Retry
  const retry = retryBlock(profile);
  if (retry) {
    sections.push(retry);
    sections.push('');
  }

  // Final report
  sections.push(`Complete the implementation, run the relevant validations, and report:`);
  sections.push(`- files changed`);
  sections.push(`- commands executed`);
  sections.push(`- test results`);
  sections.push(`- assumptions`);
  sections.push(`- remaining risks`);
  sections.push('');

  if (task.final_report && task.final_report.length > 0) {
    sections.push(finalReportBlock(task.final_report));
    sections.push('');
  }

  return sections.join('\n').trim() + '\n';
}
