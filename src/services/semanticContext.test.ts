import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultProfile } from '../schemas/providerProfile';
import type { MemoryRecord, SemanticContextState } from '../db/repos/projectMemory';
import type { TaskSpec } from '../schemas/taskspec';
import type { GitSnapshot } from './gitState';

vi.mock('../ipc', () => ({ invokeIpc: vi.fn() }));
vi.mock('./memoryService', () => ({ updateMemory: vi.fn() }));
vi.mock('./settingsService', () => ({ loadProfile: vi.fn() }));
vi.mock('./projectFs', () => ({ readTextFile: vi.fn() }));
vi.mock('./contextService', () => ({ listContextDocs: vi.fn() }));

import { invokeIpc } from '../ipc';
import { updateMemory } from './memoryService';
import { loadProfile } from './settingsService';
import { readTextFile } from './projectFs';
import { listContextDocs } from './contextService';
import { refreshSemanticContextIfNeeded } from './semanticContext';

const mockInvoke = vi.mocked(invokeIpc);
const mockUpdateMemory = vi.mocked(updateMemory);
const mockLoadProfile = vi.mocked(loadProfile);
const mockReadTextFile = vi.mocked(readTextFile);
const mockListContextDocs = vi.mocked(listContextDocs);

const task = {
  task_id: 'TASK-2026-0042',
  task_type: 'feature',
  acceptance_criteria: ['The original venue filter requirement is verified'],
} as TaskSpec;

const baseMemory: MemoryRecord = {
  projectId: 'project-a',
  stack: ['TypeScript'],
  currentPhase: 'implementation',
  lastValidatedTaskId: null,
  currentTaskId: 'compilation-1',
  nextTask: null,
  decisions: [],
  blockers: [],
  relevantFiles: ['src/App.tsx'],
  lastTest: null,
  baseCommit: 'head-1',
  semanticContext: null,
  updatedAt: '2026-08-10T00:00:00Z',
};

const sourceGit: GitSnapshot = {
  isRepo: true,
  head: { hash: 'head-1', subject: 'baseline', committedAt: '2026-08-10T00:00:00Z' },
  uncommitted: { staged: [], unstaged: ['src/App.tsx'], untracked: [], diffStat: 'src/App.tsx | 2 +-' },
  branch: 'main',
  diff: 'diff --git a/src/App.tsx b/src/App.tsx\n@@ -1 +1 @@\n-old\n+new',
};

const cleanGit: GitSnapshot = {
  ...sourceGit,
  uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' },
  diff: '',
};

const semanticOutput = {
  observed_completed: ['Observed implemented: the App bridge now exposes the venue filter.'],
  observed_partial: ['Evidence suggests the asset-class UI still requires verification.'],
  acceptance_requiring_verification: ['Provider output must not replace the TaskSpec acceptance.'],
  changed_files: [{ path: 'src/App.tsx', description: 'Adds the filter state to the application bridge.' }],
  validation_evidence: ['A focused source diff exists in src/App.tsx.'],
  architecture_facts_observed: ['The change remains inside the existing React application bridge.'],
  blockers_observed: [],
  risks_observed: ['Automated test execution was not present in the supplied evidence.'],
  immediate_next_action: 'Verify the changed bridge behavior with the focused test plan.',
};

function providerResult(output = semanticOutput): { body: string } {
  return { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }) };
}

function input(git: GitSnapshot = sourceGit, memory: MemoryRecord = baseMemory) {
  return { projectId: 'project-a', repoPath: '/registered/project-a', memory, git, currentTask: task };
}

describe('live semantic context refresh', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockUpdateMemory.mockReset();
    mockLoadProfile.mockReset();
    mockReadTextFile.mockReset();
    mockListContextDocs.mockReset();
    mockLoadProfile.mockResolvedValue({ ...defaultProfile(), baseUrl: 'http://provider.test' });
    mockReadTextFile.mockResolvedValue('export const App = () => null;');
    mockListContextDocs.mockResolvedValue([]);
    mockUpdateMemory.mockImplementation(async (_projectId, patch) => ({ ...baseMemory, ...patch }));
    mockInvoke.mockResolvedValue(providerResult());
  });

  it('reuses an unchanged semantic snapshot without a provider call', async () => {
    const first = await refreshSemanticContextIfNeeded(input());
    mockInvoke.mockClear();
    const second = await refreshSemanticContextIfNeeded(input(sourceGit, first.memory));
    expect(second.state).toBe('reused');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('refreshes exactly once after an external source change changes the fingerprint', async () => {
    const first = await refreshSemanticContextIfNeeded(input());
    mockInvoke.mockClear();
    const changed = await refreshSemanticContextIfNeeded(input({
      ...sourceGit,
      head: { ...sourceGit.head!, hash: 'head-2' },
      diff: sourceGit.diff!.replace('new', 'newer'),
    }, first.memory));
    expect(changed.state).toBe('fresh');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('persists semantic meaning, changed-file descriptions, and task identity', async () => {
    const result = await refreshSemanticContextIfNeeded(input());
    const state = result.memory.semanticContext as SemanticContextState;
    expect(state.status).toBe('fresh');
    expect(state.snapshot?.project_id).toBe('project-a');
    expect(state.snapshot?.current_task_id).toBe(task.task_id);
    expect(state.snapshot?.changed_files[0]).toEqual(semanticOutput.changed_files[0]);
    expect(state.snapshot?.observed_completed[0]).toContain('App bridge');
  });

  it('keeps stale TaskSpec acceptance as verification and does not invent completion', async () => {
    const result = await refreshSemanticContextIfNeeded(input());
    const snapshot = result.memory.semanticContext!.snapshot!;
    expect(snapshot.acceptance_requiring_verification).toEqual(task.acceptance_criteria);
    expect(snapshot.observed_completed).not.toContain(task.scope?.[0]);
  });

  it('marks provider failure unavailable and does not retry the same fingerprint', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('provider unavailable'));
    const failed = await refreshSemanticContextIfNeeded(input());
    expect(failed.state).toBe('unavailable');
    expect(failed.memory.currentTaskId).toBe(baseMemory.currentTaskId);
    mockInvoke.mockClear();
    const reusedFailure = await refreshSemanticContextIfNeeded(input(sourceGit, failed.memory));
    expect(reusedFailure.state).toBe('unavailable');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('does not refresh for generated build changes alone', async () => {
    const first = await refreshSemanticContextIfNeeded(input(cleanGit));
    mockInvoke.mockClear();
    const generatedOnly = await refreshSemanticContextIfNeeded(input({
      ...cleanGit,
      uncommitted: { staged: [], unstaged: ['build/app.js'], untracked: [], diffStat: 'build/app.js | 1 +' },
      diff: 'diff --git a/build/app.js b/build/app.js\n+generated',
    }, first.memory));
    expect(generatedOnly.state).toBe('reused');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('reuses the persisted snapshot after a simulated app restart', async () => {
    const saved = await refreshSemanticContextIfNeeded(input());
    mockInvoke.mockClear();
    const restartedMemory = JSON.parse(JSON.stringify(saved.memory)) as MemoryRecord;
    const afterRestart = await refreshSemanticContextIfNeeded(input(sourceGit, restartedMemory));
    expect(afterRestart.state).toBe('reused');
    expect(afterRestart.memory.semanticContext?.snapshot?.current_task_id).toBe(task.task_id);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
