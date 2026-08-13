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
      providerId: string | null;
      modelId: string | null;
      modelRef: string | null;
      variant: string | null;
      detectedVersion: string | null;
    };
  };
  task: { id: string | null; objective: string };
  progress: { completed: string[]; pending: string[]; lastAction: string | null };
  context: { status: 'fresh' | 'stale' | 'unavailable'; checkpoint: string | null };
  changedFiles: string[];
  events: Array<{ id: string; kind: string; content: string; createdAt: string }>;
  completion: 'active' | 'completed' | 'failed' | 'interrupted';
  controls: { canStart: boolean; canResume: boolean; canCheckpoint: boolean };
}

export interface OpenCodeModel {
  runtime: 'opencode';
  providerId: string;
  modelId: string;
  modelRef: string;
  displayName: string;
  available: boolean;
  configured: boolean;
  availability: 'available' | 'configured' | 'unknown';
}

export interface ContinuationPackage {
  repository: string;
  task: { id: string; goal: string };
  currentStatus: string;
  observedCompleted: string[];
  observedPartial: string[];
  decisions: string[];
  constraints: string[];
  checkpointNotes: string[];
  changedFiles: string[];
  validationEvidence: string[];
  acceptanceRequiringVerification: string[];
  knownBlockers: string[];
  immediateNextAction: string;
  projectStateReferences: string[];
  sourceExecution: { sessionId: string; runtime: string; providerId: string | null; modelId: string | null; modelRef: string | null };
  targetExecution: { sessionId: string; runtime: string; providerId: string | null; modelId: string | null; modelRef: string | null };
  instruction: string;
  rendered: string;
}

export interface HandoffView {
  source: SessionView;
  models: OpenCodeModel[];
  discoveryWarning: string | null;
  preview: { previewId: string; projectId: string; targetModel: OpenCodeModel; continuation: ContinuationPackage; createdAt: string } | null;
  result: {
    handoff: {
      handoffId: string;
      taskId: string;
      sourceExecutionSessionId: string;
      targetExecutionSessionId: string;
      status: 'prepared' | 'launched' | 'failed';
      createdAt: string;
      activatedAt: string | null;
    };
    target: SessionView;
  } | null;
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
  const context = value.context;
  if (typeof session.id !== 'string' || typeof session.projectId !== 'string'
    || typeof session.runtime !== 'string' || typeof session.status !== 'string'
    || typeof task.objective !== 'string' || !isRecord(controls) || !isRecord(context)
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
        providerId: stringValue(binding.providerId, true),
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
    context: {
      status: ['fresh', 'stale', 'unavailable'].includes(String(context.status)) ? context.status as SessionView['context']['status'] : 'unavailable',
      checkpoint: stringValue(context.checkpoint, true),
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

function parseOpenCodeModel(value: unknown): OpenCodeModel {
  if (!isRecord(value) || value.runtime !== 'opencode'
    || typeof value.providerId !== 'string' || typeof value.modelId !== 'string'
    || typeof value.modelRef !== 'string' || typeof value.displayName !== 'string'
    || typeof value.available !== 'boolean' || typeof value.configured !== 'boolean'
    || !['available', 'configured', 'unknown'].includes(String(value.availability))) {
    throw new Error('PromptForge returned an invalid OpenCode model.');
  }
  return {
    runtime: 'opencode',
    providerId: value.providerId,
    modelId: value.modelId,
    modelRef: value.modelRef,
    displayName: value.displayName,
    available: value.available,
    configured: value.configured,
    availability: value.availability as OpenCodeModel['availability'],
  };
}

function parseContinuation(value: unknown): ContinuationPackage {
  if (!isRecord(value) || !isRecord(value.task) || !isRecord(value.sourceExecution)
    || !isRecord(value.targetExecution)) throw new Error('PromptForge returned an invalid continuation package.');
  const requiredStrings = ['repository', 'currentStatus', 'immediateNextAction', 'instruction', 'rendered'] as const;
  if (!requiredStrings.every((key) => typeof value[key] === 'string')
    || typeof value.task.id !== 'string' || typeof value.task.goal !== 'string') {
    throw new Error('PromptForge returned an invalid continuation package.');
  }
  const arrays = ['observedCompleted', 'observedPartial', 'decisions', 'constraints', 'checkpointNotes',
    'changedFiles', 'validationEvidence', 'acceptanceRequiringVerification', 'knownBlockers', 'projectStateReferences'] as const;
  if (!arrays.every((key) => Array.isArray(value[key]) && (value[key] as unknown[]).every((item) => typeof item === 'string'))) {
    throw new Error('PromptForge returned an invalid continuation package.');
  }
  const execution = (item: Record<string, unknown>) => {
    if (typeof item.sessionId !== 'string' || typeof item.runtime !== 'string') {
      throw new Error('PromptForge returned an invalid continuation package.');
    }
    return {
      sessionId: item.sessionId,
      runtime: item.runtime,
      providerId: stringValue(item.providerId, true),
      modelId: stringValue(item.modelId, true),
      modelRef: stringValue(item.modelRef, true),
    };
  };
  return {
    repository: value.repository as string,
    task: { id: value.task.id, goal: value.task.goal },
    currentStatus: value.currentStatus as string,
    observedCompleted: value.observedCompleted as string[],
    observedPartial: value.observedPartial as string[],
    decisions: value.decisions as string[],
    constraints: value.constraints as string[],
    checkpointNotes: value.checkpointNotes as string[],
    changedFiles: value.changedFiles as string[],
    validationEvidence: value.validationEvidence as string[],
    acceptanceRequiringVerification: value.acceptanceRequiringVerification as string[],
    knownBlockers: value.knownBlockers as string[],
    immediateNextAction: value.immediateNextAction as string,
    projectStateReferences: value.projectStateReferences as string[],
    sourceExecution: execution(value.sourceExecution),
    targetExecution: execution(value.targetExecution),
    instruction: value.instruction as string,
    rendered: value.rendered as string,
  };
}

export function parseHandoffView(value: unknown): HandoffView {
  if (!isRecord(value) || !('source' in value) || !Array.isArray(value.models)) {
    throw new Error('PromptForge returned an invalid handoff read model.');
  }
  const previewValue = value.preview;
  let preview: HandoffView['preview'] = null;
  if (previewValue !== null && previewValue !== undefined) {
    if (!isRecord(previewValue) || typeof previewValue.previewId !== 'string'
      || typeof previewValue.projectId !== 'string' || typeof previewValue.createdAt !== 'string') {
      throw new Error('PromptForge returned an invalid handoff preview.');
    }
    preview = {
      previewId: previewValue.previewId,
      projectId: previewValue.projectId,
      targetModel: parseOpenCodeModel(previewValue.targetModel),
      continuation: parseContinuation(previewValue.continuation),
      createdAt: previewValue.createdAt,
    };
  }
  const resultValue = value.result;
  let result: HandoffView['result'] = null;
  if (resultValue !== null && resultValue !== undefined) {
    if (!isRecord(resultValue) || !isRecord(resultValue.handoff)) throw new Error('PromptForge returned an invalid handoff result.');
    const handoff = resultValue.handoff;
    if (typeof handoff.handoffId !== 'string' || typeof handoff.taskId !== 'string'
      || typeof handoff.sourceExecutionSessionId !== 'string' || typeof handoff.targetExecutionSessionId !== 'string'
      || !['prepared', 'launched', 'failed'].includes(String(handoff.status))
      || typeof handoff.createdAt !== 'string') throw new Error('PromptForge returned an invalid handoff result.');
    result = {
      handoff: {
        handoffId: handoff.handoffId,
        taskId: handoff.taskId,
        sourceExecutionSessionId: handoff.sourceExecutionSessionId,
        targetExecutionSessionId: handoff.targetExecutionSessionId,
        status: handoff.status as 'prepared' | 'launched' | 'failed',
        createdAt: handoff.createdAt,
        activatedAt: stringValue(handoff.activatedAt, true),
      },
      target: parseSessionView(resultValue.target),
    };
  }
  return {
    source: parseSessionView(value.source),
    models: value.models.map(parseOpenCodeModel),
    discoveryWarning: stringValue(value.discoveryWarning, true),
    preview,
    result,
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

export async function fetchHandoffView(connection: VscodeConnection): Promise<HandoffView> {
  const url = `${connection.endpoint.replace(/\/$/, '')}/v1/handoff-views/${encodeURIComponent(connection.projectId)}/${encodeURIComponent(connection.sessionId)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${connection.token}` } });
  if (!response.ok) throw new Error(response.status === 404 ? 'PromptForge has not prepared the handoff view yet.' : `PromptForge handoff request failed (${response.status}).`);
  return parseHandoffView(await response.json() as unknown);
}

export type SessionAction = 'start' | 'resume' | 'checkpoint' | 'model' | 'handoff-context' | 'handoff-preview' | 'handoff-confirm';

export interface SessionActionResult {
  status: 'pending' | 'succeeded' | 'failed';
  message: string;
}

export async function requestSessionAction(
  connection: VscodeConnection,
  action: SessionAction,
  note?: string,
  payload?: unknown,
): Promise<string> {
  const response = await fetch(`${connection.endpoint.replace(/\/$/, '')}/v1/session-actions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: connection.projectId,
      sessionId: connection.sessionId,
      action,
      note: note ?? null,
      payload: payload ?? null,
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
