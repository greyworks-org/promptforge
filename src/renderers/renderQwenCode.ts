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
 * Qwen Code renderer (Phase 7).
 *
 * Explicit step structure, Read first section with context paths,
 * targeted-test execution rules. Reads QWEN.md + AGENTS.md.
 * Profile-aware.
 */

export function renderQwenCode(
  task: TaskSpec,
  profile: ExecutionProfile,
): string {
  const sections: string[] = [];

  // Header
  sections.push(`Follow AGENTS.md and QWEN.md.`);
  sections.push('');

  // Task objective
  sections.push(`## Task`);
  sections.push('');
  sections.push(sanitizeHeading(task.objective));
  sections.push('');

  // Read first
  const readFiles: string[] = [];
  if (task.relevant_context && task.relevant_context.length > 0) {
    readFiles.push(...task.relevant_context);
  }
  readFiles.push('QWEN.md');
  readFiles.push('AGENTS.md');
  sections.push(readFirstBlock(readFiles));
  sections.push('');

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

  // Execution rules
  sections.push(`## Execution rules`);
  sections.push('');
  const rules: string[] = [];
  rules.push(`1. Inspect the relevant existing implementation before editing.`);
  rules.push(`2. Reuse the existing design system and conventions.`);
  rules.push(`3. Do not create duplicate data structures.`);
  rules.push(`4. Do not modify unrelated files.`);
  if (profile.test_strategy !== 'none') {
    rules.push(`5. Run ${profile.test_strategy} lint, typecheck and tests after each change.`);
  }
  if (profile.autonomy === 'high') {
    rules.push(`6. Resolve implementation details independently within scope.`);
  } else {
    rules.push(`6. Ask before resolving ambiguous choices.`);
  }
  const guardrail = guardrailBlock(profile, task.stop_conditions ?? []);
  if (guardrail) {
    rules.push(`7. ${guardrail}`);
  }
  sections.push(rules.join('\n'));
  sections.push('');

  // Retry
  const retry = retryBlock(profile);
  if (retry) {
    sections.push(retry);
    sections.push('');
  }

  // Final report
  if (task.final_report && task.final_report.length > 0) {
    sections.push(finalReportBlock(task.final_report));
    sections.push('');
  }

  return sections.join('\n').trim() + '\n';
}
