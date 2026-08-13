import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPipeline } from './pipeline';
import { defaultProfile } from '../schemas/providerProfile';
import { invokeIpc } from '../ipc';

vi.mock('../ipc', () => ({ invokeIpc: vi.fn() }));

const output = {
  task_type: 'bugfix', execution_mode: 'quick', target_model: 'configured-model',
  agent_runtime: 'claude-code', execution_profile: 'deepseek-v4-pro-claude-code',
  objective: 'Fix the deterministic selection path.', scope: ['Change the compiler selection.'],
  acceptance_criteria: ['The selected provider receives the request.'], risk_level: 'low',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invokeIpc).mockResolvedValue({
    status: 200, latencyMs: 1,
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }),
  });
});

describe('compiler model selection', () => {
  it('uses the selected configured profile in the provider transport', async () => {
    const profile = {
      ...defaultProfile(), providerId: 'qwen', label: 'Qwen profile',
      baseUrl: 'https://qwen.example/v1', modelId: 'qwen-configured-id',
    };
    const result = await runPipeline({
      profile, projectId: 'project-models', rawRequest: 'Fix the selection.',
      executionMode: 'quick', contextDocs: [],
    });
    expect(result.status).toBe('done');
    expect(invokeIpc).toHaveBeenCalledWith('provider_chat', expect.objectContaining({
      baseUrl: 'https://qwen.example/v1', modelId: 'qwen-configured-id', keychainAccount: 'provider/default',
    }));
  });
});
