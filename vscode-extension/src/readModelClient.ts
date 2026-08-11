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
  controls: { canStart: boolean; canResume: boolean; canCheckpoint: boolean };
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
  const controls = value.controls;
  if (typeof session.id !== 'string' || typeof session.projectId !== 'string'
    || typeof session.runtime !== 'string' || typeof session.status !== 'string'
    || typeof task.objective !== 'string' || !isRecord(controls)
    || typeof controls.canStart !== 'boolean' || typeof controls.canResume !== 'boolean'
    || typeof controls.canCheckpoint !== 'boolean'
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
    controls: {
      canStart: controls.canStart,
      canResume: controls.canResume,
      canCheckpoint: controls.canCheckpoint,
    },
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

export type SessionAction = 'start' | 'resume' | 'checkpoint';

export interface SessionActionResult {
  status: 'pending' | 'succeeded' | 'failed';
  message: string;
}

export async function requestSessionAction(
  connection: VscodeConnection,
  action: SessionAction,
  note?: string,
): Promise<string> {
  const response = await fetch(`${connection.endpoint.replace(/\/$/, '')}/v1/session-actions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: connection.projectId,
      sessionId: connection.sessionId,
      action,
      note: note ?? null,
    }),
  });
  if (!response.ok) {
    throw new Error(`PromptForge rejected the session action (${response.status}).`);
  }
  const result = await response.json() as unknown;
  if (!isRecord(result) || typeof result.actionId !== 'string') {
    throw new Error('PromptForge returned an invalid session action response.');
  }
  return result.actionId;
}

export async function waitForSessionAction(
  connection: VscodeConnection,
  actionId: string,
): Promise<SessionActionResult> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${connection.endpoint.replace(/\/$/, '')}/v1/session-actions/${encodeURIComponent(actionId)}`, {
      headers: { Authorization: `Bearer ${connection.token}` },
    });
    if (!response.ok) throw new Error(`PromptForge action status failed (${response.status}).`);
    const result = await response.json() as unknown;
    if (!isRecord(result) || typeof result.status !== 'string' || typeof result.message !== 'string'
      || !['pending', 'succeeded', 'failed'].includes(result.status)) {
      throw new Error('PromptForge returned an invalid session action status.');
    }
    if (result.status !== 'pending') {
      return { status: result.status as SessionActionResult['status'], message: result.message };
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('PromptForge did not complete the session action in time.');
}
