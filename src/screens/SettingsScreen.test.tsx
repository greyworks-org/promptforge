import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsScreen, type SettingsScreenProps } from './SettingsScreen';
import type { ConnectionTestResult } from '../services/providerService';
import type { ProviderProfile } from '../schemas/providerProfile';

function makeDeps(overrides: Partial<NonNullable<SettingsScreenProps['deps']>> = {}) {
  return {
    loadProfile: vi.fn(() => null),
    saveProfile: vi.fn((p: ProviderProfile) => p),
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

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Base URL'), {
    target: { value: 'http://localhost:4141' },
  });
  fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'test-model' } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SettingsScreen', () => {
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
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'http://remote.example.com' } });
    fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(deps.saveProfile).not.toHaveBeenCalled();
  });

  it('saves profile and key, then clears the key input', async () => {
    const deps = makeDeps({ hasApiKey: vi.fn(async () => true) });
    render(<SettingsScreen deps={deps} />);
    fillValidForm();
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
    fillValidForm();
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
    fillValidForm();
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
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('✗ Authentication rejected')).toBeTruthy();
    expect(screen.getByText('Error class: auth')).toBeTruthy();
  });

  it('blocks the test when the model ID is missing', async () => {
    const deps = makeDeps();
    render(<SettingsScreen deps={deps} />);
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'http://localhost:4141' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(deps.testConnection).not.toHaveBeenCalled();
  });
});
