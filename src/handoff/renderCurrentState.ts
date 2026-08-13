import type { HandoffSnapshot } from './snapshot';
import { deriveContinuationState, type ContinuationState } from './continuationState';
import { filterHandoffDiffStat, filterHandoffPaths } from './metadata';

export type HandoffTarget = 'Codex' | 'Claude Code' | 'Qwen Code';

function runtimeLabel(runtime: string | null): string {
  return runtime === 'claude-code' ? 'Claude Code' : runtime === 'qwen-code' ? 'Qwen Code' : runtime === 'opencode' ? 'OpenCode' : runtime === 'codex' ? 'Codex' : 'Unknown runtime';
}

function executionLabel(identity: ContinuationState['continueWith']): string {
  return `${runtimeLabel(identity.runtime)} · ${identity.modelRef ?? identity.modelId ?? 'model unknown'}`;
}

function stateFor(snapshot: HandoffSnapshot, target: HandoffTarget): ContinuationState {
  return snapshot.continuationState ?? deriveContinuationState({
    task: snapshot.currentTask,
    session: null,
    events: [],
    memory: snapshot.memory,
    git: snapshot.git,
    currentCompilationProvider: snapshot.currentCompilation?.providerLabel ?? null,
    target: { runtime: target === 'Claude Code' ? 'claude-code' : target === 'Qwen Code' ? 'qwen-code' : 'codex' },
  });
}

export function renderCurrentContinuation(
  snapshot: HandoffSnapshot,
  target: HandoffTarget,
  instructionFiles: string[],
  title: string,
): string {
  const state = stateFor(snapshot, target);
  const changed = filterHandoffPaths(state.relevantChangedFiles);
  const sections: string[] = [
    `# ${title}: ${snapshot.projectName}`,
    '',
    `Read ${instructionFiles.join(' and ')} before acting.`,
    'The current repository and canonical evidence are authoritative. Do not replay the previous conversation.',
    '',
    '## Current task',
    snapshot.currentTask ? `${snapshot.currentTask.objective} (${snapshot.currentTask.task_id})` : 'No active TaskSpec.',
    `Status: ${state.taskStatus}`,
    '',
    '## Current project state',
    `Repository: \`${snapshot.repoPath}\``,
    `HEAD: ${state.currentHead ?? 'unavailable'}${state.branch ? ` · ${state.branch}` : ''} · ${state.clean ? 'clean' : 'changes'}`,
    changed.length > 0 ? `Relevant changed files: ${changed.join(', ')}` : 'Relevant changed files: none',
    ...(state.relevantRecentCommits.length > 0
      ? ['Relevant recent commits:', ...state.relevantRecentCommits.map((commit) => `- ${commit.hash.slice(0, 8)} — ${commit.subject}`)]
      : []),
    ...(filterHandoffDiffStat(snapshot.git.uncommitted.diffStat) ? [`Diff evidence: ${filterHandoffDiffStat(snapshot.git.uncommitted.diffStat)}`] : []),
    '',
    '## Last execution',
    executionLabel(state.lastExecution),
    ...(state.lastExecution.checkpoint ? [`Checkpoint: ${state.lastExecution.checkpoint}`] : []),
    ...(state.lastExecution.result ? [`Last result: ${state.lastExecution.result}`] : []),
    '',
    '## Continue with',
    executionLabel(state.continueWith),
    '',
    '## Current handoff target',
    target,
    '',
    '## Verified completed',
    ...(state.verifiedCompleted.length > 0 ? state.verifiedCompleted.map((item) => `- ${item}`) : ['- None recorded.']),
    '',
    '## In progress / unverified',
    ...(state.unverified.length > 0 ? state.unverified.map((item) => `- ${item}`) : ['- None recorded.']),
    '',
    '## Still pending',
    ...(state.remaining.length > 0 ? state.remaining.map((item) => `- ${item}`) : ['- None.']),
    '',
    '## Next action',
    state.nextAction,
  ];
  if (state.checkpointNotes.length > 0) sections.push('', '## Checkpoint knowledge', ...state.checkpointNotes.map((item) => `- ${item}`));
  if (state.verificationEvidence.length > 0) sections.push('', '## Verification evidence', ...state.verificationEvidence.map((item) => `- ${item}`));
  if (state.blockers.length > 0) sections.push('', '## Blockers', ...state.blockers.map((item) => `- ${item}`));
  if (state.decisions.length > 0) sections.push('', '## Decisions', ...state.decisions.map((item) => `- ${item}`));
  if (state.scopeConstraints.length > 0) sections.push('', '## Scope / preserve constraints', ...state.scopeConstraints.map((item) => `- ${item}`));
  if (snapshot.currentTask) {
    sections.push('', '## Scope lock', 'Preserve the existing architecture, behavior, data and interfaces. Do not perform unrelated cleanup or start later delivery slices.');
    sections.push('', '## Completion control', 'Functional golden-path verification (required when runnable):');
    sections.push(...(state.remaining.length > 0 ? state.remaining.map((item) => `- ${item}`) : ['- No unresolved acceptance items.']));
    sections.push('', 'Original task items to reconcile against current repository state');
    sections.push('', '### Acceptance requiring verification', ...(state.remaining.length > 0 ? state.remaining.map((item) => `- ${item}`) : ['- None.']));
  }
  sections.push('', '## Canonical TaskSpec reference', `TaskSpec ${state.originalTaskReference ?? 'not available'} remains canonical; only unresolved items above are actionable.`);
  if (snapshot.currentTask) {
    sections.push(`## Original task execution`, `- Runtime: ${runtimeLabel(snapshot.currentTask.agent_runtime)}`, `- Provider/access: ${snapshot.currentCompilation?.providerLabel ?? 'recorded provider unavailable'} / OS Keychain`, `- Model: ${snapshot.currentTask.target_model}`);
  }
  if (state.decisions.length === 0) sections.push('', 'No decisions recorded.');
  if (!state.clean) sections.push('', 'Uncommitted changes are present; review the current evidence before acting.');
  if (snapshot.memory.currentPhase) sections.push('', `Phase: ${snapshot.memory.currentPhase}`);
  sections.push('', 'Do not redo completed work. Do not mark repository changes verified solely because files changed. Verify the next action and report evidence.');
  return sections.join('\n').trim() + '\n';
}
