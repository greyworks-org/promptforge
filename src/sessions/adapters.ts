import type { ExecutionSession, SessionEvent, SessionRuntime } from './types';
import type { TaskSpec } from '../schemas/taskspec';
import type { ContinuationState } from '../handoff/continuationState';

export interface RuntimeAdapter {
  runtime: SessionRuntime;
  label: string;
  instructionFiles: string[];
  renderContinuation(session: ExecutionSession, events: SessionEvent[], contextPaths?: string[], task?: TaskSpec | null, state?: ContinuationState): string;
}

function runtimeLabel(runtime: string | null): string {
  return runtime === 'claude-code' ? 'Claude Code' : runtime === 'qwen-code' ? 'Qwen Code' : runtime === 'opencode' ? 'OpenCode' : runtime === 'codex' ? 'Codex' : 'Unknown runtime';
}

function executionLabel(identity: ContinuationState['continueWith']): string {
  return `${runtimeLabel(identity.runtime)} · ${identity.modelRef ?? identity.modelId ?? 'model unknown'}`;
}

function commonContinuation(session: ExecutionSession, _events: SessionEvent[], task: TaskSpec | null | undefined, state?: ContinuationState): string[] {
  if (!state) return [
    `Continue PromptForge session ${session.id}.`,
    'No derived continuation state is available; inspect the repository and persisted session state before acting.',
  ];
  const taskState = state;
  const lines = [
    `Continue PromptForge session ${session.id}.`,
    'The repository and current files are authoritative; verify before editing.',
    `Objective: ${session.state.objective || '(recover the persisted TaskSpec and inspect current state)'}`,
    `Task: ${taskState.originalTaskReference ?? session.state.taskId ?? 'no TaskSpec id recorded'}`,
    '',
    '## Current project state',
    `- HEAD: ${taskState.currentHead ?? 'unavailable'}${taskState.branch ? ` · ${taskState.branch}` : ''} · ${taskState.clean ? 'clean' : 'changes'}`,
    `- Status: ${taskState.taskStatus}`,
    ...(taskState.relevantChangedFiles.length > 0 ? [`- Changed files: ${taskState.relevantChangedFiles.join(', ')}`] : ['- Changed files: none']),
    ...(taskState.relevantRecentCommits.length > 0 ? ['- Recent commits:', ...taskState.relevantRecentCommits.map((commit) => `  - ${commit.hash.slice(0, 8)} — ${commit.subject}`)] : []),
    '',
    '## Verified completed',
    ...(taskState.verifiedCompleted.length > 0 ? taskState.verifiedCompleted.map((item) => `- ${item}`) : ['- None recorded.']),
    '',
    '## In progress / unverified',
    ...(taskState.unverified.length > 0 ? taskState.unverified.map((item) => `- ${item}`) : ['- None recorded.']),
    '',
    '## Still pending',
    ...(taskState.remaining.length > 0 ? taskState.remaining.map((item) => `- ${item}`) : ['- None.']),
    '',
    '## Next action',
    taskState.nextAction,
    '',
    '## Last execution',
    `- ${executionLabel(taskState.lastExecution)}`,
    ...(taskState.lastExecution.checkpoint ? [`- Checkpoint: ${taskState.lastExecution.checkpoint}`] : []),
    ...(taskState.lastExecution.result ? [`- Result: ${taskState.lastExecution.result}`] : []),
    '',
    '## Continue with',
    `- ${executionLabel(taskState.continueWith)}`,
  ];
  if (taskState.checkpointNotes.length > 0) {
    lines.push('', '## Checkpoint knowledge', ...taskState.checkpointNotes.map((item) => `- ${item}`));
  }
  if (taskState.verificationEvidence.length > 0) {
    lines.push('', '## Verification evidence', ...taskState.verificationEvidence.map((item) => `- ${item}`));
  }
  if (taskState.decisions.length > 0) {
    lines.push('', '## Decisions', ...taskState.decisions.map((item) => `- ${item}`));
  }
  if (taskState.blockers.length > 0) {
    lines.push('', '## Blockers', ...taskState.blockers.map((item) => `- ${item}`));
  }
  if (taskState.scopeConstraints.length > 0) {
    lines.push('', '## Scope / preserve constraints', ...taskState.scopeConstraints.map((item) => `- ${item}`));
  }
  if (task && taskState.originalTaskReference) {
    lines.push('', '## Canonical TaskSpec reference', `- ${taskState.originalTaskReference} remains canonical; only unresolved items above are actionable.`);
  }
  lines.push('', 'Do not repeat completed work. Do not replay the previous transcript. Inspect only the evidence needed for the next action, ask before destructive operations, and report changed files and validation at the next checkpoint.');
  return lines;
}

function makeAdapter(runtime: SessionRuntime, label: string, instructionFiles: string[]): RuntimeAdapter {
  return {
    runtime,
    label,
    instructionFiles,
    renderContinuation(session, events, contextPaths = [], task = null, state) {
      const selectedContext = contextPaths.length > 0
        ? [
          '',
          '## Selected project context documents',
          'Before acting, read these existing files from the registered repository:',
          ...contextPaths.map((path) => `- ${path}`),
        ]
        : [];
      return [
        `# PromptForge continuation · ${label}`,
        `Read ${instructionFiles.join(' and ')} before acting.`,
        ...selectedContext,
        ...commonContinuation(session, events, task, state),
      ].join('\n');
    },
  };
}

export const RUNTIME_ADAPTERS: Record<SessionRuntime, RuntimeAdapter> = {
  'claude-code': makeAdapter('claude-code', 'Claude Code', ['AGENTS.md', 'CLAUDE.md']),
  'qwen-code': makeAdapter('qwen-code', 'Qwen Code', ['AGENTS.md', 'QWEN.md']),
  codex: makeAdapter('codex', 'Codex', ['AGENTS.md']),
  opencode: makeAdapter('opencode', 'OpenCode', ['AGENTS.md']),
};

export function adapterFor(runtime: SessionRuntime): RuntimeAdapter {
  return RUNTIME_ADAPTERS[runtime];
}
