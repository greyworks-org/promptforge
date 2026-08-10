import { estimateTokens } from '../services/tokenBudget';
import type { CompilerOutput } from '../schemas/compilerOutput';
import type { TaskSpec } from '../schemas/taskspec';

/**
 * Client enrichment (Phase 6, TASKSPEC.md §1 step 3).
 *
 * Takes a validated CompilerOutput and assigns client-owned identifiers:
 * - task_id (TASK-YYYY-NNNN format, sequential per project/year)
 * - project_id (from the active project)
 * - schema_version (current contract version)
 *
 * Also recomputes the local token estimate.
 */

let taskCounter = 0;

/** Test seam: reset the sequential task counter. */
export function resetTaskCounterForTests(value = 0): void {
  taskCounter = value;
}

/** Generate a stable task ID: TASK-YYYY-NNNN. */
export function generateTaskId(): string {
  taskCounter += 1;
  const year = new Date().getFullYear();
  const seq = String(taskCounter).padStart(4, '0');
  return `TASK-${year}-${seq}`;
}

export interface EnrichInput {
  compilerOutput: CompilerOutput;
  projectId: string;
}

function normalizeStopCondition(condition: string): string {
  if (/^Any destructive database changes are required without approval\.?$/i.test(condition.trim())) {
    return 'Do not make destructive database changes without explicit approval.';
  }
  return condition;
}

/**
 * Enrich a validated CompilerOutput into a canonical TaskSpec.
 * This is deterministic: same input → same output.
 */
export function enrich(input: EnrichInput): TaskSpec {
  const { compilerOutput: co, projectId } = input;

  const taskSpec: TaskSpec = {
    schema_version: '1.1.0',
    task_id: generateTaskId(),
    project_id: projectId,
    task_type: co.task_type,
    execution_mode: co.execution_mode,
    target_model: co.target_model,
    agent_runtime: co.agent_runtime,
    execution_profile: co.execution_profile,
    objective: co.objective,
    scope: co.scope,
    acceptance_criteria: co.acceptance_criteria,
    risk_level: co.risk_level,

    // Optional fields — pass through if present.
    user_value: co.user_value,
    current_state: co.current_state ?? [],
    relevant_context: co.relevant_context ?? [],
    assumptions: co.assumptions ?? [],
    blocking_questions: co.blocking_questions ?? [],
    out_of_scope: co.out_of_scope ?? [],
    requirements: co.requirements,
    edge_cases: co.edge_cases ?? [],
    execution_plan: co.execution_plan ?? [],
    test_plan: co.test_plan ?? [],
    stop_conditions: (co.stop_conditions ?? []).map(normalizeStopCondition),
    final_report: co.final_report ?? [],
    confidence: co.confidence,
    estimated_prompt_tokens: estimateTokens(JSON.stringify(co)),
  };

  return taskSpec;
}
