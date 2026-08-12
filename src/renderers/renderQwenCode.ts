import type { TaskSpec } from '../schemas/taskspec';
import type { ExecutionProfile } from '../profiles/registry';
import {
  scopeBlock, outOfScopeBlock, acceptanceBlock, assumptionsBlock,
  currentStateBlock, requirementsBlock, edgeCasesBlock,
  executionContractBlock, qualityProfileBlock,
  executionPlanBlock, testInstructionsBlock, testPlanBlock,
  finalReportBlock, verificationGuidanceBlock,
  guardrailBlock, retryBlock, explorationBlock, readFirstBlock,
  sanitizeHeading, complexityTier, includeSection,
  scopeLockBlock, completionControlBlock,
} from './shared';

export function renderQwenCode(task: TaskSpec, profile: ExecutionProfile): string {
  const tier = complexityTier(task.execution_mode, task.risk_level);
  const sections: string[] = [];

  sections.push(`Follow AGENTS.md and QWEN.md.`);
  sections.push('');

  sections.push(`## Task`);
  sections.push('');
  sections.push(sanitizeHeading(task.objective));
  sections.push('');

  const readFiles: string[] = [];
  if (task.relevant_context && task.relevant_context.length > 0) {
    readFiles.push(...task.relevant_context);
  }
  readFiles.push('QWEN.md');
  readFiles.push('AGENTS.md');
  sections.push(readFirstBlock(readFiles));
  sections.push('');

  if (includeSection(tier, 'exploration', false)) {
    sections.push(explorationBlock(profile));
    sections.push('');
  }

  if ((task.current_state?.length ?? 0) > 0) {
    sections.push(currentStateBlock(task.current_state!));
    sections.push('');
  }

  sections.push(scopeBlock(task.scope));
  sections.push('');

  const contract = executionContractBlock(task.execution_contract);
  if (contract) { sections.push(contract); sections.push(''); }

  sections.push(scopeLockBlock(task));
  sections.push('');

  const quality = qualityProfileBlock(task.quality_profile);
  if (quality) { sections.push(quality); sections.push(''); }
  if ((task.out_of_scope?.length ?? 0) > 0) {
    sections.push(outOfScopeBlock(task.out_of_scope!));
    sections.push('');
  }

  const reqBlock = requirementsBlock(task.requirements);
  if (includeSection(tier, 'requirements', reqBlock.length > 0) && reqBlock) {
    sections.push(reqBlock);
    sections.push('');
  }

  if (includeSection(tier, 'edgeCases', (task.edge_cases?.length ?? 0) > 0)) {
    sections.push(edgeCasesBlock(task.edge_cases ?? []));
    sections.push('');
  }

  sections.push(acceptanceBlock(task.acceptance_criteria));
  sections.push('');

  if (includeSection(tier, 'executionPlan', (task.execution_plan?.length ?? 0) > 0)) {
    sections.push(executionPlanBlock(task.execution_plan ?? []));
    sections.push('');
  }

  if (includeSection(tier, 'assumptions', (task.assumptions?.length ?? 0) > 0)) {
    sections.push(assumptionsBlock(task.assumptions ?? []));
    sections.push('');
  }

  const testInstr = testInstructionsBlock(profile);
  const hasTestPlan = (task.test_plan?.length ?? 0) > 0;
  if (includeSection(tier, 'testPlan', testInstr.length > 0 || hasTestPlan)) {
    if (testInstr) { sections.push(testInstr); sections.push(''); }
    if (hasTestPlan) { sections.push(testPlanBlock(task.test_plan!)); sections.push(''); }
  }

  if (includeSection(tier, 'executionRules', false)) {
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
    if (guardrail) rules.push(`7. ${guardrail}`);
    sections.push(rules.join('\n'));
    sections.push('');
  }

  if (includeSection(tier, 'retry', false)) {
    const retry = retryBlock(profile);
    if (retry) { sections.push(retry); sections.push(''); }
  }

  sections.push(verificationGuidanceBlock(task.task_type, task.risk_level, task.execution_mode));
  sections.push('');

  sections.push(completionControlBlock(task));
  sections.push('');

  if ((task.final_report?.length ?? 0) > 0) {
    sections.push(finalReportBlock(task.final_report!));
    sections.push('');
  }

  return sections.join('\n').trim() + '\n';
}
