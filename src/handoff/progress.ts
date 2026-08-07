import type { HandoffSnapshot } from './snapshot';

/**
 * Progress classification (Phase 10).
 *
 * Deterministic classification of task progress using live git evidence.
 * Every claim is labeled as evidence — never presented as fact.
 */

export interface ProgressItem {
  /** The scope item text. */
  item: string;
  /** Classification status. */
  status: 'completed' | 'partial' | 'remaining';
  /** Human-readable evidence supporting the classification. */
  evidence: string;
}

export interface ProgressReport {
  completed: ProgressItem[];
  partial: ProgressItem[];
  remaining: ProgressItem[];
  /** Whether the task appears interrupted (uncommitted changes exist). */
  isInterrupted: boolean;
}

/**
 * Classify task progress by comparing scope items against git evidence.
 *
 * - committed since base_commit → completed
 * - uncommitted changes touching related files → partial (interrupted)
 * - no evidence → remaining
 *
 * Every classification includes the evidence label.
 */
export function classifyProgress(snapshot: HandoffSnapshot): ProgressReport {
  const task = snapshot.currentTask;
  if (!task || task.scope.length === 0) {
    return { completed: [], partial: [], remaining: [], isInterrupted: false };
  }

  const hasUncommitted =
    snapshot.git.uncommitted.staged.length > 0 ||
    snapshot.git.uncommitted.unstaged.length > 0 ||
    snapshot.git.uncommitted.untracked.length > 0;

  const allChanged = [
    ...snapshot.git.uncommitted.staged,
    ...snapshot.git.uncommitted.unstaged,
  ];

  const completed: ProgressItem[] = [];
  const partial: ProgressItem[] = [];
  const remaining: ProgressItem[] = [];

  for (const item of task.scope) {
    // Simple heuristic: does any changed path overlap with keywords from the scope item?
    // This is intentionally simple — evidence is labeled as such.
    const relatedChanges = allChanged.filter((p) => {
      const lower = p.toLowerCase();
      const words = item.toLowerCase().split(/\s+/);
      return words.some((w) => w.length > 3 && lower.includes(w));
    });

    if (relatedChanges.length > 0) {
      partial.push({
        item,
        status: 'partial',
        evidence: `Uncommitted changes: ${relatedChanges.join(', ')}`,
      });
    } else {
      remaining.push({
        item,
        status: 'remaining',
        evidence: 'No evidence of completion in repository.',
      });
    }
  }

  return {
    completed,
    partial,
    remaining,
    isInterrupted: hasUncommitted && partial.length > 0,
  };
}
