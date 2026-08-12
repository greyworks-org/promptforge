import { invokeIpc } from '../ipc';
import {
  getExecutionSessionView,
  launchExecutionSessionThroughOpenCode,
  saveSessionCheckpoint,
  type ExecutionSessionView,
} from '../sessions/executionSessionService';
import {
  confirmHandoffPreview,
  prepareHandoffPreview,
  type HandoffPreview,
} from '../handoff/crossModelService';
import { openCodeModelSchema, getOpenCodeModelDiscovery, type OpenCodeModel } from './opencodeModels';

interface ReadModelEndpoint {
  baseUrl: string;
  token: string;
}

export interface VscodeConnection {
  endpoint: string;
  token: string;
  projectId: string;
  sessionId: string;
}

export type VscodeSessionAction = 'start' | 'resume' | 'checkpoint' | 'handoff-context' | 'handoff-preview' | 'handoff-confirm';

let processingVscodeAction = false;

interface VscodeSessionActionRequest {
  id: string;
  projectId: string;
  sessionId: string;
  action: VscodeSessionAction;
  note: string | null;
  payload: unknown;
}

export interface VscodeHandoffView {
  source: ExecutionSessionView;
  models: OpenCodeModel[];
  discoveryWarning: string | null;
  preview: HandoffPreview | null;
  result: {
    handoff: Awaited<ReturnType<typeof confirmHandoffPreview>>['handoff'];
    target: ExecutionSessionView;
  } | null;
}

export async function getVscodeConnection(projectId: string, sessionId: string): Promise<VscodeConnection> {
  const endpoint = await invokeIpc<ReadModelEndpoint>('vscode_read_model_endpoint');
  return {
    endpoint: endpoint.baseUrl,
    token: endpoint.token,
    projectId,
    sessionId,
  };
}

export interface VscodeLaunchResult {
  projectRoot: string;
  application: string;
}

/** Native launch only. Rust resolves and validates the registered project root. */
export async function openVscode(projectId: string): Promise<VscodeLaunchResult> {
  return invokeIpc<VscodeLaunchResult>('open_vscode', { projectId });
}

/** Publishes a derived view only; SQLite remains the canonical session store. */
export async function publishVscodeSessionView(
  projectId: string,
  sessionId: string,
  view?: ExecutionSessionView,
): Promise<void> {
  const nextView = view ?? await getExecutionSessionView(projectId, sessionId);
  await invokeIpc('vscode_publish_session_view', {
    projectId,
    sessionId,
    view: nextView,
  });
}

export async function publishVscodeHandoffView(
  projectId: string,
  sessionId: string,
  view: VscodeHandoffView,
): Promise<void> {
  await invokeIpc('vscode_publish_handoff_view', { projectId, sessionId, view });
}

export async function getVscodeHandoffContext(projectId: string, sessionId: string): Promise<VscodeHandoffView> {
  const source = await getExecutionSessionView(projectId, sessionId);
  const discovery = await getOpenCodeModelDiscovery(projectId, source.session.binding.modelRef);
  return {
    source,
    models: discovery.models,
    discoveryWarning: discovery.warning,
    preview: null,
    result: null,
  };
}

export async function getVscodeHandoffPreview(
  projectId: string,
  sessionId: string,
  targetModel: OpenCodeModel,
): Promise<VscodeHandoffView> {
  const preview = await prepareHandoffPreview({ projectId, sourceSessionId: sessionId, targetModel });
  const context = await getVscodeHandoffContext(projectId, sessionId);
  return { ...context, preview };
}

export async function getVscodeHandoffResult(
  projectId: string,
  sessionId: string,
  previewId: string,
): Promise<VscodeHandoffView> {
  const result = await confirmHandoffPreview(previewId);
  const context = await getVscodeHandoffContext(projectId, sessionId);
  return {
    ...context,
    result: {
      handoff: result.handoff,
      target: await getExecutionSessionView(projectId, result.targetSession.id),
    },
    preview: null,
  };
}

/** Claims one explicitly requested action for PromptForge-side execution. */
export async function processVscodeSessionAction(): Promise<void> {
  if (processingVscodeAction) return;
  processingVscodeAction = true;
  let action: VscodeSessionActionRequest | null = null;
  try {
    action = await invokeIpc<VscodeSessionActionRequest | null>('vscode_take_session_action');
    if (action === null) return;
    const view = await getExecutionSessionView(action.projectId, action.sessionId);
    if (action.action === 'handoff-context') {
      await publishVscodeHandoffView(action.projectId, action.sessionId, await getVscodeHandoffContext(action.projectId, action.sessionId));
      await invokeIpc('vscode_complete_session_action', {
        actionId: action.id,
        success: true,
        message: 'Handoff context loaded.',
      });
      return;
    }
    if (action.action === 'handoff-preview') {
      const targetModel = openCodeModelSchema.parse(action.payload);
      await publishVscodeHandoffView(
        action.projectId,
        action.sessionId,
        await getVscodeHandoffPreview(action.projectId, action.sessionId, targetModel),
      );
      await invokeIpc('vscode_complete_session_action', {
        actionId: action.id,
        success: true,
        message: 'Handoff preview prepared.',
      });
      return;
    }
    if (action.action === 'handoff-confirm') {
      if (typeof action.payload !== 'string' || action.payload.trim() === '') {
        throw new Error('A handoff preview is required before confirmation.');
      }
      await publishVscodeHandoffView(
        action.projectId,
        action.sessionId,
        await getVscodeHandoffResult(action.projectId, action.sessionId, action.payload),
      );
      await invokeIpc('vscode_complete_session_action', {
        actionId: action.id,
        success: true,
        message: 'Handoff complete. A new OpenCode session was created.',
      });
      return;
    }
    if (action.action === 'checkpoint') {
      const note = action.note?.trim() ?? '';
      if (!view.controls.canCheckpoint || note === '') throw new Error('A non-empty checkpoint note is required.');
      await saveSessionCheckpoint(action.projectId, action.sessionId, note);
    } else {
      if (action.action === 'start' && !view.controls.canStart) throw new Error('This OpenCode session is not eligible to start.');
      if (action.action === 'resume' && !view.controls.canResume) throw new Error('This OpenCode session is not eligible to resume.');
      await launchExecutionSessionThroughOpenCode(action.projectId, action.sessionId, action.action);
    }
    await publishVscodeSessionView(action.projectId, action.sessionId);
    await invokeIpc('vscode_complete_session_action', {
      actionId: action.id,
      success: true,
      message: action.action === 'checkpoint' ? 'Checkpoint note saved.' : `OpenCode session ${action.action} requested.`,
    });
  } catch (error) {
    if (action !== null) {
      try { await publishVscodeSessionView(action.projectId, action.sessionId); } catch { /* preserve the action error */ }
      await invokeIpc('vscode_complete_session_action', {
        actionId: action.id,
        success: false,
        message: error instanceof Error ? error.message : 'PromptForge could not complete the session action.',
      });
    }
  } finally {
    processingVscodeAction = false;
  }
}

export function formatVscodeConnection(connection: VscodeConnection): string {
  const query = new URLSearchParams({
    endpoint: connection.endpoint,
    token: connection.token,
    projectId: connection.projectId,
    sessionId: connection.sessionId,
  });
  return `promptforge://connect?${query.toString()}`;
}

export function parseVscodeConnection(value: string): VscodeConnection | null {
  try {
    const uri = new URL(value);
    if (uri.protocol !== 'promptforge:' || uri.hostname !== 'connect') return null;
    const endpoint = uri.searchParams.get('endpoint');
    const token = uri.searchParams.get('token');
    const projectId = uri.searchParams.get('projectId');
    const sessionId = uri.searchParams.get('sessionId');
    if (!endpoint || !token || !projectId || !sessionId) return null;
    const parsedEndpoint = new URL(endpoint);
    if (parsedEndpoint.protocol !== 'http:' || parsedEndpoint.hostname !== '127.0.0.1') return null;
    return { endpoint, token, projectId, sessionId };
  } catch {
    return null;
  }
}
