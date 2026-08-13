import type { HandoffSnapshot } from './snapshot';
import { renderCurrentContinuation } from './renderCurrentState';

export function renderHandoffQwenCode(snapshot: HandoffSnapshot): string {
  return renderCurrentContinuation(snapshot, 'Qwen Code', ['AGENTS.md', 'QWEN.md'], 'Continue');
}
