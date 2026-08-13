import { useCallback, useEffect, useRef, useState } from 'react';
import {
  finishExecutionSession,
  getExecutionSession,
  getExecutionSessionView,
  launchExecutionSessionThroughOpenCode,
  listSessionEvents,
  reconcileProjectSessions,
  renderSessionContinuation,
  renderSessionTask,
  saveSessionCheckpoint,
  switchSessionModel,
  switchSessionRuntime,
  updateSessionInstruction,
  verifyExecutionSession,
  type ExecutionVerificationResult,
} from '../sessions/executionSessionService';
import type { ExecutionSession, SessionEvent, SessionRuntime } from '../sessions/types';
import { inspectProjectGuidance, type GuidanceEntry } from '../services/projectGuidance';
import {
  listProjectContextDocuments,
  removeProjectContextDocument,
  projectContextPathInputError,
  selectProjectContextDocument,
} from '../services/projectContextService';
import { getOpenCodeModelDiscovery, type OpenCodeModelDiscovery } from '../services/opencodeModels';
import { listProfiles } from '../services/settingsService';
import { MODEL_CATALOG, resolveCatalogModel, runtimeModelRef, catalogLabelForBinding } from '../models/catalog';
import { getProject } from '../services/projectsService';
import { detectRuntime, type RuntimeAvailability } from '../services/runtimeService';
import {
  getVscodeBridgeStatus,
  openVscode,
  publishVscodeSessionView,
} from '../services/vscodeIntegration';

export interface SessionsScreenProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

const runtimes: SessionRuntime[] = ['opencode', 'claude-code', 'codex', 'qwen-code'];

export function SessionsScreen({ projectId, projectName, onClose }: SessionsScreenProps) {
  const [sessions, setSessions] = useState<ExecutionSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [prompt, setPrompt] = useState('');
  const [newInstruction, setNewInstruction] = useState('');
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const savingNoteRef = useRef(false);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);
  const [contextPath, setContextPath] = useState('');
  const [contextDocs, setContextDocs] = useState<string[]>([]);
  const [contextError, setContextError] = useState<string | null>(null);
  const [launchFeedback, setLaunchFeedback] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<GuidanceEntry[]>([]);
  const [openCodeAvailability, setOpenCodeAvailability] = useState<RuntimeAvailability | null>(null);
  const [openCodeModels, setOpenCodeModels] = useState<OpenCodeModelDiscovery | null>(null);
  const [providerProfiles, setProviderProfiles] = useState<Awaited<ReturnType<typeof listProfiles>>>([]);
  const [registeredRoot, setRegisteredRoot] = useState<string | null>(null);
  const [vscodeConnection, setVscodeConnection] = useState<string | null>(null);
  const [vscodeStatus, setVscodeStatus] = useState<'unknown' | 'available' | 'unavailable'>('unknown');
  const [verification, setVerification] = useState<ExecutionVerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selected = sessions.find((session) => session.id === selectedId) ?? null;

  const load = useCallback(async () => {
    // Keep the settled session controls mounted while refreshing the selected
    // session; otherwise a dependency-driven refresh can detach active inputs.
    if (selectedId === null) setLoading(true);
    setError(null);
    try {
      const project = await getProject(projectId);
      if (project === null) throw new Error('The registered project could not be found.');
      setRegisteredRoot(project.repoPath);
      try { setProviderProfiles(await listProfiles()); } catch { setProviderProfiles([]); }
      const reconciled = await reconcileProjectSessions(projectId);
      setSessions(reconciled);
      const nextId = selectedId && reconciled.some((session) => session.id === selectedId)
        ? selectedId
        : reconciled[0]?.id ?? null;
      setSelectedId(nextId);
      setGuidance(await inspectProjectGuidance(projectId));
      setContextDocs((await listProjectContextDocuments(projectId)).map((document) => document.relPath));
      try {
        const bridgeStatus = await getVscodeBridgeStatus();
        setVscodeStatus(bridgeStatus.available ? 'available' : 'unavailable');
      } catch {
        setVscodeStatus('unavailable');
      }
      try { setOpenCodeAvailability(await detectRuntime('opencode')); } catch { setOpenCodeAvailability(null); }
      if (nextId) {
        const nextSession = reconciled.find((session) => session.id === nextId);
        if (nextSession?.runtime === 'opencode') {
          try {
            setOpenCodeModels(await getOpenCodeModelDiscovery(projectId, nextSession.binding.modelRef));
          } catch {
            setOpenCodeModels(null);
          }
        } else {
          setOpenCodeModels(null);
        }
        const [nextEvents, nextPrompt] = await Promise.all([
          listSessionEvents(projectId, nextId),
          renderSessionContinuation(projectId, nextId),
        ]);
        setEvents(nextEvents);
        setPrompt(nextPrompt);
        setNewInstruction(nextSession?.userInstruction ?? '');
        try {
          await publishVscodeSessionView(projectId, nextId);
          setVscodeStatus('available');
        } catch {
          setVscodeStatus('unavailable');
        }
      } else {
        setEvents([]);
        setPrompt('');
        setNewInstruction('');
        setContextDocs([]);
        setOpenCodeModels(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sessions could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [projectId, selectedId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selectedId) return undefined;
    const timer = window.setInterval(() => {
      void getExecutionSessionView(projectId, selectedId)
        .then((view) => publishVscodeSessionView(projectId, selectedId, view))
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, [projectId, selectedId]);

  const select = async (sessionId: string) => {
    setSelectedId(sessionId);
    setLaunchFeedback(null);
    setNote('');
    setCheckpointError(null);
    try {
      const nextSession = sessions.find((session) => session.id === sessionId);
      if (nextSession?.runtime === 'opencode') {
        try {
          setOpenCodeModels(await getOpenCodeModelDiscovery(projectId, nextSession.binding.modelRef));
        } catch {
          setOpenCodeModels(null);
        }
      } else {
        setOpenCodeModels(null);
      }
      const [nextEvents, nextPrompt] = await Promise.all([
        listSessionEvents(projectId, sessionId),
        renderSessionContinuation(projectId, sessionId),
      ]);
      setEvents(nextEvents);
      setPrompt(nextPrompt);
      setNewInstruction(nextSession?.userInstruction ?? '');
      try {
        await publishVscodeSessionView(projectId, sessionId);
        setVscodeStatus('available');
      } catch {
        setVscodeStatus('unavailable');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Session details could not be loaded.');
    }
  };

  const chooseSessionModel = async (modelId: string) => {
    if (!selected) return;
    const resolved = resolveCatalogModel(modelId, providerProfiles);
    if (!resolved.ok) { setError(resolved.error); return; }
    const modelRef = runtimeModelRef(resolved.value.profile);
    if (modelRef === null) {
      setError(`CONFIGURATION REQUIRED: add an OpenCode model reference for ${resolved.value.model.displayName} in Settings.`);
      return;
    }
    const capability = selected.runtime === 'opencode'
      ? openCodeModels?.models.find((item) => item.modelRef === modelRef)
      : undefined;
    if (selected.runtime === 'opencode' && (capability === undefined || (!capability.available && !capability.configured))) {
      setError('MODEL UNAVAILABLE IN OPENCODE');
      return;
    }
    try {
      await switchSessionModel(projectId, selected.id, {
        providerId: resolved.value.profile.providerId ?? resolved.value.model.providerId,
        modelId: resolved.value.profile.modelId,
        modelRef,
        available: capability?.available,
        configured: capability?.configured,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OpenCode model selection failed.');
    }
  };

  const switchRuntime = async (runtime: SessionRuntime) => {
    if (!selected) return;
    try {
      await switchSessionRuntime(projectId, selected.id, runtime);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Runtime switch failed.');
    }
  };

  const finish = async (status: 'completed' | 'paused') => {
    if (!selected) return;
    try {
      if (status === 'completed') {
        if (verification !== null) {
          if (verification.outcome.status !== 'READY') return;
        } else {
          setVerifying(true);
          const result = await verifyExecutionSession(projectId, selected.id);
          setVerification(result);
          if (result.outcome.status !== 'READY') return;
        }
      }
      await finishExecutionSession(projectId, selected.id, status);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Session update failed.');
    } finally {
      setVerifying(false);
    }
  };

  const launchOpenCode = async (mode: 'start' | 'resume') => {
    if (!selected) return;
    try {
      const saved = await updateSessionInstruction(projectId, selected.id, newInstruction);
      const taskPrompt = await renderSessionTask(projectId, selected.id, saved.userInstruction);
      const result = await launchExecutionSessionThroughOpenCode(projectId, selected.id, mode, taskPrompt);
      setSessions((current) => current.map((session) => session.id === result.session.id ? result.session : session));
      setEvents(await listSessionEvents(projectId, selected.id));
      setPrompt(await renderSessionContinuation(projectId, selected.id));
      setLaunchFeedback(`STARTED: OpenCode is running in ${projectName}.`);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OpenCode launch failed.';
      setLaunchFeedback(`FAILED: ${message}`);
      setError(message);
      try {
        const failed = await getExecutionSession(projectId, selected.id);
        if (failed !== null) {
          setSessions((current) => current.map((session) => session.id === failed.id ? failed : session));
          setNewInstruction(failed.userInstruction);
          setEvents(await listSessionEvents(projectId, failed.id));
        }
      } catch (refreshError) {
        const detail = refreshError instanceof Error ? refreshError.message : 'unknown session refresh error';
        setError(`${message} Session state refresh failed: ${detail}`);
      }
    }
  };

  const saveNote = async () => {
    if (!selected || note.trim() === '' || savingNoteRef.current) return;
    const sessionId = selected.id;
    const checkpoint = note;
    savingNoteRef.current = true;
    setSavingNote(true);
    setCheckpointError(null);
    try {
      await saveSessionCheckpoint(projectId, sessionId, checkpoint);
      setNote('');
      const [savedSession, savedEvents, savedPrompt] = await Promise.all([
        getExecutionSession(projectId, sessionId),
        listSessionEvents(projectId, sessionId),
        renderSessionContinuation(projectId, sessionId),
      ]);
      if (savedSession !== null) {
        setSessions((current) => current.map((session) => session.id === sessionId ? savedSession : session));
      }
      setEvents(savedEvents);
      setPrompt(savedPrompt);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Session note could not be saved.';
      setCheckpointError(message);
      setError(message);
    } finally {
      savingNoteRef.current = false;
      setSavingNote(false);
    }
  };

  const copy = async () => {
    if (!prompt || !navigator.clipboard) return;
    await navigator.clipboard.writeText(prompt);
  };

  const connectVscode = async () => {
    if (!selected) return;
    try {
      const result = await openVscode(projectId);
      setVscodeConnection(`Opened ${result.application} at ${result.projectRoot}`);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'VS Code could not be opened.');
    }
  };

  const addContextDocument = async () => {
    try {
      const document = await selectProjectContextDocument(projectId, contextPath);
      setContextDocs((current) => [...new Set([...current, document.relPath])].sort());
      setContextPath('');
      setContextError(null);
    } catch (err) {
      setContextError(err instanceof Error ? err.message : 'Context document could not be selected.');
    }
  };

  const removeContextDocument = async (path: string) => {
    try {
      await removeProjectContextDocument(projectId, path);
      setContextDocs((current) => current.filter((item) => item !== path));
      setContextError(null);
    } catch (err) {
      setContextError(err instanceof Error ? err.message : 'Context document could not be removed.');
    }
  };

  const latestLaunchEvent = [...events].reverse().find((event) => event.kind === 'runtime_launch' || event.kind === 'runtime_failure');
  const contextPathValidationError = projectContextPathInputError(contextPath);
  const canAttemptContextDocument = contextPath.trim() !== '' && contextPathValidationError === null;
  const selectedBindingMismatch = selected !== null && (
    selected.projectId !== projectId
    || registeredRoot === null
    || selected.runtimeCwd !== registeredRoot
  );
  const activeCatalogLabel = selected === null
    ? null
    : catalogLabelForBinding(selected.binding.providerId, selected.binding.modelId);

  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">Sessions · {projectName}</h2>
          <p className="mt-1 text-sm text-zinc-500">Persistent task continuity shared by OpenCode, Claude Code, Codex and Qwen Code.</p>
          {openCodeAvailability && <p className={`mt-1 text-xs ${openCodeAvailability.installed ? 'text-emerald-700' : 'text-amber-700'}`}>OpenCode: {openCodeAvailability.installed ? `available${openCodeAvailability.version ? ` · ${openCodeAvailability.version}` : ''}` : 'not detected'}</p>}
        </div>
        <button type="button" onClick={onClose} className="text-sm text-zinc-500 hover:text-zinc-700">Back</button>
      </div>

      {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {loading && <p className="text-sm text-zinc-500">Reconciling local sessions with the repository…</p>}

      {!loading && sessions.length === 0 && (
        <div className="rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
          No execution session exists yet. Compile a TaskSpec, then start it from the handoff flow.
        </div>
      )}

      {!loading && sessions.length > 0 && (
        <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
          <div className="space-y-2">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => void select(session.id)}
                className={`w-full rounded-md border p-3 text-left text-xs ${selected?.id === session.id ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 bg-white'}`}
              >
                <span className="block font-medium">{session.runtime === 'opencode' ? 'OpenCode' : session.runtime}</span>
                <span className="mt-1 block text-zinc-500">{session.status}</span>
                <span className="mt-1 block font-mono text-[10px] text-zinc-400">{session.id.slice(0, 24)}</span>
              </button>
            ))}
          </div>

          {selected && (
            <div className="space-y-4 rounded-md border border-zinc-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{selected.state.objective || 'Recovered task session'}</p>
                  <p className="mt-1 text-xs text-zinc-500">{selected.status} · model {selected.binding.modelId ?? 'runtime default'} · started {selected.startedAt.slice(0, 16).replace('T', ' ')}</p>
                  <p className="mt-1 text-xs text-zinc-500">Registered project root: <code className="font-mono text-zinc-700">{registeredRoot ?? 'not resolved'}</code></p>
                  <p className="mt-1 text-xs text-zinc-500">Persisted runtime cwd: <code className="font-mono text-zinc-700">{selected.runtimeCwd ?? 'not bound'}</code></p>
                </div>
                <div className="flex gap-1">
                  {runtimes.map((runtime) => (
                    <button key={runtime} type="button" onClick={() => void switchRuntime(runtime)} className={`rounded border px-2 py-1 text-[11px] ${selected.runtime === runtime ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300'}`}>
                      {runtime === 'opencode' ? 'OpenCode' : runtime === 'claude-code' ? 'Claude' : runtime === 'qwen-code' ? 'Qwen' : 'Codex'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-indigo-100 bg-indigo-50/50 p-3">
                <label htmlFor="session-model" className="text-xs font-medium text-indigo-950">Session model</label>
                <select
                  id="session-model"
                  value={activeCatalogLabel ? MODEL_CATALOG.find((model) => model.displayName === activeCatalogLabel)?.id ?? '' : ''}
                  onChange={(event) => void chooseSessionModel(event.target.value)}
                  className="mt-1 block w-full rounded border border-indigo-200 bg-white px-2 py-1.5 text-xs"
                >
                  <option value="">Choose a model…</option>
                  {MODEL_CATALOG.map((model) => {
                    const configured = resolveCatalogModel(model.id, providerProfiles).ok;
                    return <option key={model.id} value={model.id}>{model.displayName}{configured ? '' : ' · configuration required'}</option>;
                  })}
                </select>
                <p className="mt-1 text-[11px] text-indigo-800">Explicit model switching preserves this session, TaskSpec, context and checkpoint.</p>
              </div>

              {selected.runtime === 'opencode' && (
                <div className="rounded-md border border-indigo-100 bg-indigo-50/50 p-3">
                  <p className="text-xs font-medium text-indigo-950">OpenCode availability</p>
                  {openCodeModels?.warning && <p className="mt-1 text-[11px] text-amber-700">{openCodeModels.warning}</p>}
                  <p className="mt-1 text-[11px] text-indigo-800">Provider credentials remain in OpenCode; PromptForge stores only this model binding.</p>
                </div>
              )}

              {selectedBindingMismatch && (
                <p className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">
                  Session/project mismatch. Start and Resume are blocked; PromptForge will not rebind this session automatically.
                </p>
              )}

              <div className="flex gap-2">
                <button type="button" onClick={() => void copy()} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white">Copy continuation</button>
                <button type="button" onClick={() => void connectVscode()} className="rounded-md border border-blue-300 px-3 py-1.5 text-xs text-blue-700">Open VS Code</button>
                <button type="button" onClick={() => void launchOpenCode('start')} disabled={!openCodeAvailability?.installed || selectedBindingMismatch} className="rounded-md border border-indigo-300 px-3 py-1.5 text-xs text-indigo-700 disabled:opacity-50">Start task in OpenCode</button>
                <button type="button" onClick={() => void launchOpenCode('resume')} disabled={!openCodeAvailability?.installed || selectedBindingMismatch} className="rounded-md border border-indigo-300 px-3 py-1.5 text-xs text-indigo-700 disabled:opacity-50">Resume task in OpenCode</button>
                <button type="button" onClick={() => void finish('paused')} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs">Pause</button>
                <button type="button" onClick={() => void finish('completed')} disabled={verifying} className="rounded-md border border-emerald-300 px-3 py-1.5 text-xs text-emerald-700 disabled:opacity-50">{verifying ? 'Verifying…' : 'Verify & complete'}</button>
              </div>

              {verification && (
                <div className={`rounded border p-3 text-xs ${verification.outcome.status === 'READY' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`} role="status">
                  <p className="font-medium">Completion outcome: {verification.outcome.status}</p>
                  {verification.visualReview.evidence && <p className="mt-1">Visual review: {verification.visualReview.evidence.status} · {verification.visualReview.evidence.evidence}</p>}
                  {verification.outcome.unresolvedCritical.length > 0 && <p className="mt-1">Unresolved verification: {verification.outcome.unresolvedCritical.join(' · ')}</p>}
                  {verification.outcome.pendingHumanReview.length > 0 && <p className="mt-1">Human review: {verification.outcome.pendingHumanReview.join(' · ')}</p>}
                </div>
              )}

              {(launchFeedback || latestLaunchEvent) && (
                <p className={`rounded border p-2 text-xs ${launchFeedback?.startsWith('FAILED') || latestLaunchEvent?.kind === 'runtime_failure' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`} role="status">
                  {launchFeedback ?? `${latestLaunchEvent?.kind === 'runtime_launch' ? 'STARTED' : 'FAILED'}: ${latestLaunchEvent?.content}`}
                </p>
              )}

              {vscodeConnection && (
                <details className="rounded-md border border-blue-200 bg-blue-50 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-blue-900">VS Code launch result</summary>
                  <p className="mt-2 break-all font-mono text-[10px] text-blue-800">{vscodeConnection}</p>
                </details>
              )}

              {vscodeStatus === 'unavailable' && (
                <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800" role="status">
                  VS Code read-model integration is unavailable. PromptForge core sessions and handoff remain usable.
                </p>
              )}

              <div className="rounded-md border border-sky-100 bg-sky-50/50 p-3">
                <p className="text-xs font-medium text-sky-950">Project context documents</p>
                <p className="mt-1 text-[11px] text-sky-800">Selected repository files are read-only references. Paths are stored relative to the registered project.</p>
                <div className="mt-2 flex gap-2">
                  <input value={contextPath} onChange={(event) => { const value = event.target.value; setContextPath(value); setContextError(projectContextPathInputError(value)); }} className="min-w-0 flex-1 rounded border border-sky-200 bg-white px-2 py-1.5 text-xs" placeholder="docs/offerpath-v2/offerpath-source-of-truth.md" aria-label="Project context document path" />
                  <button type="button" onClick={() => void addContextDocument()} disabled={!canAttemptContextDocument} className="rounded border border-sky-300 px-2 py-1 text-xs text-sky-800 disabled:opacity-50">Add document</button>
                </div>
                {(contextError ?? contextPathValidationError) && <p className="mt-2 text-[11px] text-red-700" role="alert">{contextError ?? contextPathValidationError}</p>}
                <div className="mt-2 space-y-1 text-xs text-sky-900">
                  {contextDocs.length === 0 && <p className="text-sky-700">No project context documents selected.</p>}
                  {contextDocs.map((path) => <div key={path} className="flex items-center justify-between gap-2"><code>{path}</code><button type="button" onClick={() => void removeContextDocument(path)} className="text-[11px] text-red-700">Remove</button></div>)}
                </div>
              </div>

              <div className="grid gap-2 rounded-md border border-amber-100 bg-amber-50/50 p-3">
                <label htmlFor="new-instruction" className="text-xs font-medium text-amber-950">New instruction</label>
                <textarea id="new-instruction" value={newInstruction} onChange={(event) => setNewInstruction(event.target.value)} rows={4} className="rounded border border-amber-200 bg-white px-2 py-1.5 text-xs" placeholder="What should OpenCode do next?" />
                <p className="text-[11px] text-amber-800">This is the next task input. It stays separate from checkpoint knowledge and is preserved if launch fails.</p>
              </div>

              <div className="grid gap-2">
                <label htmlFor="session-note" className="text-xs font-medium">Add local checkpoint knowledge</label>
                <textarea id="session-note" value={note} onChange={(event) => { setNote(event.target.value); setCheckpointError(null); }} rows={2} className="rounded border border-zinc-300 px-2 py-1.5 text-xs" placeholder="What did the runtime observe or validate?" />
                {checkpointError && <p className="text-[11px] text-red-700" role="alert">{checkpointError}</p>}
                <button type="button" onClick={() => void saveNote()} disabled={note.trim() === '' || savingNote} className="w-fit rounded border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50">{savingNote ? 'Saving checkpoint…' : 'Save checkpoint'}</button>
              </div>

              <details open className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <summary className="cursor-pointer text-xs font-medium">Canonical continuation prompt</summary>
                <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap text-[11px] text-zinc-700">{prompt}</pre>
              </details>

              <details className="rounded-md border border-zinc-200 p-3">
                <summary className="cursor-pointer text-xs font-medium">Session knowledge ({events.length} events)</summary>
                <div className="mt-2 space-y-2 text-xs text-zinc-600">
                  {events.map((event) => <p key={event.id}><span className="font-medium">{event.kind}</span>: {event.content}</p>)}
                </div>
              </details>
            </div>
          )}
        </div>
      )}

      <details className="rounded-md border border-zinc-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium">Rules & skills visible to this project</summary>
        <p className="mt-1 text-xs text-zinc-500">Read-only inventory. PromptForge does not overwrite or execute these files.</p>
        <div className="mt-3 grid gap-1 text-xs text-zinc-600">
          {guidance.length === 0 && <span>No project rules or skills directories found.</span>}
          {guidance.map((entry) => <span key={`${entry.kind}:${entry.path}`}><span className="mr-2 rounded bg-zinc-100 px-1.5 py-0.5">{entry.kind}</span>{entry.path}</span>)}
        </div>
      </details>
    </section>
  );
}
