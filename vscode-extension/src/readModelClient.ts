export interface VscodeConnection {
  endpoint: string;
  token: string;
  projectId: string;
  sessionId: string;
}

export interface SessionView {
  session: {
    id: string;
    projectId: string;
    runtime: string;
    status: string;
    binding: {
      modelId: string | null;
      modelRef: string | null;
      variant: string | null;
      detectedVersion: string | null;
    };
  };
  task: { id: string | null; objective: string };
  progress: { completed: string[]; pending: string[]; lastAction: string | null };
  changedFiles: string[];
  events: Array<{ id: string; kind: string; content: string; createdAt: string }>;
  completion: 'active' | 'completed' | 'failed' | 'interrupted';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, nullable = false): string | null {
  if (typeof value === 'string') return value;
  return nullable && value === null ? null : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function parseSessionView(value: unknown): SessionView {
  if (!isRecord(value) || !isRecord(value.session) || !isRecord(value.session.binding)
    || !isRecord(value.task) || !isRecord(value.progress)) {
    throw new Error('PromptForge returned an invalid session read model.');
  }
  const session = value.session;
  const binding = session.binding;
  const task = value.task;
  const progress = value.progress;
  if (!isRecord(binding)) throw new Error('PromptForge returned an invalid session read model.');
  const completion = value.completion;
  if (typeof session.id !== 'string' || typeof session.projectId !== 'string'
    || typeof session.runtime !== 'string' || typeof session.status !== 'string'
    || typeof task.objective !== 'string'
    || !['active', 'completed', 'failed', 'interrupted'].includes(String(completion))) {
    throw new Error('PromptForge returned an invalid session read model.');
  }
  const events = Array.isArray(value.events) ? value.events.flatMap((item): SessionView['events'] => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.kind !== 'string'
      || typeof item.content !== 'string' || typeof item.createdAt !== 'string') return [];
    return [{ id: item.id, kind: item.kind, content: item.content, createdAt: item.createdAt }];
  }) : [];
  return {
    session: {
      id: session.id,
      projectId: session.projectId,
      runtime: session.runtime,
      status: session.status,
      binding: {
        modelId: stringValue(binding.modelId, true),
        modelRef: stringValue(binding.modelRef, true),
        variant: stringValue(binding.variant, true),
        detectedVersion: stringValue(binding.detectedVersion, true),
      },
    },
    task: { id: stringValue(task.id, true), objective: task.objective },
    progress: {
      completed: stringArray(progress.completed),
      pending: stringArray(progress.pending),
      lastAction: stringValue(progress.lastAction, true),
    },
    changedFiles: stringArray(value.changedFiles),
    events,
    completion: completion as SessionView['completion'],
  };
}

export function parseConnection(value: string): VscodeConnection | null {
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

export async function fetchSessionView(connection: VscodeConnection): Promise<SessionView> {
  const url = `${connection.endpoint.replace(/\/$/, '')}/v1/session-views/${encodeURIComponent(connection.projectId)}/${encodeURIComponent(connection.sessionId)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${connection.token}` } });
  if (!response.ok) {
    throw new Error(response.status === 404 ? 'PromptForge has not published this session yet.' : `PromptForge read-model request failed (${response.status}).`);
  }
  return parseSessionView(await response.json() as unknown);
}
