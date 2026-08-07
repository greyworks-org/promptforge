import type { HandoffSnapshot } from './snapshot';
import { classifyProgress } from './progress';

/**
 * Codex handoff renderer (Phase 10).
 *
 * Short continuation prompt. Outcome-first, constraints,
 * report list. Reads AGENTS.md.
 */

export function renderHandoffCodex(snapshot: HandoffSnapshot): string {
  const progress = classifyProgress(snapshot);
  const sections: string[] = [];

  sections.push(`# Continue: ${snapshot.projectName}`);
  sections.push('');

  sections.push(`Use AGENTS.md as the repository instruction source.`);
  sections.push(`Inspect the current git status and existing implementation before making changes.`);
  sections.push('');

  if (snapshot.currentTask) {
    const t = snapshot.currentTask;
    sections.push(`## Objective`);
    sections.push(t.objective);
    sections.push('');

    if (t.scope.length > 0) {
      sections.push('### Required outcome');
      for (const s of t.scope) sections.push(`- ${s}`);
      sections.push('');
    }

    if (t.out_of_scope && t.out_of_scope.length > 0) {
      sections.push('### Out of scope');
      for (const s of t.out_of_scope) sections.push(`- ${s}`);
      sections.push('');
    }

    if (t.acceptance_criteria.length > 0) {
      sections.push('### Acceptance criteria');
      for (const ac of t.acceptance_criteria) sections.push(`- ${ac}`);
      sections.push('');
    }

    if (t.stop_conditions && t.stop_conditions.length > 0) {
      sections.push('### Constraints');
      for (const sc of t.stop_conditions) sections.push(`- ${sc}`);
      sections.push('');
    }
  }

  if (snapshot.memory.decisions.length > 0) {
    sections.push('## Decisions');
    for (const d of snapshot.memory.decisions) sections.push(`- ${d.text}`);
    sections.push('');
  }

  if (progress.isInterrupted) {
    sections.push('## Uncommitted changes');
    if (snapshot.git.uncommitted.diffStat) {
      sections.push(snapshot.git.uncommitted.diffStat);
      sections.push('');
    }
    sections.push('Review with the user before keeping or discarding.');
    sections.push('No destructive git operation without confirmation.');
    sections.push('');

    if (progress.partial.length > 0) {
      for (const p of progress.partial) {
        sections.push(`- ⚠ ${p.item}`);
      }
      sections.push('');
    }
  }

  if (progress.remaining.length > 0) {
    sections.push('## Remaining');
    for (const r of progress.remaining) sections.push(`- ${r.item}`);
    sections.push('');
  }

  if (progress.completed.length > 0) {
    sections.push('## Completed — do not redo');
    for (const c of progress.completed) sections.push(`- ${c.item}`);
    sections.push('');
  }

  sections.push('Complete the implementation, run validations, and report:');
  sections.push('- files changed');
  sections.push('- commands executed');
  sections.push('- test results');
  sections.push('- remaining risks');

  return sections.join('\n').trim() + '\n';
}
