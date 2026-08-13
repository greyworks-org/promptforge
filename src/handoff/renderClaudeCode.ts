import type { HandoffSnapshot } from './snapshot';
import { renderCurrentContinuation } from './renderCurrentState';

export function renderHandoffClaudeCode(snapshot: HandoffSnapshot): string {
  return renderCurrentContinuation(snapshot, 'Claude Code', ['AGENTS.md', 'CLAUDE.md'], 'Resume');
}
