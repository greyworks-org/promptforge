import type { HandoffSnapshot } from '../handoff/snapshot';
import type { GitSnapshot } from './gitState';

/** Replace only live repository evidence; memory and TaskSpec remain intact. */
export function replaceLiveGitSnapshot(snapshot: HandoffSnapshot, git: GitSnapshot): HandoffSnapshot {
  return { ...snapshot, git };
}

export function repositoryFreshnessLabel(git: GitSnapshot): string {
  if (!git.isRepo) return 'Repository not detected';
  const branch = git.branch ? ` · ${git.branch}` : '';
  const head = git.head ? `HEAD ${git.head.hash.slice(0, 8)}` : 'HEAD unavailable';
  const changed = git.uncommitted.staged.length + git.uncommitted.unstaged.length + git.uncommitted.untracked.length;
  return `${head}${branch} · ${changed === 0 ? 'Clean' : `${changed} change${changed === 1 ? '' : 's'}`}`;
}
