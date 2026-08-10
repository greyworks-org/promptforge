import type { HandoffSnapshot } from './snapshot';
import { classifyProgress } from './progress';
import { renderHandoffMetadata } from './metadata';

/**
 * Qwen Code handoff renderer (Phase 10).
 *
 * Short continuation prompt. Explicit steps, targeted reads.
 * Reads QWEN.md + AGENTS.md.
 */

export function renderHandoffQwenCode(snapshot: HandoffSnapshot): string {
  const progress = classifyProgress(snapshot);
  const sections: string[] = [];

  sections.push(`# Continue: ${snapshot.projectName}`);
  sections.push('');

  sections.push(`Follow AGENTS.md and QWEN.md.`);
  sections.push(`Inspect \`git status\` and \`git diff\` before making changes.`);
  sections.push('');

  if (snapshot.currentTask) {
    const t = snapshot.currentTask;
    sections.push(`## Task: ${t.task_id}`);
    sections.push('');
    sections.push(t.objective);
    sections.push('');

    if (t.scope.length > 0) {
      sections.push('### Scope');
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
      sections.push('### Stop before');
      for (const sc of t.stop_conditions) sections.push(`- ${sc}`);
      sections.push('');
    }
  }

  sections.push(renderHandoffMetadata(snapshot, progress));
  sections.push('');

  if (snapshot.memory.decisions.length > 0) {
    sections.push('## Decisions');
    for (const d of snapshot.memory.decisions) sections.push(`- ${d.text}`);
    sections.push('');
  }

  if (progress.isInterrupted) {
    sections.push('## Uncommitted work detected');
    sections.push('');
    if (snapshot.git.uncommitted.diffStat) {
      sections.push(`${snapshot.git.uncommitted.diffStat}`);
      sections.push('');
    }
    sections.push('Review the uncommitted changes with the user before continuing.');
    sections.push('Do not run destructive git operations without confirmation.');
    sections.push('');

    if (progress.partial.length > 0) {
      for (const p of progress.partial) {
        sections.push(`- ⚠ ${p.item} (evidence: ${p.evidence})`);
      }
      sections.push('');
    }
  }

  if (progress.remaining.length > 0) {
    sections.push('## To do');
    for (const r of progress.remaining) sections.push(`- ${r.item}`);
    sections.push('');
  }

  if (progress.completed.length > 0) {
    sections.push('## Already done — skip');
    for (const c of progress.completed) sections.push(`- ${c.item}`);
    sections.push('');
  }

  if (snapshot.memory.currentPhase) {
    sections.push(`Phase: ${snapshot.memory.currentPhase}`);
    sections.push('');
  }

  sections.push('Verify evidence before acting. Do not redo completed items.');

  return sections.join('\n').trim() + '\n';
}
