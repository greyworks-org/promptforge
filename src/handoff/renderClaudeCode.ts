import type { HandoffSnapshot } from './snapshot';
import { classifyProgress } from './progress';
import { filterHandoffDiffStat, renderHandoffMetadata } from './metadata';

/**
 * Claude Code handoff renderer (Phase 10).
 *
 * Short continuation prompt for Claude Code. Pure function — zero
 * provider calls. Plan-first, risk emphasis, recovery-aware.
 * Profile-aware (reads CLAUDE.md + AGENTS.md).
 */

export function renderHandoffClaudeCode(snapshot: HandoffSnapshot): string {
  const progress = classifyProgress(snapshot);
  const sections: string[] = [];

  sections.push(`# Resume: ${snapshot.projectName}`);
  sections.push('');

  // Instructions to inspect first.
  sections.push(`Review CLAUDE.md and AGENTS.md first.`);
  sections.push(`Run \`git status\` and \`git diff\` to understand the current state.`);
  sections.push('');

  // Task status.
  if (snapshot.currentTask) {
    const t = snapshot.currentTask;
    sections.push(`## Current task: ${t.task_id}`);
    sections.push('');
    sections.push(t.objective);
    sections.push('');

    if (t.scope.length > 0) {
      sections.push('### Scope');
      for (const s of t.scope) {
        sections.push(`- ${s}`);
      }
      sections.push('');
    }

    if (t.out_of_scope && t.out_of_scope.length > 0) {
      sections.push('### Out of scope');
      for (const s of t.out_of_scope) {
        sections.push(`- ${s}`);
      }
      sections.push('');
    }
  }

  sections.push(renderHandoffMetadata(snapshot, progress, 'Claude Code'));
  sections.push('');

  // Decisions.
  if (snapshot.memory.decisions.length > 0) {
    sections.push('## Confirmed decisions');
    for (const d of snapshot.memory.decisions) {
      sections.push(`- ${d.text}`);
    }
    sections.push('');
  } else {
    sections.push('## Decisions');
    sections.push('');
    sections.push('(No decisions recorded in project memory. Review git history and current code to understand the rationale behind existing implementation choices.)');
    sections.push('');
  }

  // Staleness reconciliation: memory may be behind current git state.
  if (progress.memoryMayBeStale) {
    sections.push('## ⚠ Memory may be stale');
    sections.push('');
    sections.push(`The project memory was last updated at commit \`${snapshot.memory.baseCommit?.slice(0, 8) ?? 'unknown'}\` but the current HEAD is \`${snapshot.git.head?.hash.slice(0, 8) ?? 'unknown'}\`. Newer commits exist — review them before relying on the recorded memory.`);
    sections.push('');
  }

  // Progress evidence.
  if (progress.isInterrupted) {
    sections.push('## Interrupted work detected');
    sections.push('');
    sections.push('Uncommitted changes exist. Before continuing:');
    sections.push('1. Review the uncommitted work with the user.');
    sections.push('2. Decide whether to keep, complete, or discard each change.');
    sections.push('3. Do not perform destructive git operations without explicit confirmation.');
    sections.push('');

    const diffStat = filterHandoffDiffStat(snapshot.git.uncommitted.diffStat);
    if (diffStat) {
      sections.push(`Diff stat: ${diffStat}`);
      sections.push('');
    }

    if (progress.partial.length > 0) {
      sections.push('### Partially completed (evidence)');
      for (const p of progress.partial) {
        sections.push(`- ⚠ ${p.item} — ${p.evidence}`);
      }
      sections.push('');
    }
  }

  if (progress.remaining.length > 0) {
    sections.push('### Original task items to reconcile against current repository state');
    for (const r of progress.remaining) {
      sections.push(`- ${r.item}`);
    }
    sections.push('');
  }

  // Anti-repetition.
  if (progress.completed.length > 0) {
    sections.push('### Already completed — do not redo');
    for (const c of progress.completed) {
      sections.push(`- ${c.item}`);
    }
    sections.push('');
  }

  // Acceptance criteria (verbatim).
  if (snapshot.currentTask && snapshot.currentTask.acceptance_criteria.length > 0) {
    sections.push('## Acceptance requiring verification');
    for (const ac of snapshot.currentTask.acceptance_criteria) {
      sections.push(`- ${ac}`);
    }
    sections.push('');
  }

  // Stop conditions (verbatim).
  if (snapshot.currentTask && snapshot.currentTask.stop_conditions && snapshot.currentTask.stop_conditions.length > 0) {
    sections.push('## Stop conditions');
    for (const sc of snapshot.currentTask.stop_conditions) {
      sections.push(`- ${sc}`);
    }
    sections.push('');
  }

  // Memory context.
  if (snapshot.memory.currentPhase) {
    sections.push(`Current phase: ${snapshot.memory.currentPhase}`);
    sections.push('');
  }

  sections.push('Verify the evidence above before acting. Do not redo completed items.');

  return sections.join('\n').trim() + '\n';
}
