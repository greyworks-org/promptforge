import { describe, expect, it } from 'vitest';
import type { HandoffSnapshot } from '../handoff/snapshot';
import { replaceLiveGitSnapshot, repositoryFreshnessLabel } from './projectFreshness';

const snapshot = {
  projectId: 'project-a', projectName: 'Project A', repoPath: '/tmp/project-a',
  memory: { projectId: 'project-a' } as HandoffSnapshot['memory'],
  git: {
    isRepo: true, head: { hash: '994ca4d3old', subject: 'old', committedAt: '2026-08-12T00:00:00Z' },
    uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' }, branch: 'main', diff: '',
  },
  currentTask: null, currentCompilation: null, assembledAt: '2026-08-13T00:00:00Z',
} as HandoffSnapshot;

describe('active project repository freshness', () => {
  it('replaces stale displayed HEAD and dirty state with the new repository snapshot', () => {
    const nextGit = {
      ...snapshot.git,
      head: { ...snapshot.git.head!, hash: 'ab12ef34new', subject: 'external change' },
      uncommitted: { staged: [], unstaged: ['src/App.tsx'], untracked: [], diffStat: 'src/App.tsx | 1 +' },
    };
    const refreshed = replaceLiveGitSnapshot(snapshot, nextGit);
    expect(refreshed.git.head?.hash).toBe('ab12ef34new');
    expect(refreshed.git.uncommitted.unstaged).toEqual(['src/App.tsx']);
    expect(refreshed.memory).toBe(snapshot.memory);
    expect(repositoryFreshnessLabel(refreshed.git)).toContain('HEAD ab12ef34');
    expect(repositoryFreshnessLabel(refreshed.git)).toContain('1 change');
  });
});
