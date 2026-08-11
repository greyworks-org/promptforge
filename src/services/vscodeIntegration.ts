import { invokeIpc } from '../ipc';
import {
  getExecutionSessionView,
  type ExecutionSessionView,
} from '../sessions/executionSessionService';

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

export async function getVscodeConnection(projectId: string, sessionId: string): Promise<VscodeConnection> {
  const endpoint = await invokeIpc<ReadModelEndpoint>('vscode_read_model_endpoint');
  return {
    endpoint: endpoint.baseUrl,
    token: endpoint.token,
    projectId,
    sessionId,
  };
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
