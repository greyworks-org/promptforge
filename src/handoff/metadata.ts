import type { HandoffSnapshot } from './snapshot';
import type { ProgressReport } from './progress';
import { isBinaryByExtension, isBlockedFilePath } from '../redaction/blocklist';

function hasUncommitted(snapshot: HandoffSnapshot): boolean {
  const changes = snapshot.git.uncommitted;
  return changes.staged.length > 0 || changes.unstaged.length > 0 || changes.untracked.length > 0;
}

export function filterHandoffPaths(paths: string[]): string[] {
  return paths.filter((path) => !isBlockedFilePath(path) && !isBinaryByExtension(path));
}

export function filterHandoffDiffStat(diffStat: string): string {
  return diffStat
    .split('\n')
    .filter((line) => {
      const separator = line.lastIndexOf(' | ');
      if (separator < 0) return true;
      const path = line.slice(0, separator).trim();
      return filterHandoffPaths([path]).length > 0;
    })
    .join('\n');
}

function taskStatus(snapshot: HandoffSnapshot, progress: ProgressReport): 'active' | 'partial' | 'completed' {
  if (!snapshot.currentTask) return 'active';
  if (progress.completed.length === snapshot.currentTask.scope.length && snapshot.currentTask.scope.length > 0) {
    return 'completed';
  }
  return hasUncommitted(snapshot) ? 'partial' : 'active';
}

export function renderHandoffMetadata(
  snapshot: HandoffSnapshot,
  progress: ProgressReport,
  handoffTarget: 'Codex' | 'Claude Code' | 'Qwen Code',
): string {
  const task = snapshot.currentTask;
  const sections: string[] = [];
  const changed = [
    ...snapshot.git.uncommitted.staged,
    ...snapshot.git.uncommitted.unstaged,
    ...snapshot.git.uncommitted.untracked,
  ];
  const filteredPaths = filterHandoffPaths(changed);
  const filteredDiffStat = filterHandoffDiffStat(snapshot.git.uncommitted.diffStat);

  if (task) {
    sections.push('## Status');
    sections.push(taskStatus(snapshot, progress));
    sections.push('');

    sections.push('## Original task execution');
    sections.push(`- Runtime: ${task.agent_runtime}`);
    sections.push(`- Provider/access: ${snapshot.currentCompilation?.providerLabel ?? 'recorded provider unavailable'} / OS Keychain`);
    sections.push(`- Model: ${task.target_model}`);
    sections.push('');

  }

  sections.push('## Current handoff target');
  sections.push(handoffTarget);
  sections.push('');

  const semantic = snapshot.memory.semanticContext;
  if (semantic?.status === 'fresh' && semantic.snapshot) {
    const state = semantic.snapshot;
    sections.push('## Live implementation state');
    sections.push('Observed completed:');
    for (const item of state.observed_completed) sections.push(`- ${item}`);
    if (state.observed_completed.length === 0) sections.push('- None recorded.');
    sections.push('Observed partial:');
    for (const item of state.observed_partial) sections.push(`- ${item}`);
    if (state.observed_partial.length === 0) sections.push('- None recorded.');
    sections.push('Changed files:');
    for (const file of state.changed_files) sections.push(`- ${file.path} → ${file.description}`);
    if (state.changed_files.length === 0) sections.push('- No semantic file descriptions recorded.');
    sections.push('Validation evidence:');
    for (const item of state.validation_evidence) sections.push(`- ${item}`);
    if (state.validation_evidence.length === 0) sections.push('- None recorded.');
    sections.push('Acceptance requiring verification:');
    for (const item of state.acceptance_requiring_verification) sections.push(`- ${item}`);
    sections.push('Known blockers:');
    for (const item of state.blockers_observed) sections.push(`- ${item}`);
    if (state.blockers_observed.length === 0) sections.push('- None observed.');
    if (state.architecture_facts_observed.length > 0) {
      sections.push('Architecture facts observed:');
      for (const item of state.architecture_facts_observed) sections.push(`- ${item}`);
    }
    if (state.risks_observed.length > 0) {
      sections.push('Risks observed:');
      for (const item of state.risks_observed) sections.push(`- ${item}`);
    }
    sections.push(`Immediate continuation: ${state.immediate_next_action}`);
    sections.push('The current repository is authoritative. Use this semantic snapshot as evidence-backed continuation context, verify ambiguous items, and do not redo already-implemented work.');
    sections.push('');
  } else if (semantic?.status === 'unavailable') {
    sections.push('## Context status');
    sections.push('No semantic summary is available for this snapshot. The repository and Git evidence remain authoritative.');
    sections.push('');
  }

  sections.push('## Repository');
  sections.push(`Repository: \`${snapshot.repoPath}\``);
  sections.push('Work only in this repository.');
  sections.push('Verify the repository root before editing.');
  sections.push('Do not operate from an unrelated parent worktree.');
  sections.push(`- HEAD: ${snapshot.git.head ? `${snapshot.git.head.hash.slice(0, 8)} — ${snapshot.git.head.subject}` : 'unavailable'}`);
  sections.push(`- Modified files: ${filteredPaths.length > 0 ? filteredPaths.join(', ') : 'none'}`);
  if (filteredDiffStat) sections.push(`- Diff evidence: ${filteredDiffStat}`);
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
    sections.push('Review the uncommitted changes and diff evidence with the user, then reconcile the original acceptance criteria against the current repository.');
  } else if (taskStatus(snapshot, progress) === 'completed') {
    sections.push('Verify the completed evidence against the canonical acceptance criteria before marking the task validated.');
  } else {
    sections.push('Inspect the current repository state, then reconcile the original acceptance criteria before acting.');
  }

  return sections.join('\n');
}
