import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsScreen, type SettingsScreenProps } from './SettingsScreen';
import type { ConnectionTestResult } from '../services/providerService';
import { defaultProfile, type ProviderProfile } from '../schemas/providerProfile';

function makeDeps(overrides: Partial<NonNullable<SettingsScreenProps['deps']>> = {}) {
  return {
    loadProfile: vi.fn(async () => null),
    saveProfile: vi.fn(async (p: ProviderProfile) => p),
    saveApiKey: vi.fn(async () => undefined),
    deleteApiKey: vi.fn(async () => true),
    hasApiKey: vi.fn(async () => false),
    testConnection: vi.fn(async () => successResult()),
    ...overrides,
  };
}

function successResult(): ConnectionTestResult {
  return {
    ok: true,
    reachable: true,
    authAccepted: true,
    modelAnswered: true,
    contentIsJson: true,
    jsonModeRequested: false,
    usagePresent: true,
    latencyMs: 42,
    errorClass: null,
    message: 'Connection successful.',
  };
}

function providerProfile(providerId: 'openai' | 'qwen' | 'deepseek', overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    ...defaultProfile(),
    id: providerId === 'openai' ? 'default' : `${providerId}-primary`,
    label: `${providerId} profile`,
    providerId,
    baseUrl: `https://${providerId}.example.com/v1`,
    modelId: `${providerId}-model`,
    runtimeModelRef: `${providerId}/${providerId}-model`,
    ...overrides,
  };
}

function makeProfileStore(profiles: ProviderProfile[]) {
  let stored = [...profiles];
  return makeDeps({
    loadProfile: vi.fn(async () => stored[0] ?? null),
    listProfiles: vi.fn(async () => stored),
    saveProfile: vi.fn(async (profile: ProviderProfile) => {
      stored = [...stored.filter((candidate) => candidate.id !== profile.id), profile];
      return profile;
    }),
  });
}

async function settleAsyncEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}

async function selectCatalogModel(modelId: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(modelId === 'qwen-3.8-max' ? 'Qwen 3.8 Max' : 'DeepSeek V4 Flash') }));
  await waitFor(() => expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe(modelId));
}

async function fillValidForm() {
  fireEvent.change(await screen.findByLabelText('Base URL'), {
    target: { value: 'http://localhost:4141' },
  });
  fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'test-model' } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SettingsScreen', () => {
  it('shows the known provider identity for a legacy Luna profile', async () => {
    const profile: ProviderProfile = {
      ...defaultProfile(),
      label: 'OpenAI GPT 5.6 Luna',
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-5.6-luna',
    };
    render(<SettingsScreen deps={makeDeps({ loadProfile: vi.fn(async () => profile), listProfiles: vi.fn(async () => [profile]) })} />);
    expect((await screen.findByLabelText('Provider identity') as HTMLSelectElement).value).toBe('openai');
    expect(screen.getAllByText('Luna 5.6 High').length).toBeGreaterThan(0);
    expect(screen.queryByText('Choose a provider')).toBeNull();
  });

  it('renders the provider form', async () => {
    render(<SettingsScreen deps={makeDeps()} />);
    expect(await screen.findByLabelText('Base URL')).toBeTruthy();
    expect(screen.getByLabelText('Model ID')).toBeTruthy();
    expect(screen.getByLabelText('API key')).toBeTruthy();
    expect(screen.getByLabelText('JSON response mode')).toBeTruthy();
  });

  it('shows validation errors and does not save an invalid base URL', async () => {
    const deps = makeDeps();
    render(<SettingsScreen deps={deps} />);
    fireEvent.change(await screen.findByLabelText('Base URL'), {
      target: { value: 'http://remote.example.com' },
    });
    fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(deps.saveProfile).not.toHaveBeenCalled();
  });

  it('saves profile and key, then clears the key input', async () => {
    const deps = makeDeps({ hasApiKey: vi.fn(async () => true) });
    render(<SettingsScreen deps={deps} />);
    await fillValidForm();
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-test-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(deps.saveProfile).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(deps.saveApiKey).toHaveBeenCalledWith('default', 'sk-test-123'),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe(''),
    );
    await waitFor(() => expect(screen.getByText(/Key is stored in the Keychain/)).toBeTruthy());
  });

  it('does not call saveApiKey when the key field is empty', async () => {
    const deps = makeDeps({ hasApiKey: vi.fn(async () => true) });
    render(<SettingsScreen deps={deps} />);
    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(deps.saveProfile).toHaveBeenCalledTimes(1));
    expect(deps.saveApiKey).not.toHaveBeenCalled();
  });

  it('shows the delete-key action only when a key is stored', async () => {
    const deps = makeDeps({ hasApiKey: vi.fn(async () => true) });
    render(<SettingsScreen deps={deps} />);
    const button = await screen.findByRole('button', { name: 'Delete key' });
    fireEvent.click(button);
    await waitFor(() => expect(deps.deleteApiKey).toHaveBeenCalledWith('default'));
  });

  it('shows a loading state while testing, then the success panel', async () => {
    let resolveTest: (r: ConnectionTestResult) => void = () => {};
    const pending = new Promise<ConnectionTestResult>((res) => {
      resolveTest = res;
    });
    const deps = makeDeps({ testConnection: vi.fn(() => pending) });
    render(<SettingsScreen deps={deps} />);
    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(await screen.findByText('Testing…')).toBeTruthy();
    resolveTest(successResult());
    expect(await screen.findByText('Connection successful.')).toBeTruthy();
    expect(screen.getByText('✓ Endpoint reachable')).toBeTruthy();
    expect(screen.getByText('✓ Authentication accepted')).toBeTruthy();
    expect(screen.getByText('Latency: 42 ms')).toBeTruthy();
  });

  it('shows the failure panel for an auth rejection', async () => {
    const deps = makeDeps({
      testConnection: vi.fn(async () => ({
        ...successResult(),
        ok: false,
        reachable: false,
        authAccepted: false,
        modelAnswered: false,
        contentIsJson: false,
        usagePresent: null,
        latencyMs: null,
        errorClass: 'auth' as const,
        message: 'API key rejected — check Settings.',
      })),
    });
    render(<SettingsScreen deps={deps} />);
    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('✗ Authentication rejected')).toBeTruthy();
    expect(screen.getByText('Error class: auth')).toBeTruthy();
  });

  it('blocks the test when the model ID is missing', async () => {
    const deps = makeDeps();
    render(<SettingsScreen deps={deps} />);
    fireEvent.change(await screen.findByLabelText('Base URL'), {
      target: { value: 'http://localhost:4141' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(deps.testConnection).not.toHaveBeenCalled();
  });

  it('renders the saved Luna profile on initial load', async () => {
    const luna = providerProfile('openai', { modelId: 'luna-api-model', runtimeModelRef: 'openai/luna-api-model' });
    render(<SettingsScreen deps={makeProfileStore([luna])} />);

    expect(((await screen.findAllByRole('combobox'))[1] as HTMLSelectElement).value).toBe('luna-5.6-high');
    expect((screen.getByLabelText('Provider identity') as HTMLSelectElement).value).toBe('openai');
    expect((screen.getByLabelText('Model ID') as HTMLInputElement).value).toBe('luna-api-model');
  });

  it('keeps Qwen selected after async effects settle', async () => {
    const deps = makeProfileStore([providerProfile('openai')]);
    render(<SettingsScreen deps={deps} />);
    await screen.findByLabelText('Base URL');

    await selectCatalogModel('qwen-3.8-max');
    await settleAsyncEffects();

    expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('qwen-3.8-max');
    expect((screen.getByLabelText('Provider identity') as HTMLSelectElement).value).toBe('qwen');
    expect(screen.getByText('Qwen 3.8 Max · setup required')).toBeTruthy();
  });

  it('keeps DeepSeek selected after async effects settle', async () => {
    const deps = makeProfileStore([providerProfile('openai')]);
    render(<SettingsScreen deps={deps} />);
    await screen.findByLabelText('Base URL');

    await selectCatalogModel('deepseek-v4-flash');
    await settleAsyncEffects();

    expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('deepseek-v4-flash');
    expect((screen.getByLabelText('Provider identity') as HTMLSelectElement).value).toBe('deepseek');
    expect(screen.getByText('DeepSeek V4 Flash · setup required')).toBeTruthy();
  });

  it('saves Qwen and remains on Qwen', async () => {
    const deps = makeProfileStore([providerProfile('openai')]);
    render(<SettingsScreen deps={deps} />);
    await screen.findByLabelText('Base URL');
    await selectCatalogModel('qwen-3.8-max');
    await fillValidForm();
    fireEvent.change(screen.getByPlaceholderText('provider/configured-model-id'), { target: { value: 'qwen/qwen-saved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(deps.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 'qwen-primary', providerId: 'qwen', runtimeModelRef: 'qwen/qwen-saved' })));
    expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('qwen-3.8-max');
    expect((screen.getByLabelText('Provider identity') as HTMLSelectElement).value).toBe('qwen');
  });

  it('saves DeepSeek and remains on DeepSeek', async () => {
    const deps = makeProfileStore([providerProfile('openai')]);
    render(<SettingsScreen deps={deps} />);
    await screen.findByLabelText('Base URL');
    await selectCatalogModel('deepseek-v4-flash');
    await fillValidForm();
    fireEvent.change(screen.getByPlaceholderText('provider/configured-model-id'), { target: { value: 'deepseek/deepseek-saved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(deps.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 'deepseek-primary', providerId: 'deepseek', runtimeModelRef: 'deepseek/deepseek-saved' })));
    expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('deepseek-v4-flash');
    expect((screen.getByLabelText('Provider identity') as HTMLSelectElement).value).toBe('deepseek');
  });

  it('restores independent Luna and Qwen values across switches', async () => {
    const luna = providerProfile('openai', { baseUrl: 'https://luna.example.com/v1', modelId: 'luna-model', runtimeModelRef: 'openai/luna-model' });
    const deps = makeProfileStore([luna]);
    render(<SettingsScreen deps={deps} />);
    await screen.findByLabelText('Base URL');
    await selectCatalogModel('qwen-3.8-max');
    await fillValidForm();
    fireEvent.change(screen.getByPlaceholderText('provider/configured-model-id'), { target: { value: 'qwen/qwen-independent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(deps.saveProfile).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /Luna 5\.6 High/ }));
    await waitFor(() => expect((screen.getByLabelText('Model ID') as HTMLInputElement).value).toBe('luna-model'));
    fireEvent.click(screen.getByRole('button', { name: /Qwen 3\.8 Max/ }));
    await waitFor(() => expect((screen.getByLabelText('Model ID') as HTMLInputElement).value).toBe('test-model'));
    expect((screen.getByPlaceholderText('provider/configured-model-id') as HTMLInputElement).value).toBe('qwen/qwen-independent');
  });

  it('updates Setup required and Configured status for a saved provider', async () => {
    const deps = makeProfileStore([providerProfile('openai')]);
    render(<SettingsScreen deps={deps} />);
    await screen.findByLabelText('Base URL');
    expect(screen.getByRole('button', { name: /Qwen 3\.8 Max.*Setup required/ })).toBeTruthy();
    await selectCatalogModel('qwen-3.8-max');
    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Qwen 3\.8 Max.*Configured/ })).toBeTruthy());
  });

  it('looks up Keychain state using the selected profile ID', async () => {
    const deps = makeProfileStore([providerProfile('openai')]);
    deps.hasApiKey = vi.fn(async (id: string) => id === 'qwen-primary');
    render(<SettingsScreen deps={deps} />);
    await screen.findByLabelText('Base URL');
    await selectCatalogModel('qwen-3.8-max');
    await waitFor(() => expect(deps.hasApiKey).toHaveBeenLastCalledWith('qwen-primary'));
    expect(screen.getByText('Key is stored in the Keychain.')).toBeTruthy();
  });

  it('tests the currently selected provider profile', async () => {
    const deps = makeProfileStore([providerProfile('openai'), providerProfile('qwen')]);
    render(<SettingsScreen deps={deps} />);
    await screen.findByLabelText('Base URL');
    await selectCatalogModel('qwen-3.8-max');
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    await waitFor(() => expect(deps.testConnection).toHaveBeenCalledWith(expect.objectContaining({
      id: 'qwen-primary',
      providerId: 'qwen',
    })));
  });

  it('preserves independent OpenCode model references per provider', async () => {
    const profiles = [
      providerProfile('openai', { runtimeModelRef: 'openai/luna-ref' }),
      providerProfile('qwen', { runtimeModelRef: 'qwen/qwen-ref' }),
      providerProfile('deepseek', { runtimeModelRef: 'deepseek/deepseek-ref' }),
    ];
    render(<SettingsScreen deps={makeProfileStore(profiles)} />);
    await screen.findByLabelText('Base URL');
    await selectCatalogModel('qwen-3.8-max');
    expect((screen.getByPlaceholderText('provider/configured-model-id') as HTMLInputElement).value).toBe('qwen/qwen-ref');
    await selectCatalogModel('deepseek-v4-flash');
    expect((screen.getByPlaceholderText('provider/configured-model-id') as HTMLInputElement).value).toBe('deepseek/deepseek-ref');
    await selectCatalogModel('qwen-3.8-max');
    expect((screen.getByPlaceholderText('provider/configured-model-id') as HTMLInputElement).value).toBe('qwen/qwen-ref');
  });
});
