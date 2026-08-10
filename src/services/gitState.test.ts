import { describe, expect, it, vi } from 'vitest';

vi.mock('../ipc', () => ({ invokeIpc: vi.fn() }));
vi.mock('./projectFs', () => ({ resolveProjectRoot: vi.fn() }));

import { invokeIpc } from '../ipc';
import { resolveProjectRoot } from './projectFs';
import { getGitSnapshot } from './gitState';

describe('git semantic range evidence', () => {
  it('passes the stored semantic HEAD as the comparison point', async () => {
    vi.mocked(resolveProjectRoot).mockResolvedValue('/registered/project');
    vi.mocked(invokeIpc).mockResolvedValue({
      isRepo: true,
      head: { hash: 'head-b', subject: 'external commit', committedAt: '2026-08-10T00:00:00Z' },
      staged: [],
      unstaged: [],
      untracked: [],
      diffStat: '',
      diff: 'diff --git a/src/Changed.ts b/src/Changed.ts',
      branch: 'main',
    });

    const snapshot = await getGitSnapshot('project-a', 'head-a');
    expect(snapshot.diff).toContain('src/Changed.ts');
    expect(vi.mocked(invokeIpc)).toHaveBeenCalledWith('git_inspect', {
      repoPath: '/registered/project',
      baseCommit: 'head-a',
    });
  });
});
