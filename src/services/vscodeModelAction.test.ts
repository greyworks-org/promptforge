import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invokeIpc: vi.fn(),
  getExecutionSessionView: vi.fn(),
  launchExecutionSessionThroughOpenCode: vi.fn(),
  saveSessionCheckpoint: vi.fn(),
  switchSessionModel: vi.fn(),
  getOpenCodeModelDiscovery: vi.fn(),
}));

vi.mock('../ipc', () => ({ invokeIpc: mocks.invokeIpc }));
vi.mock('../sessions/executionSessionService', () => ({
  getExecutionSessionView: mocks.getExecutionSessionView,
  launchExecutionSessionThroughOpenCode: mocks.launchExecutionSessionThroughOpenCode,
  saveSessionCheckpoint: mocks.saveSessionCheckpoint,
  switchSessionModel: mocks.switchSessionModel,
}));
vi.mock('../handoff/crossModelService', () => ({ confirmHandoffPreview: vi.fn(), prepareHandoffPreview: vi.fn() }));
vi.mock('./opencodeModels', () => ({
  openCodeModelSchema: { parse: (value: unknown) => value },
  getOpenCodeModelDiscovery: mocks.getOpenCodeModelDiscovery,
}));

import { processVscodeSessionAction } from './vscodeIntegration';

const view = {
  session: {
    id: 'session-1', projectId: 'project-1', runtime: 'claude-code',
    binding: { providerId: 'openai', modelId: 'luna-id', modelRef: 'openai/luna-runtime', variant: null, detectedVersion: null },
  },
  events: [], changedFiles: [], task: { id: 'TASK-1', objective: 'Keep the same task.' },
  progress: { completed: [], pending: [], lastAction: null },
  context: { status: 'fresh', checkpoint: 'same checkpoint' }, projectContextDocuments: [],
  completion: 'active', controls: { canStart: false, canResume: false, canCheckpoint: true },
};

describe('VS Code model control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getExecutionSessionView.mockResolvedValue(view);
    let taken = false;
    mocks.invokeIpc.mockImplementation(async (command: string) => {
      if (command === 'vscode_take_session_action') {
        if (taken) return null;
        taken = true;
        return {
          id: 'action-1', projectId: 'project-1', sessionId: 'session-1', action: 'model', note: null,
          payload: { providerId: 'qwen', modelId: 'configured-qwen-id', modelRef: 'qwen/configured-qwen-runtime' },
        };
      }
      return undefined;
    });
  });

  it('routes a VS Code model action to the shared PromptForge session binding', async () => {
    await processVscodeSessionAction();
    expect(mocks.switchSessionModel).toHaveBeenCalledWith('project-1', 'session-1', {
      providerId: 'qwen', modelId: 'configured-qwen-id', modelRef: 'qwen/configured-qwen-runtime',
    });
    expect(mocks.invokeIpc).toHaveBeenCalledWith('vscode_complete_session_action', expect.objectContaining({
      actionId: 'action-1', success: true, message: 'PromptForge session model switched.',
    }));
  });
});
