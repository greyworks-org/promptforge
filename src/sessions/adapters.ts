import type { ExecutionSession, SessionEvent, SessionRuntime } from './types';

export interface RuntimeAdapter {
  runtime: SessionRuntime;
  label: string;
  instructionFiles: string[];
  renderContinuation(session: ExecutionSession, events: SessionEvent[]): string;
}

function commonContinuation(session: ExecutionSession, events: SessionEvent[]): string[] {
  const state = session.state;
  const lines = [
    `Continue PromptForge session ${session.id}.`,
    'The repository and current files are authoritative; verify before editing.',
    `Objective: ${state.objective || '(recover the persisted TaskSpec and inspect current state)'}`,
    `Task: ${state.taskId ?? 'no TaskSpec id recorded'}`,
    `Session status: ${session.status}`,
    '',
    '## Already observed',
    ...(state.completed.length > 0 ? state.completed.map((item) => `- DONE (persisted evidence): ${item}`) : ['- No completed work is persisted.']),
    '',
    '## Still pending',
    ...(state.pending.length > 0 ? state.pending.map((item) => `- ${item}`) : ['- Reconstruct the next safe step from the repository and TaskSpec.']),
  ];
  if (state.decisions.length > 0) {
    lines.push('', '## Decisions', ...state.decisions.map((item) => `- ${item}`));
  }
  if (state.blockers.length > 0) {
    lines.push('', '## Blockers and risks', ...state.blockers.map((item) => `- ${item}`));
  }
  if (state.relevantFiles.length > 0) {
    lines.push('', '## Relevant files', ...state.relevantFiles.map((item) => `- ${item}`));
  }
  if (state.lastAction || state.lastValidation) {
    lines.push('', '## Latest checkpoint');
    if (state.lastAction) lines.push(`- Last action: ${state.lastAction}`);
    if (state.lastValidation) lines.push(`- Last validation: ${state.lastValidation}`);
  }
  const notes = events.filter((event) => event.kind !== 'started').slice(-12);
  if (notes.length > 0) {
    lines.push('', '## Session knowledge (append-only local transcript)');
    for (const event of notes) {
      lines.push(`- [${event.kind}${event.runtime ? ` · ${event.runtime}` : ''}] ${event.content}`);
    }
  }
  lines.push('', 'Do not repeat completed work. Inspect the repository, ask before destructive operations, and report changed files and validation at the next checkpoint.');
  return lines;
}

function makeAdapter(runtime: SessionRuntime, label: string, instructionFiles: string[]): RuntimeAdapter {
  return {
    runtime,
    label,
    instructionFiles,
    renderContinuation(session, events) {
      return [
        `# PromptForge continuation · ${label}`,
        `Read ${instructionFiles.join(' and ')} before acting.`,
        ...commonContinuation(session, events),
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
