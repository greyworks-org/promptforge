import type { HandoffSnapshot } from './snapshot';
import type { ProgressReport } from './progress';

function hasUncommitted(snapshot: HandoffSnapshot): boolean {
  const changes = snapshot.git.uncommitted;
  return changes.staged.length > 0 || changes.unstaged.length > 0 || changes.untracked.length > 0;
}

function taskStatus(snapshot: HandoffSnapshot, progress: ProgressReport): 'active' | 'partial' | 'completed' {
  if (!snapshot.currentTask) return 'active';
  if (progress.completed.length === snapshot.currentTask.scope.length && snapshot.currentTask.scope.length > 0) {
    return 'completed';
  }
  return hasUncommitted(snapshot) ? 'partial' : 'active';
}

export function renderHandoffMetadata(snapshot: HandoffSnapshot, progress: ProgressReport): string {
  const task = snapshot.currentTask;
  const sections: string[] = [];
  const changed = [
    ...snapshot.git.uncommitted.staged,
    ...snapshot.git.uncommitted.unstaged,
    ...snapshot.git.uncommitted.untracked,
  ];

  if (task) {
    sections.push('## Status');
    sections.push(taskStatus(snapshot, progress));
    sections.push('');

    sections.push('## Execution');
    sections.push(`- Runtime: ${task.agent_runtime}`);
    sections.push(`- Provider/access: ${snapshot.currentCompilation?.providerLabel ?? 'recorded provider unavailable'} / OS Keychain`);
    sections.push(`- Model: ${task.target_model}`);
    sections.push('');
  }

  sections.push('## Repository');
  sections.push(`- HEAD: ${snapshot.git.head ? `${snapshot.git.head.hash.slice(0, 8)} — ${snapshot.git.head.subject}` : 'unavailable'}`);
  sections.push(`- Modified files: ${changed.length > 0 ? changed.join(', ') : 'none'}`);
  if (snapshot.git.uncommitted.diffStat) sections.push(`- Diff evidence: ${snapshot.git.uncommitted.diffStat}`);
  sections.push('');

  sections.push('## Recorded');
  if (snapshot.memory.decisions.length === 0 && snapshot.memory.blockers.length === 0) {
    sections.push('No decisions or blockers recorded.');
  } else {
    for (const decision of snapshot.memory.decisions) sections.push(`- Decision: ${decision.text}`);
    for (const blocker of snapshot.memory.blockers) sections.push(`- Blocker (${blocker.kind}): ${blocker.text}`);
  }
  sections.push('');

  sections.push('## Continuation');
  if (!task) {
    sections.push('Inspect the repository and determine the next task from local project state.');
  } else if (taskStatus(snapshot, progress) === 'partial') {
    sections.push('Review the uncommitted changes and diff evidence with the user, then continue the remaining acceptance criteria for this task.');
  } else if (taskStatus(snapshot, progress) === 'completed') {
    sections.push('Verify the completed evidence against the canonical acceptance criteria before marking the task validated.');
  } else {
    sections.push('Inspect the current repository state, then continue the remaining acceptance criteria for this task.');
  }

  return sections.join('\n');
}
