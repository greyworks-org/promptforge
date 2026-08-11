import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeIpc } from '../ipc';
import { resolveProjectRoot } from './projectFs';
import { getOpenCodeModelDiscovery } from './opencodeModels';

vi.mock('../ipc', () => ({ invokeIpc: vi.fn() }));
vi.mock('./projectFs', () => ({ resolveProjectRoot: vi.fn() }));

const model = {
  runtime: 'opencode' as const,
  providerId: 'openrouter',
  modelId: 'deepseek/deepseek-v4-pro',
  modelRef: 'openrouter/deepseek/deepseek-v4-pro',
  displayName: 'OpenRouter DeepSeek V4 Pro',
  available: true,
  configured: true,
  availability: 'available' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveProjectRoot).mockResolvedValue('/registered/project');
});

describe('OpenCode model capability read model', () => {
  it('retrieves sanitized provider/model state through the Rust boundary', async () => {
    vi.mocked(invokeIpc).mockResolvedValue({
      runtime: 'opencode',
      models: [model],
      source: 'opencode-cli',
      warning: null,
    });

    const discovery = await getOpenCodeModelDiscovery('project-a');

    expect(resolveProjectRoot).toHaveBeenCalledWith('project-a');
    expect(invokeIpc).toHaveBeenCalledWith('opencode_models', { projectRoot: '/registered/project' });
    expect(discovery.models[0]).toEqual(model);
  });

  it('keeps a persisted selection visible when the external catalog is unavailable', async () => {
    vi.mocked(invokeIpc).mockResolvedValue({
      runtime: 'opencode',
      models: [],
      source: 'unavailable',
      warning: 'OpenCode model enumeration was unavailable.',
    });

    const discovery = await getOpenCodeModelDiscovery('project-a', 'openrouter/deepseek/deepseek-v4-pro');

    expect(discovery.models).toHaveLength(1);
    expect(discovery.models[0]).toMatchObject({
      modelRef: 'openrouter/deepseek/deepseek-v4-pro',
      providerId: 'openrouter',
      availability: 'unknown',
      configured: false,
    });
  });

  it('rejects an unstructured OpenCode response at the boundary', async () => {
    vi.mocked(invokeIpc).mockResolvedValue({ runtime: 'opencode', models: [{ modelRef: 'not-enough' }] });

    await expect(getOpenCodeModelDiscovery('project-a')).rejects.toThrow();
  });
});

