import type { HandoffSnapshot } from './snapshot';

export interface ProgressItem {
  item: string;
  status: 'completed' | 'partial' | 'remaining';
  evidence: string;
}

export interface ProgressReport {
  completed: ProgressItem[];
  partial: ProgressItem[];
  remaining: ProgressItem[];
  isInterrupted: boolean;
  /** True when memory's base_commit differs from current git HEAD —
   *  memory may be stale relative to the repository. */
  memoryMayBeStale: boolean;
}

export function classifyProgress(snapshot: HandoffSnapshot): ProgressReport {
  const task = snapshot.currentTask;
  if (!task || task.scope.length === 0) {
    return { completed: [], partial: [], remaining: [], isInterrupted: false, memoryMayBeStale: false };
  }

  // Staleness check: if memory.base_commit differs from git HEAD,
  // the persisted memory may not reflect the current repository state.
  const memoryMayBeStale =
    snapshot.memory.baseCommit !== null &&
    snapshot.git.head !== null &&
    snapshot.memory.baseCommit !== snapshot.git.head.hash;

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
    memoryMayBeStale,
  };
}
