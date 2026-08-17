import type { TaskSpec } from '../schemas/taskspec';
import type { GitSnapshot } from '../services/gitState';

/**
 * WIP task-spec reconciliation.
 *
 * Handoff rendering is deterministic and model-free. When the live working
 * tree (uncommitted changes or commits newer than the last observed HEAD)
 * diverges from the archived TaskSpec vocabulary, continuation prompts must
 * not blindly dictate the stale objective. This layer derives the live
 * work-in-progress focus and completion items purely from Git evidence.
 */

export type WipMode = 'auto' | 'adopt-wip' | 'preserve-task';

export interface WipCommit {
  hash: string;
  subject: string;
}

export interface WipEvidence {
  uncommittedFiles: string[];
  newCommits: WipCommit[];
}

export interface WipAlignment {
  /** Effective continuation mode after reconciliation. */
  mode: 'adopt-wip' | 'preserve-task';
  /** True when the live evidence vocabulary diverged from the archived TaskSpec. */
  driftDetected: boolean;
  /** Token overlap ratio (0..1) between WIP evidence and the archived task. */
  overlapRatio: number;
  /** Deterministically derived live focus; null when no live evidence exists. */
  objective: string | null;
  /** Bounded evidence lines (files and commits) backing the decision. */
  evidence: string[];
  /** Completion/verification items focused on the live diff. */
  actionItems: string[];
}

export interface WipReconciliationInput {
  task: TaskSpec | null;
  git: GitSnapshot;
  /** Already filtered (handoff-safe) changed paths. */
  changedFiles: string[];
  /** Last session/semantic HEAD observed by PromptForge, if any. */
  observedHead: string | null;
  /** Selection mode; defaults to 'auto'. */
  mode?: WipMode;
}

/** Below this evidence/task vocabulary overlap the live work is considered divergent. */
export const WIP_DRIFT_THRESHOLD = 0.25;
const MIN_TOKEN_LENGTH = 4;
const MAX_OBJECTIVE_SUBJECTS = 3;
const MAX_OBJECTIVE_FILES = 5;
const MAX_EVIDENCE_COMMITS = 5;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

export function taskVocabulary(task: TaskSpec): Set<string> {
  const text = [
    task.objective,
    ...task.scope,
    ...task.acceptance_criteria,
    ...task.requirements.functional,
  ].join(' ');
  return new Set(tokenize(text));
}

export function evidenceVocabulary(evidence: WipEvidence): Set<string> {
  const text = [
    ...evidence.uncommittedFiles,
    ...evidence.newCommits.map((commit) => commit.subject),
  ].join(' ');
  return new Set(tokenize(text));
}

/** Shared-token ratio relative to the evidence vocabulary; 1 when evidence is empty. */
export function overlapRatio(taskTokens: Set<string>, evidenceTokens: Set<string>): number {
  if (evidenceTokens.size === 0) return 1;
  let shared = 0;
  for (const token of evidenceTokens) {
    if (taskTokens.has(token)) shared += 1;
  }
  return shared / evidenceTokens.size;
}

/**
 * Commits in `git.recentCommits` (newest first) that postdate the observed
 * HEAD. When the observed HEAD is unknown or absent within the bounded
 * window, the live HEAD decides: all listed commits count as new unless the
 * live HEAD equals the observed HEAD.
 */
export function commitsAfterObservedHead(git: GitSnapshot, observedHead: string | null): WipCommit[] {
  const commits = git.recentCommits ?? [];
  if (observedHead === null) return commits;
  if (git.head !== null && git.head.hash === observedHead) return [];
  const index = commits.findIndex(
    (commit) => commit.hash === observedHead
      || commit.hash.startsWith(observedHead)
      || observedHead.startsWith(commit.hash),
  );
  return index === -1 ? commits : commits.slice(0, index);
}

export function collectWipEvidence(git: GitSnapshot, changedFiles: string[], observedHead: string | null): WipEvidence {
  return {
    uncommittedFiles: changedFiles,
    newCommits: commitsAfterObservedHead(git, observedHead),
  };
}

function deriveObjective(evidence: WipEvidence): string {
  if (evidence.newCommits.length > 0) {
    const subjects = evidence.newCommits.slice(0, MAX_OBJECTIVE_SUBJECTS).map((commit) => commit.subject);
    const extra = evidence.newCommits.length - subjects.length;
    const suffix = evidence.uncommittedFiles.length > 0
      ? `, with uncommitted changes in ${evidence.uncommittedFiles.slice(0, MAX_OBJECTIVE_FILES).join(', ')}`
      : '';
    return `Complete and verify the live in-progress work: ${subjects.join('; ')}${extra > 0 ? ` (+${extra} earlier commits)` : ''}${suffix}`;
  }
  return `Complete and verify the uncommitted changes: ${evidence.uncommittedFiles.slice(0, MAX_OBJECTIVE_FILES).join(', ')}`;
}

function deriveEvidenceLines(evidence: WipEvidence): string[] {
  const lines: string[] = [];
  if (evidence.uncommittedFiles.length > 0) {
    lines.push(`uncommitted: ${evidence.uncommittedFiles.join(', ')}`);
  }
  for (const commit of evidence.newCommits.slice(0, MAX_EVIDENCE_COMMITS)) {
    lines.push(`commit ${commit.hash.slice(0, 8)} — ${commit.subject}`);
  }
  if (evidence.newCommits.length > MAX_EVIDENCE_COMMITS) {
    lines.push(`(+${evidence.newCommits.length - MAX_EVIDENCE_COMMITS} earlier commits)`);
  }
  return lines;
}

function deriveActionItems(evidence: WipEvidence, task: TaskSpec | null): string[] {
  const items: string[] = [];
  if (evidence.uncommittedFiles.length > 0) {
    items.push(`Finish or explicitly park the uncommitted changes: ${evidence.uncommittedFiles.slice(0, MAX_OBJECTIVE_FILES).join(', ')}`);
  }
  if (evidence.newCommits.length > 0) {
    items.push(`Review and verify the new commits against the live intent: ${evidence.newCommits.slice(0, MAX_OBJECTIVE_SUBJECTS).map((commit) => commit.subject).join('; ')}`);
  }
  items.push('Run the project\'s applicable test and validation commands for the in-progress work and report real results.');
  if (task !== null) {
    items.push(`Do not start archived TaskSpec work (${task.task_id}) until the live work-in-progress is finished, parked, or confirmed unrelated.`);
  }
  return items;
}

/**
 * Deterministically reconciles the archived TaskSpec with live repository
 * evidence. No model calls; derivation depends only on the supplied inputs.
 */
export function deriveWipAlignment(input: WipReconciliationInput): WipAlignment {
  const mode = input.mode ?? 'auto';
  const evidence = collectWipEvidence(input.git, input.changedFiles, input.observedHead);
  const hasEvidence = evidence.uncommittedFiles.length > 0 || evidence.newCommits.length > 0;

  if (input.task === null || !hasEvidence) {
    return {
      mode: 'preserve-task',
      driftDetected: false,
      overlapRatio: 1,
      objective: null,
      evidence: deriveEvidenceLines(evidence),
      actionItems: [],
    };
  }

  const ratio = overlapRatio(taskVocabulary(input.task), evidenceVocabulary(evidence));
  const driftDetected = ratio < WIP_DRIFT_THRESHOLD;
  const adopt = mode === 'adopt-wip' ? true : mode === 'preserve-task' ? false : driftDetected;

  return {
    mode: adopt ? 'adopt-wip' : 'preserve-task',
    driftDetected,
    overlapRatio: Math.round(ratio * 100) / 100,
    objective: adopt ? deriveObjective(evidence) : null,
    evidence: deriveEvidenceLines(evidence),
    actionItems: adopt ? deriveActionItems(evidence, input.task) : [],
  };
}
