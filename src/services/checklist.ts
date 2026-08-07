import type { TaskSpec } from '../schemas/taskspec';

/**
 * Checklist derivation (Phase 7).
 *
 * Pure function: derives a ✓/⚠ verification checklist from TaskSpec
 * content only. Never produces a numeric quality score.
 * The checklist reflects objective facts, not model-issued ratings.
 */

export interface ChecklistItem {
  /** Display label. */
  label: string;
  /** Whether the check is satisfied (true) or flagged for attention (false). */
  ok: boolean;
}

/**
 * Derive the verification checklist from a TaskSpec.
 * Each item is a factual check against the TaskSpec content.
 */
export function deriveChecklist(task: TaskSpec): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  // Objective is explicit and meaningful.
  items.push({
    label: 'Objective is explicit',
    ok: task.objective.length >= 10,
  });

  // Scope is bounded.
  items.push({
    label: 'Scope is bounded',
    ok: task.scope.length >= 1 && task.scope.length <= 50,
  });

  // Out of scope is defined.
  items.push({
    label: 'Out-of-scope items are defined',
    ok: (task.out_of_scope?.length ?? 0) > 0,
  });

  // Acceptance criteria exist.
  items.push({
    label: 'Acceptance criteria exist',
    ok: task.acceptance_criteria.length >= 1,
  });

  // Acceptance criteria are verifiable (heuristic: each is ≥ 10 chars).
  items.push({
    label: 'Acceptance criteria are verifiable',
    ok: task.acceptance_criteria.every((c) => c.length >= 10),
  });

  // Relevant context is included.
  items.push({
    label: 'Relevant context is included',
    ok: (task.relevant_context?.length ?? 0) > 0,
  });

  // Destructive actions require approval.
  const hasStopConditions = (task.stop_conditions?.length ?? 0) > 0;
  items.push({
    label: 'Destructive actions require approval',
    ok: hasStopConditions || task.risk_level === 'low',
  });

  // Assumptions are flagged.
  const assumptionCount = task.assumptions?.length ?? 0;
  items.push({
    label: assumptionCount > 0
      ? `${assumptionCount} assumption${assumptionCount > 1 ? 's' : ''} flagged`
      : 'No assumptions made',
    ok: assumptionCount === 0,
  });

  // Edge cases considered.
  items.push({
    label: 'Edge cases considered',
    ok: (task.edge_cases?.length ?? 0) > 0,
  });

  // Execution plan exists (for deep/plan modes).
  if (task.execution_mode === 'deep' || task.execution_mode === 'plan') {
    items.push({
      label: 'Execution plan provided',
      ok: (task.execution_plan?.length ?? 0) > 0,
    });
  }

  // Test plan exists.
  items.push({
    label: 'Test plan provided',
    ok: (task.test_plan?.length ?? 0) > 0,
  });

  return items;
}
