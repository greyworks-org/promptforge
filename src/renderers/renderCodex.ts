import type { TaskSpec } from '../schemas/taskspec';
import type { ExecutionProfile } from '../profiles/registry';
import {
  scopeBlock, outOfScopeBlock, acceptanceBlock, assumptionsBlock,
  currentStateBlock, requirementsBlock, edgeCasesBlock,
  executionContractBlock, qualityProfileBlock,
  executionPlanBlock, testInstructionsBlock, testPlanBlock,
  finalReportBlock, verificationGuidanceBlock,
  guardrailBlock, retryBlock, explorationBlock,
  sanitizeHeading, complexityTier, includeSection,
} from './shared';

export function renderCodex(task: TaskSpec, profile: ExecutionProfile): string {
  const tier = complexityTier(task.execution_mode, task.risk_level);
  const sections: string[] = [];

  sections.push(`Use AGENTS.md as the repository instruction source. Inspect the existing implementation before making changes.`);
  sections.push('');

  sections.push(`Implement: ${sanitizeHeading(task.objective)}`);
  sections.push('');

  sections.push(`## Required outcome`);
  sections.push('');
  sections.push(scopeBlock(task.scope).replace('## Scope', ''));
  sections.push('');

  if ((task.out_of_scope?.length ?? 0) > 0) {
    sections.push(outOfScopeBlock(task.out_of_scope!));
    sections.push('');
  }

  const contract = executionContractBlock(task.execution_contract);
  if (contract) { sections.push(contract); sections.push(''); }

  const quality = qualityProfileBlock(task.quality_profile);
  if (quality) { sections.push(quality); sections.push(''); }

  // Constraints — always shown but simplified for minimal tier.
  sections.push(`## Constraints`);
  sections.push('');
  const constraints: string[] = [];
  if (includeSection(tier, 'exploration', false)) {
    constraints.push(explorationBlock(profile));
  }
  if (includeSection(tier, 'executionRules', profile.autonomy === 'low')) {
    if (profile.autonomy === 'low') constraints.push('Ask before making design decisions.');
  }
  const hasStop = (task.stop_conditions?.length ?? 0) > 0;
  if (includeSection(tier, 'stopConditions', hasStop)) {
    const guardrail = guardrailBlock(profile, task.stop_conditions ?? []);
    if (guardrail) constraints.push(guardrail);
  }
  if (constraints.length > 0) {
    sections.push(constraints.join('\n'));
  } else {
    sections.push('Complete the implementation within the defined scope.');
  }
  sections.push('');

  if ((task.current_state?.length ?? 0) > 0) {
    sections.push(currentStateBlock(task.current_state!));
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

  if (includeSection(tier, 'retry', false)) {
    const retry = retryBlock(profile);
    if (retry) { sections.push(retry); sections.push(''); }
  }

  sections.push(verificationGuidanceBlock(task.task_type, task.risk_level, task.execution_mode));
  sections.push('');

  // Completion report — minimal tier gets a shorter version.
  if (tier === 'minimal') {
    sections.push(`Report changed files, test results, and remaining risks.`);
  } else {
    sections.push(`Complete the implementation, run the relevant validations, and report:`);
    sections.push(`- files changed`);
    sections.push(`- commands executed`);
    sections.push(`- test results`);
    sections.push(`- assumptions`);
    sections.push(`- remaining risks`);
  }
  sections.push('');

  if ((task.final_report?.length ?? 0) > 0) {
    sections.push(finalReportBlock(task.final_report!));
    sections.push('');
  }

  return sections.join('\n').trim() + '\n';
}
