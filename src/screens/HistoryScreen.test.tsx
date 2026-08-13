import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { HistoryScreen, type HistoryScreenProps } from './HistoryScreen';
import type { CompilationRecord } from '../db/repos/compilations';

const compilation: CompilationRecord = {
  id: 'comp-1', projectId: 'project-a', createdAt: '2026-08-13T10:00:00Z', rawRequest: 'Add the repository refresh.',
  taskType: 'feature', executionMode: 'standard', targetModel: 'luna', agentRuntime: 'codex', executionProfile: 'profile',
  profileVersion: '1.0.0', providerLabel: 'Luna', modelId: 'luna-api', contextDocIds: [], contextSent: '', blockingRounds: 0,
  taskspecJson: null, promptQwen: null, promptCodex: null, promptClaude: null, compilerPromptTokens: null,
  compilerCompletionTokens: null, compilerTokensEstimated: 0, finalPromptTokensEst: null, durationMs: null, status: 'done',
  error: null, recompileOf: null,
};

function deps(overrides: Partial<NonNullable<HistoryScreenProps['deps']>> = {}): NonNullable<HistoryScreenProps['deps']> {
  return {
    listHistory: vi.fn(async () => [compilation]),
    getOutcome: vi.fn(async () => null),
    saveOutcome: vi.fn(async () => undefined),
    getUsage: vi.fn(async () => ({ projectId: 'project-a', totalCompilations: 1, successCount: 1, partialCount: 0, failureCount: 0, totalCompilerPromptTokens: 0, totalCompilerCompletionTokens: 0, totalEstimatedTokens: 0, avgDurationMs: null })),
    getRuntimeUsage: vi.fn(async () => [{ agentRuntime: 'codex', count: 1 }]),
    ...overrides,
  };
}

afterEach(() => cleanup());

describe('HistoryScreen loading states', () => {
  it('settles on a loaded history result', async () => {
    render(<HistoryScreen projectId="project-a" deps={deps()} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(await screen.findByText('Add the repository refresh.')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('settles on a clear empty state', async () => {
    render(<HistoryScreen projectId="project-a" deps={deps({ listHistory: vi.fn(async () => []) })} />);
    expect(await screen.findByText('No compilations yet.')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('settles on an error with Retry after a failed load', async () => {
    const listHistory = vi.fn().mockRejectedValue(new Error('history read failed'));
    render(<HistoryScreen projectId="project-a" deps={deps({ listHistory })} />);
    expect(await screen.findByText('History could not be loaded.')).toBeTruthy();
    expect(screen.getByText('history read failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('reloads the newly active project instead of retaining the previous rows', async () => {
    const listHistory = vi.fn(async (projectId: string) => projectId === 'project-a' ? [compilation] : []);
    const injected = deps({ listHistory });
    const view = render(<HistoryScreen projectId="project-a" deps={injected} />);
    expect(await view.findByText('Add the repository refresh.')).toBeTruthy();
    view.rerender(<HistoryScreen projectId="project-b" deps={injected} />);
    expect(await view.findByText('No compilations yet.')).toBeTruthy();
    expect(screen.queryByText('Add the repository refresh.')).toBeNull();
    expect(listHistory).toHaveBeenLastCalledWith('project-b', 20, 0);
  });

  it('does not leave loading active when the dependency object has no optional functions', async () => {
    const minimal = deps({ getUsage: undefined, getRuntimeUsage: undefined, getOutcome: undefined });
    render(<HistoryScreen projectId="project-a" deps={minimal} />);
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
  });
});
