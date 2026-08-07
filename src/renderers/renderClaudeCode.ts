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
  readFirstBlock,
  sanitizeHeading,
} from './shared';

/**
 * Claude Code renderer (Phase 7).
 *
 * Plan-first, risk and edge-case emphasis, stop conditions.
 * Reads CLAUDE.md + AGENTS.md. Profile-aware.
 */

export function renderClaudeCode(
  task: TaskSpec,
  profile: ExecutionProfile,
): string {
  const sections: string[] = [];

  // Header
  sections.push(`Review AGENTS.md and CLAUDE.md first.`);
  sections.push('');

  // Planning instruction (profile-driven)
  if (profile.planning_depth !== 'minimal') {
    sections.push(`Before editing, produce a concise implementation plan covering:`);
    sections.push(`- existing components to reuse`);
    sections.push(`- data flow`);
    sections.push(`- authorization`);
    sections.push(`- error states`);
    sections.push(`- tests`);
    sections.push('');
  }

  // Objective
  sections.push(`## Task`);
  sections.push('');
  sections.push(sanitizeHeading(task.objective));
  sections.push('');

  // Context to read
  if (task.relevant_context && task.relevant_context.length > 0) {
    sections.push(readFirstBlock(task.relevant_context));
    sections.push('');
  }

  // Exploration instruction
  sections.push(explorationBlock(profile));
  sections.push('');

  // Current state
  if (task.current_state && task.current_state.length > 0) {
    sections.push(currentStateBlock(task.current_state));
    sections.push('');
  }

  // Scope + out of scope
  sections.push(scopeBlock(task.scope));
  sections.push('');
  if (task.out_of_scope && task.out_of_scope.length > 0) {
    sections.push(outOfScopeBlock(task.out_of_scope));
    sections.push('');
  }

  // Requirements
  const reqBlock = requirementsBlock(task.requirements);
  if (reqBlock) {
    sections.push(reqBlock);
    sections.push('');
  }

  // Edge cases (Claude emphasis)
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

  // Guardrails + stop conditions (Claude emphasis)
  const guardrail = guardrailBlock(profile, task.stop_conditions ?? []);
  if (guardrail) {
    sections.push(guardrail);
    sections.push('');
  }

  // Retry budget
  const retry = retryBlock(profile);
  if (retry) {
    sections.push(retry);
    sections.push('');
  }

  // Execution rules
  sections.push(`## Execution rules`);
  sections.push('');
  sections.push(`1. Do not introduce new abstractions unless the existing architecture requires them.`);
  sections.push(`2. Stop and explain before any material schema, billing or deployment change.`);
  sections.push(`3. Do not modify unrelated files.`);
  sections.push(`4. Explicitly inspect edge cases and failure states.`);
  if (profile.autonomy === 'high') {
    sections.push(`5. Resolve implementation details independently within the approved scope.`);
  } else {
    sections.push(`5. Ask before resolving ambiguous implementation choices.`);
  }
  sections.push('');

  // Final report
  if (task.final_report && task.final_report.length > 0) {
    sections.push(finalReportBlock(task.final_report));
    sections.push('');
  }

  return sections.join('\n').trim() + '\n';
}
