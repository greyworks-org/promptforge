import type { HandoffSnapshot } from './snapshot';
import { renderCurrentContinuation } from './renderCurrentState';

export function renderHandoffCodex(snapshot: HandoffSnapshot): string {
  return renderCurrentContinuation(snapshot, 'Codex', ['AGENTS.md'], 'Continue');
}
