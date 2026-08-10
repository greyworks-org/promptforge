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
  verificationGuidanceBlock,
  guardrailBlock,
  retryBlock,
  explorationBlock,
  readFirstBlock,
  sanitizeHeading,
  complexityTier,
  includeSection,
} from './shared';

export function renderClaudeCode(
  task: TaskSpec,
  profile: ExecutionProfile,
): string {
  const tier = complexityTier(task.execution_mode, task.risk_level);
  const sections: string[] = [];

  // Header — always present.
  sections.push(`Review AGENTS.md and CLAUDE.md first.`);
  sections.push('');

  // Planning — full tier only, unless profile requires it.
  if (includeSection(tier, 'planning', profile.planning_depth !== 'minimal')) {
    sections.push(`Before editing, produce a concise implementation plan covering:`);
    sections.push(`- existing components to reuse`);
    sections.push(`- data flow`);
    sections.push(`- authorization`);
    sections.push(`- error states`);
    sections.push(`- tests`);
    sections.push('');
  }

  // Objective — always present.
  sections.push(`## Task`);
  sections.push('');
  sections.push(sanitizeHeading(task.objective));
  sections.push('');

  // Context to read.
  const hasContext = (task.relevant_context?.length ?? 0) > 0;
  if (hasContext) {
    sections.push(readFirstBlock(task.relevant_context!));
    sections.push('');
  }

  // Exploration — skip in minimal tier.
  if (includeSection(tier, 'exploration', false)) {
    sections.push(explorationBlock(profile));
    sections.push('');
  }

  // Current state — only if content exists.
  const hasCurrentState = (task.current_state?.length ?? 0) > 0;
  if (hasCurrentState) {
    sections.push(currentStateBlock(task.current_state!));
    sections.push('');
  }

  // Scope — always present.
  sections.push(scopeBlock(task.scope));
  sections.push('');

  // Out of scope — only if content exists.
  const hasOos = (task.out_of_scope?.length ?? 0) > 0;
  if (hasOos) {
    sections.push(outOfScopeBlock(task.out_of_scope!));
    sections.push('');
  }

  // Requirements — full tier or if content exists.
  const reqBlock = requirementsBlock(task.requirements);
  if (includeSection(tier, 'requirements', reqBlock.length > 0)) {
    sections.push(reqBlock);
    sections.push('');
  }

  // Edge cases — full tier or if content exists.
  const hasEdgeCases = (task.edge_cases?.length ?? 0) > 0;
  if (includeSection(tier, 'edgeCases', hasEdgeCases)) {
    sections.push(edgeCasesBlock(task.edge_cases ?? []));
    sections.push('');
  }

  // Acceptance criteria — always present.
  sections.push(acceptanceBlock(task.acceptance_criteria));
  sections.push('');

  // Execution plan — full tier or if content exists.
  const hasExecPlan = (task.execution_plan?.length ?? 0) > 0;
  if (includeSection(tier, 'executionPlan', hasExecPlan)) {
    sections.push(executionPlanBlock(task.execution_plan ?? []));
    sections.push('');
  }

  // Assumptions — full tier or if content exists.
  const hasAssumptions = (task.assumptions?.length ?? 0) > 0;
  if (includeSection(tier, 'assumptions', hasAssumptions)) {
    sections.push(assumptionsBlock(task.assumptions ?? []));
    sections.push('');
  }

  // Test instructions.
  const testInstr = testInstructionsBlock(profile);
  const hasTestPlan = (task.test_plan?.length ?? 0) > 0;
  if (includeSection(tier, 'testPlan', testInstr.length > 0 || hasTestPlan)) {
    if (testInstr) { sections.push(testInstr); sections.push(''); }
    if (hasTestPlan) { sections.push(testPlanBlock(task.test_plan!)); sections.push(''); }
  }

  // Guardrails + stop conditions — full tier or if content exists.
  const hasStop = (task.stop_conditions?.length ?? 0) > 0;
  if (includeSection(tier, 'stopConditions', hasStop)) {
    const guardrail = guardrailBlock(profile, task.stop_conditions ?? []);
    if (guardrail) { sections.push(guardrail); sections.push(''); }
  }

  // Retry budget — skip in minimal tier.
  if (includeSection(tier, 'retry', false)) {
    const retry = retryBlock(profile);
    if (retry) { sections.push(retry); sections.push(''); }
  }

  // Execution rules — full tier only.
  if (includeSection(tier, 'executionRules', false)) {
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
  }

  // Verification — always present.
  sections.push(verificationGuidanceBlock(task.task_type, task.risk_level, task.execution_mode));
  sections.push('');

  // Final report — only if content exists.
  const hasFinal = (task.final_report?.length ?? 0) > 0;
  if (hasFinal) {
    sections.push(finalReportBlock(task.final_report!));
    sections.push('');
  }

  return sections.join('\n').trim() + '\n';
}
