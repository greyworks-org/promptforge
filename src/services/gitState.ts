import { invokeIpc } from '../ipc';

/**
 * Git state inspection (Phase 9).
 *
 * Reads live git metadata through the allowlisted `git_inspect` Rust
 * command. Results are derived live on every call — never cached as
 * truth. Non-git folders degrade gracefully to `isRepo: false`.
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
  branch: string | null;
}

interface GitInspectResult {
  isRepo: boolean;
  head: { hash: string; subject: string; committedAt: string } | null;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  diffStat: string;
  branch: string | null;
}

/**
 * Get the live git snapshot for a project root. Computed on every
 * call — never served from cache. Non-git folders return `isRepo: false`.
 */
export async function getGitSnapshot(repoPath: string): Promise<GitSnapshot> {
  try {
    const raw = await invokeIpc<GitInspectResult>('git_inspect', { repoPath });
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
    };
  } catch {
    return {
      isRepo: false,
      head: null,
      uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' },
      branch: null,
    };
  }
}
