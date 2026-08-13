import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  finishExecutionSession: vi.fn(),
  getExecutionSession: vi.fn(),
  getExecutionSessionView: vi.fn(),
  launchExecutionSessionThroughOpenCode: vi.fn(),
  listSessionEvents: vi.fn(),
  reconcileProjectSessions: vi.fn(),
  renderSessionContinuation: vi.fn(),
  renderSessionTask: vi.fn(),
  saveSessionCheckpoint: vi.fn(),
  selectOpenCodeModel: vi.fn(),
  switchSessionRuntime: vi.fn(),
  updateSessionInstruction: vi.fn(),
  verifyExecutionSession: vi.fn(),
  inspectProjectGuidance: vi.fn(),
  listProjectContextDocuments: vi.fn(),
  removeProjectContextDocument: vi.fn(),
  selectProjectContextDocument: vi.fn(),
  projectContextPathInputError: vi.fn(),
  getOpenCodeModelDiscovery: vi.fn(),
  getProject: vi.fn(),
  detectRuntime: vi.fn(),
  openVscode: vi.fn(),
  publishVscodeSessionView: vi.fn(),
  getVscodeBridgeStatus: vi.fn(),
}));

vi.mock('../sessions/executionSessionService', () => mocks);
vi.mock('../services/projectGuidance', () => ({ inspectProjectGuidance: mocks.inspectProjectGuidance }));
vi.mock('../services/projectContextService', () => ({
  listProjectContextDocuments: mocks.listProjectContextDocuments,
  removeProjectContextDocument: mocks.removeProjectContextDocument,
  selectProjectContextDocument: mocks.selectProjectContextDocument,
  projectContextPathInputError: mocks.projectContextPathInputError,
}));
vi.mock('../services/opencodeModels', () => ({ getOpenCodeModelDiscovery: mocks.getOpenCodeModelDiscovery }));
vi.mock('../services/projectsService', () => ({ getProject: mocks.getProject }));
vi.mock('../services/runtimeService', () => ({ detectRuntime: mocks.detectRuntime }));
vi.mock('../services/vscodeIntegration', () => ({
  getVscodeBridgeStatus: mocks.getVscodeBridgeStatus,
  openVscode: mocks.openVscode,
  publishVscodeSessionView: mocks.publishVscodeSessionView,
}));

import { SessionsScreen } from './SessionsScreen';

const session = {
  id: 'session-offerpath',
  projectId: 'project-offerpath',
  compilationId: null,
  taskId: null,
  runtime: 'claude-code' as const,
  status: 'completed' as const,
  runtimeCwd: '/Users/utku/projects/offerpath',
  binding: {
    providerId: null, modelId: null, modelRef: null, variant: null,
    runtimeSessionId: null, detectedVersion: null, capabilities: [],
  },
  userInstruction: '',
  state: {
    objective: 'Offerpath task', taskId: null, completed: [], pending: [],
    decisions: [], blockers: [], relevantFiles: [], lastAction: null, lastValidation: null,
  },
  baseCommit: null,
  lastKnownHead: null,
  recoveryReason: null,
  startedAt: '2026-08-12T00:00:00Z',
  lastActiveAt: '2026-08-12T00:00:00Z',
  endedAt: '2026-08-12T00:01:00Z',
};

let events: Array<Record<string, unknown>>;
let contextDocs: string[];

beforeEach(() => {
  events = [{ id: 'started', kind: 'started', content: 'Started.', runtime: 'claude-code' }];
  contextDocs = [];
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getProject.mockResolvedValue({ id: 'project-offerpath', repoPath: '/Users/utku/projects/offerpath' });
  mocks.reconcileProjectSessions.mockResolvedValue([session]);
  mocks.listSessionEvents.mockImplementation(async () => events);
  mocks.renderSessionContinuation.mockResolvedValue('canonical continuation');
  mocks.getExecutionSession.mockResolvedValue(session);
  mocks.inspectProjectGuidance.mockResolvedValue([]);
  mocks.listProjectContextDocuments.mockImplementation(async () => contextDocs.map((relPath) => ({ projectId: 'project-offerpath', relPath, selectedAt: 'now' })));
  mocks.selectProjectContextDocument.mockImplementation(async (_projectId: string, relPath: string) => {
    if (!contextDocs.includes(relPath)) contextDocs.push(relPath);
    return { projectId: 'project-offerpath', relPath, selectedAt: 'now' };
  });
  mocks.projectContextPathInputError.mockImplementation((raw: string) => raw.includes('..') ? 'Context document path cannot contain parent traversal (..).' : raw.startsWith('/') ? 'Context document path must be relative.' : null);
  mocks.detectRuntime.mockResolvedValue({ installed: false });
  mocks.publishVscodeSessionView.mockResolvedValue(undefined);
  mocks.getVscodeBridgeStatus.mockResolvedValue({ available: false, message: 'unavailable' });
  mocks.openVscode.mockResolvedValue({ application: 'Visual Studio Code', projectRoot: '/Users/utku/projects/offerpath' });
});

afterEach(() => cleanup());

function renderSessions() {
  return render(<SessionsScreen projectId="project-offerpath" projectName="Offerpath" onClose={vi.fn()} />);
}

describe('Sessions persistence controls', () => {
  it('adds a valid document through the UI and clears the input after persistence', async () => {
    renderSessions();
    const input = await screen.findByLabelText('Project context document path');
    const path = 'docs/offerpath-v2/offerpath-source-of-truth.md';

    fireEvent.change(input, { target: { value: path } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Add document' }) as HTMLButtonElement).disabled).toBe(false));
    const add = await screen.findByRole('button', { name: 'Add document' });
    fireEvent.click(add);

    await waitFor(() => expect(mocks.selectProjectContextDocument).toHaveBeenCalledWith('project-offerpath', path));
    expect((input as HTMLInputElement).value).toBe('');
    expect(await screen.findByText(path)).not.toBeNull();
  });

  it('keeps invalid paths disabled and reports the syntax error inline', async () => {
    renderSessions();
    const input = await screen.findByLabelText('Project context document path');
    const add = screen.getByRole('button', { name: 'Add document' });

    fireEvent.change(input, { target: { value: '../outside.md' } });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('parent traversal');
    expect(mocks.selectProjectContextDocument).not.toHaveBeenCalled();
  });

  it('saves non-empty checkpoint knowledge, reads it back, and prevents duplicate clicks', async () => {
    mocks.saveSessionCheckpoint.mockImplementation(async (_projectId: string, _sessionId: string, content: string) => {
      const event = { id: `note-${events.length}`, kind: 'user_note', content, runtime: 'claude-code' };
      events = [...events, event];
      return event;
    });
    renderSessions();
    const textarea = await screen.findByLabelText('Add local checkpoint knowledge');
    const save = screen.getByRole('button', { name: 'Save checkpoint' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: 'Offerpath checkpoint survived readback.' } });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(mocks.saveSessionCheckpoint).toHaveBeenCalledTimes(1));
    expect((textarea as HTMLTextAreaElement).value).toBe('');
    expect(await screen.findByText(/Offerpath checkpoint survived readback/)).not.toBeNull();
  });

  it('retains checkpoint text and shows the actual persistence error', async () => {
    mocks.saveSessionCheckpoint.mockRejectedValue(new Error('SQLite checkpoint write failed.'));
    renderSessions();
    const textarea = await screen.findByLabelText('Add local checkpoint knowledge');
    fireEvent.change(textarea, { target: { value: 'Keep this if persistence fails.' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save checkpoint' }));

    await waitFor(() => expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('SQLite checkpoint write failed.'))).toBe(true));
    expect((textarea as HTMLTextAreaElement).value).toBe('Keep this if persistence fails.');
  });

  it('routes completion through verification before finishing the session', async () => {
    mocks.verifyExecutionSession.mockResolvedValue({
      taskId: 'TASK-OFFERPATH-1',
      visualReview: {
        applicable: false,
        evidence: null,
        target: null,
        screenshotCount: 0,
        reviewCount: 0,
        correctivePasses: 0,
        correctiveInstruction: null,
      },
      outcome: { status: 'READY', unresolvedCritical: [], pendingHumanReview: [], blockers: [] },
    });
    mocks.finishExecutionSession.mockResolvedValue(session);
    renderSessions();

    fireEvent.click(await screen.findByRole('button', { name: 'Verify & complete' }));

    await waitFor(() => {
      expect(mocks.verifyExecutionSession).toHaveBeenCalledWith('project-offerpath', 'session-offerpath');
      expect(mocks.finishExecutionSession).toHaveBeenCalledWith('project-offerpath', 'session-offerpath', 'completed');
    });
  });
});
