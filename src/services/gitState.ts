import { invokeIpc } from '../ipc';
import { resolveProjectRoot } from './projectFs';

/**
 * Git state inspection (Phase 9, trust-boundary hardened).
 *
 * Accepts `projectId` and resolves the canonical root from the Rust
 * project registry — the frontend cannot supply an arbitrary path.
 * Results are derived live on every call, never cached as truth.
 */

export interface GitSnapshot {
  isRepo: boolean;
  head: { hash: string; subject: string; committedAt: string } | null;
  uncommitted: {
    staged: string[];
    unstaged: string[];
    untracked: string[];
    diffStat: string;
  };
  /** Bounded tracked-file diff for semantic refresh; never used as authority. */
  diff?: string;
  branch: string | null;
}

interface GitInspectResult {
  isRepo: boolean;
  head: { hash: string; subject: string; committedAt: string } | null;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  diffStat: string;
  diff?: string;
  branch: string | null;
}

export async function getGitSnapshot(projectId: string): Promise<GitSnapshot> {
  try {
    const root = await resolveProjectRoot(projectId);
    const raw = await invokeIpc<GitInspectResult>('git_inspect', { repoPath: root });
    return {
      isRepo: raw.isRepo,
      head: raw.head,
      uncommitted: {
        staged: raw.staged ?? [],
        unstaged: raw.unstaged ?? [],
        untracked: raw.untracked ?? [],
        diffStat: raw.diffStat ?? '',
      },
      branch: raw.branch,
      diff: raw.diff ?? '',
    };
  } catch {
    return {
      isRepo: false,
      head: null,
      uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' },
      branch: null,
      diff: '',
    };
  }
}
