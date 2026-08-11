import { describe, expect, it } from 'vitest';
import { renderHandoffHtml } from '../vscode-extension/src/handoffHtml';
import { parseHandoffView, type HandoffView } from '../vscode-extension/src/readModelClient';

const model = {
  runtime: 'opencode' as const,
  providerId: 'openrouter',
  modelId: 'deepseek-v4',
  modelRef: 'openrouter/deepseek-v4',
  displayName: 'DeepSeek V4',
  available: true,
  configured: true,
  availability: 'available' as const,
};

const view: HandoffView = {
  source: {
    session: {
      id: 'session-a', projectId: 'project-a', runtime: 'claude-code', status: 'paused',
      binding: { providerId: 'anthropic', modelId: 'claude-sonnet', modelRef: 'anthropic/claude-sonnet', variant: null, detectedVersion: null },
    },
    task: { id: 'TASK-1', objective: 'Continue the task.' },
    progress: { completed: [], pending: [], lastAction: null }, changedFiles: [], events: [],
    context: { status: 'fresh', checkpoint: 'Checkpoint A' },
    completion: 'active', controls: { canStart: false, canResume: false, canCheckpoint: true },
  },
  models: [model],
  discoveryWarning: null,
  preview: {
    previewId: 'preview-1', projectId: 'project-a', targetModel: model, createdAt: '2026-08-11T00:00:00Z',
    continuation: {
      repository: '/repo', task: { id: 'TASK-1', goal: 'Continue the task.' }, currentStatus: 'paused',
      observedCompleted: ['Compiled the task'], observedPartial: ['UI review remains'],
      decisions: ['Keep source immutable'], constraints: ['No transcript replay'], checkpointNotes: ['Checkpoint A'],
      changedFiles: ['src/example.ts'], validationEvidence: ['TypeScript passed'],
      acceptanceRequiringVerification: ['Confirm target status'], knownBlockers: ['None'],
      immediateNextAction: 'Review the target session.', projectStateReferences: ['docs/PROJECT_STATE.md'],
      sourceExecution: { sessionId: 'session-a', runtime: 'claude-code', providerId: 'anthropic', modelId: 'claude-sonnet', modelRef: 'anthropic/claude-sonnet' },
      targetExecution: { sessionId: 'session-preview', runtime: 'opencode', providerId: model.providerId, modelId: model.modelId, modelRef: model.modelRef },
      instruction: 'Continue from evidence.', rendered: 'This bounded prompt is not rendered in the review panel.',
    },
  },
  result: null,
};

describe('VS Code handoff review boundary', () => {
  it('renders the Handoff action state and every bounded evidence section without transcript replay', () => {
    const html = renderHandoffHtml(view);
    for (const heading of [
      'Source', 'Target OpenCode model', 'Observed completed', 'Observed partial', 'Decisions / constraints',
      'Checkpoint', 'Changed / relevant files', 'Validation evidence', 'Acceptance requiring verification',
      'Known blockers', 'Immediate continuation', 'Confirm Handoff',
    ]) expect(html).toContain(heading);
    expect(html).toContain('session-a');
    expect(html).not.toContain('This bounded prompt is not rendered in the review panel.');
  });

  it('accepts only the structured handoff read model and preserves target identity', () => {
    const parsed = parseHandoffView(view);
    expect(parsed.preview?.continuation.targetExecution.modelRef).toBe(model.modelRef);
    expect(parsed.preview?.continuation.observedPartial).toEqual(['UI review remains']);
    expect(parsed.models).toEqual([model]);
  });
});
