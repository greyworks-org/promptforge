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
    wipMode: snapshot.wipMode ?? 'auto',
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
  const adoptingWip = state.wipAlignment.mode === 'adopt-wip';
  // When the live diff has drifted from the archived TaskSpec, actionable
  // focus shifts to completing/verifying the in-progress work. Archived
  // acceptance remains visible for reference only; guardrails stay intact.
  const activeItems = adoptingWip ? state.wipAlignment.actionItems : state.remaining;
  const sections: string[] = [
    `# ${title}: ${snapshot.projectName}`,
    '',
    `Read ${instructionFiles.join(' and ')} before acting.`,
    'The current repository and canonical evidence are authoritative. Do not replay the previous conversation.',
    '',
    '## Current task',
    adoptingWip && state.wipAlignment.objective
      ? `Live WIP adoption: ${state.wipAlignment.objective}`
      : snapshot.currentTask
        ? `${snapshot.currentTask.objective} (${snapshot.currentTask.task_id})`
        : 'No active TaskSpec.',
    `Status: ${state.taskStatus}`,
    ...(adoptingWip && snapshot.currentTask
      ? [`Archived task (canonical reference only): ${snapshot.currentTask.objective} (${snapshot.currentTask.task_id})`]
      : []),
    ...(adoptingWip
      ? [`Drift detected: live diff vocabulary overlap with the archived task is ${(state.wipAlignment.overlapRatio * 100).toFixed(0)}%.`]
      : []),
    ...(adoptingWip && state.wipAlignment.evidence.length > 0
      ? ['Live WIP evidence:', ...state.wipAlignment.evidence.map((item) => `- ${item}`)]
      : []),
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
    ...(activeItems.length > 0 ? activeItems.map((item) => `- ${item}`) : ['- None.']),
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
    sections.push('', '## Completion control', adoptingWip
      ? 'Live work-in-progress gate (required when runnable). Do not define success by the archived acceptance criteria until the in-progress work is complete and verified:'
      : 'Functional golden-path verification (required when runnable):');
    sections.push(...(activeItems.length > 0 ? activeItems.map((item) => `- ${item}`) : ['- No unresolved acceptance items.']));
    if (adoptingWip) {
      sections.push('', 'Live WIP items to complete and verify before revisiting the archived task', '### Live WIP acceptance requiring verification', ...(state.wipAlignment.actionItems.map((item) => `- ${item}`)));
      sections.push('', '### Archived acceptance (reference only)', ...(state.remaining.length > 0 ? state.remaining.map((item) => `- ${item}`) : ['- None.']));
    } else {
      sections.push('', 'Original task items to reconcile against current repository state');
      sections.push('', '### Acceptance requiring verification', ...(state.remaining.length > 0 ? state.remaining.map((item) => `- ${item}`) : ['- None.']));
    }
  }
  sections.push('', '## Canonical TaskSpec reference', adoptingWip
    ? `TaskSpec ${state.originalTaskReference ?? 'not available'} remains canonical in memory, but the live work-in-progress takes precedence; finish or explicitly park it before resuming archived task items.`
    : `TaskSpec ${state.originalTaskReference ?? 'not available'} remains canonical; only unresolved items above are actionable.`);
  if (snapshot.currentTask) {
    sections.push(`## Original task execution`, `- Runtime: ${runtimeLabel(snapshot.currentTask.agent_runtime)}`, `- Provider/access: ${snapshot.currentCompilation?.providerLabel ?? 'recorded provider unavailable'} / OS Keychain`, `- Model: ${snapshot.currentTask.target_model}`);
  }
  if (state.decisions.length === 0) sections.push('', 'No decisions recorded.');
  if (!state.clean) sections.push('', 'Uncommitted changes are present; review the current evidence before acting.');
  if (snapshot.memory.currentPhase) sections.push('', `Phase: ${snapshot.memory.currentPhase}`);
  sections.push('', 'Do not redo completed work. Do not mark repository changes verified solely because files changed. Verify the next action and report evidence.');
  return sections.join('\n').trim() + '\n';
}
