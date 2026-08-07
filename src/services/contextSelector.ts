/**
 * Deterministic context-document selector (Phase 4).
 *
 * Maps task types to suggested context documents using fixed heuristics.
 * No model calls — the mapping is plain data. User overrides are always
 * available; the selector provides the initial suggestion only.
 */

/** Task types from the TaskSpec enum. */
export type TaskType =
  | 'planning' | 'feature' | 'ui' | 'backend' | 'database'
  | 'integration' | 'bugfix' | 'refactor' | 'review'
  | 'security' | 'testing' | 'deployment';

/**
 * Mapping from task type → recommended context document filenames
 * (spec §11 examples). CURRENT_STATE.md is always included as a baseline.
 * Documents not listed are not suggested, but the user can add them manually.
 */
const TASK_TYPE_DOCS: Record<TaskType, string[]> = {
  planning: [
    'PRODUCT.md', 'ARCHITECTURE.md', 'CURRENT_STATE.md',
    'BACKLOG.md', 'DECISIONS.md',
  ],
  feature: [
    'PRODUCT.md', 'DESIGN.md', 'DATA_MODEL.md', 'CURRENT_STATE.md',
    'BACKLOG.md',
  ],
  ui: [
    'PRODUCT.md', 'DESIGN.md', 'CURRENT_STATE.md',
  ],
  backend: [
    'ARCHITECTURE.md', 'DATA_MODEL.md', 'INTEGRATIONS.md',
    'SECURITY.md', 'CURRENT_STATE.md',
  ],
  database: [
    'DATA_MODEL.md', 'ARCHITECTURE.md', 'SECURITY.md', 'CURRENT_STATE.md',
  ],
  integration: [
    'INTEGRATIONS.md', 'DATA_MODEL.md', 'SECURITY.md',
    'ARCHITECTURE.md', 'CURRENT_STATE.md',
  ],
  bugfix: [
    'CURRENT_STATE.md', 'ARCHITECTURE.md', 'TESTING.md',
  ],
  refactor: [
    'ARCHITECTURE.md', 'DATA_MODEL.md', 'TESTING.md', 'CURRENT_STATE.md',
    'DECISIONS.md',
  ],
  review: [
    'ARCHITECTURE.md', 'SECURITY.md', 'TESTING.md', 'CURRENT_STATE.md',
    'DECISIONS.md',
  ],
  security: [
    'SECURITY.md', 'DATA_MODEL.md', 'INTEGRATIONS.md',
    'ARCHITECTURE.md', 'CURRENT_STATE.md',
  ],
  testing: [
    'TESTING.md', 'ARCHITECTURE.md', 'CURRENT_STATE.md',
  ],
  deployment: [
    'TESTING.md', 'ARCHITECTURE.md', 'INTEGRATIONS.md',
    'SECURITY.md', 'CURRENT_STATE.md',
  ],
};

/**
 * Return the suggested context document filenames for a given task type.
 * The result is deterministic: same input → same output every time.
 * CURRENT_STATE.md is always included for every task type.
 */
export function suggestDocs(taskType: TaskType): string[] {
  return TASK_TYPE_DOCS[taskType] ?? ['CURRENT_STATE.md'];
}

/**
 * Return suggested doc filenames filtered to only those that exist in the
 * registered context-doc list.
 */
export function suggestExistingDocs(
  taskType: TaskType,
  registeredFilenames: string[],
): string[] {
  const suggested = suggestDocs(taskType);
  return suggested.filter((f) => registeredFilenames.includes(f));
}

/**
 * All context document filenames in canonical order.
 * Used when the user wants to see everything available.
 */
export const ALL_CONTEXT_DOCS = [
  'PRODUCT.md', 'ARCHITECTURE.md', 'DESIGN.md', 'DATA_MODEL.md',
  'INTEGRATIONS.md', 'SECURITY.md', 'TESTING.md', 'DECISIONS.md',
  'CURRENT_STATE.md', 'BACKLOG.md',
];
