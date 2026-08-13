import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getMemory: vi.fn(),
  getGitSnapshot: vi.fn(),
  getCompilationForProject: vi.fn(),
  getProject: vi.fn(),
  refreshSemanticContextIfNeeded: vi.fn(),
  inspectProjectGuidance: vi.fn(),
  listContextDocs: vi.fn(),
  renderHandoffClaudeCode: vi.fn(),
  renderHandoffQwenCode: vi.fn(),
  renderHandoffCodex: vi.fn(),
  ensureExecutionSession: vi.fn(),
}));

vi.mock('../services/memoryService', () => ({ getMemory: mocks.getMemory }));
vi.mock('../services/gitState', () => ({ getGitSnapshot: mocks.getGitSnapshot }));
vi.mock('../services/historyService', () => ({ getCompilationForProject: mocks.getCompilationForProject }));
vi.mock('../services/projectsService', () => ({ getProject: mocks.getProject }));
vi.mock('../services/semanticContext', () => ({ refreshSemanticContextIfNeeded: mocks.refreshSemanticContextIfNeeded }));
vi.mock('../services/projectGuidance', () => ({ inspectProjectGuidance: mocks.inspectProjectGuidance }));
vi.mock('../services/contextService', () => ({ listContextDocs: mocks.listContextDocs }));
vi.mock('../handoff/renderClaudeCode', () => ({ renderHandoffClaudeCode: mocks.renderHandoffClaudeCode }));
vi.mock('../handoff/renderQwenCode', () => ({ renderHandoffQwenCode: mocks.renderHandoffQwenCode }));
vi.mock('../handoff/renderCodex', () => ({ renderHandoffCodex: mocks.renderHandoffCodex }));
vi.mock('../sessions/executionSessionService', () => ({ ensureExecutionSession: mocks.ensureExecutionSession }));

import { HandoffView } from './HandoffView';

const memory = {
  projectId: 'project-a', stack: [], currentPhase: null, lastValidatedTaskId: null, currentTaskId: null,
  nextTask: null, decisions: [], blockers: [], relevantFiles: [], lastTest: null, baseCommit: null,
  semanticContext: null, updatedAt: '2026-08-13T00:00:00Z',
};

function git(hash: string) {
  return { isRepo: true, head: { hash, subject: 'external change', committedAt: '2026-08-13T00:00:00Z' }, uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' }, branch: 'main', diff: '' };
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getProject.mockResolvedValue({ id: 'project-a', repoPath: '/tmp/project-a' });
  mocks.getMemory.mockResolvedValue(memory);
  mocks.getCompilationForProject.mockResolvedValue(null);
  mocks.refreshSemanticContextIfNeeded.mockResolvedValue({ memory, state: 'unavailable' });
  mocks.inspectProjectGuidance.mockResolvedValue([]);
  mocks.listContextDocs.mockResolvedValue([]);
  mocks.renderHandoffCodex.mockImplementation((snapshot: { git: { head: { hash: string } } }) => `prompt ${snapshot.git.head.hash}`);
  mocks.renderHandoffClaudeCode.mockImplementation(() => 'claude prompt');
  mocks.renderHandoffQwenCode.mockImplementation(() => 'qwen prompt');
});

afterEach(() => cleanup());

describe('Continue repository freshness', () => {
  it('refreshes active project state when the window regains focus', async () => {
    mocks.getGitSnapshot.mockResolvedValueOnce(git('994ca4d3old')).mockResolvedValue(git('ab12ef34new'));
    render(<HandoffView projectId="project-a" projectName="Project A" onClose={vi.fn()} />);
    expect(await screen.findByText(/HEAD 994ca4d3/)).toBeTruthy();
    await screen.findByText('No project context documents configured');

    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(mocks.getGitSnapshot).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/HEAD ab12ef34/)).toBeTruthy();
  });

  it('distinguishes no configured context documents from a context-loading error', async () => {
    mocks.getGitSnapshot.mockResolvedValue(git('994ca4d3old'));
    mocks.listContextDocs.mockRejectedValue(new Error('context registry unavailable'));
    render(<HandoffView projectId="project-a" projectName="Project A" onClose={vi.fn()} />);
    expect(await screen.findByText('Project context could not be loaded')).toBeTruthy();
    expect(screen.queryByText(/semantic context unavailable/i)).toBeNull();
  });
});
