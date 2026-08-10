import type { HandoffSnapshot } from './snapshot';
import { classifyProgress } from './progress';

export function renderHandoffCodex(snapshot: HandoffSnapshot): string {
  const progress = classifyProgress(snapshot);
  const sections: string[] = [];

  sections.push(`Use AGENTS.md as the repository instruction source.`);
  sections.push('');

  sections.push(`# Continue: ${snapshot.projectName}`);
  sections.push('');

  // Git state (always present when available).
  if (snapshot.git.isRepo) {
    if (snapshot.git.head) {
      sections.push(`Current HEAD: \`${snapshot.git.head.hash.slice(0, 8)}\` — ${snapshot.git.head.subject}`);
    }
    const changed = snapshot.git.uncommitted.staged.length + snapshot.git.uncommitted.unstaged.length;
    if (changed > 0) {
      sections.push(`${changed} file(s) modified in working tree:`);
      for (const f of [...snapshot.git.uncommitted.staged, ...snapshot.git.uncommitted.unstaged]) {
        sections.push(`- ${f}`);
      }
    }
    if (snapshot.git.uncommitted.diffStat) {
      sections.push(snapshot.git.uncommitted.diffStat);
    }
    sections.push('');
  } else {
    sections.push('(git unavailable — inspect the working tree manually.)');
    sections.push('');
  }

  // Memory context.
  if (snapshot.memory.currentPhase) {
    sections.push(`Phase: ${snapshot.memory.currentPhase}`);
    sections.push('');
  }

  // Current task.
  if (snapshot.currentTask) {
    const t = snapshot.currentTask;
    sections.push(`## Current task: ${t.task_id}`);
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
      sections.push('### Constraints');
      for (const sc of t.stop_conditions) sections.push(`- ${sc}`);
      sections.push('');
    }
  } else if (progress.remaining.length > 0 || progress.partial.length > 0) {
    // Progress evidence from git, even without formal task.
    sections.push('## Inferred work state (from git evidence)');
    sections.push('');
    if (progress.partial.length > 0) {
      sections.push('### Modified (partial)');
      for (const p of progress.partial) {
        sections.push(`- ⚠ ${p.item} — ${p.evidence}`);
      }
      sections.push('');
    }
    if (progress.remaining.length > 0) {
      sections.push('### No evidence of completion');
      for (const r of progress.remaining) sections.push(`- ${r.item}`);
      sections.push('');
    }
  }

  // Decisions.
  if (snapshot.memory.decisions.length > 0) {
    sections.push('## Decisions');
    for (const d of snapshot.memory.decisions) sections.push(`- ${d.text}`);
    sections.push('');
  }

  // Interrupted/uncommitted work.
  if (progress.isInterrupted) {
    sections.push('## Uncommitted changes');
    if (snapshot.git.uncommitted.diffStat) sections.push(snapshot.git.uncommitted.diffStat);
    sections.push('Review with the user before keeping or discarding.');
    sections.push('No destructive git operation without confirmation.');
    sections.push('');
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

  // Staleness.
  if (progress.memoryMayBeStale) {
    sections.push('## ⚠ Memory may be stale');
    sections.push(`Base commit: \`${snapshot.memory.baseCommit?.slice(0, 8)}\` vs HEAD: \`${snapshot.git.head?.hash.slice(0, 8)}\`.`);
    sections.push('');
  }

  sections.push('Complete the implementation, run validations, and report:');
  sections.push('- files changed');
  sections.push('- commands executed');
  sections.push('- test results');
  sections.push('- remaining risks');

  return sections.join('\n').trim() + '\n';
}
