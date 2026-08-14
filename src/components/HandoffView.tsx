import { useCallback, useEffect, useRef, useState } from 'react';
import { getMemory } from '../services/memoryService';
import { getGitSnapshot } from '../services/gitState';
import { getCompilationForProject } from '../services/historyService';
import { getProject } from '../services/projectsService';
import { refreshSemanticContextIfNeeded } from '../services/semanticContext';
import { inspectProjectGuidance } from '../services/projectGuidance';
import { listContextDocs } from '../services/contextService';
import { assembleSnapshot, type HandoffSnapshot } from '../handoff/snapshot';
import { classifyProgress } from '../handoff/progress';
import { renderHandoffClaudeCode } from '../handoff/renderClaudeCode';
import { renderHandoffQwenCode } from '../handoff/renderQwenCode';
import { renderHandoffCodex } from '../handoff/renderCodex';
import type { TaskSpec } from '../schemas/taskspec';
import type { CompilationRecord } from '../db/repos/compilations';
import { ensureExecutionSession } from '../sessions/executionSessionService';
import { deriveContinuationState } from '../handoff/continuationState';
import { deriveActiveSessionContinuation } from '../services/continuationRefresh';
import { replaceLiveGitSnapshot, repositoryFreshnessLabel } from '../services/projectFreshness';
import {
  bootstrapProjectIntelligence,
  getProjectIntelligence,
  recommendNextTask,
} from '../services/projectIntelligenceService';
import type { NextTaskRecommendation, ProjectIntelligence } from '../intelligence/types';

export interface HandoffViewProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onSessions?: (projectId: string, projectName: string) => void;
  /** Open the Compiler for this project, optionally with a prefilled intent. */
  onCompiler?: (projectId: string, prefill: string) => void;
}

type Runtime = 'claude-code' | 'qwen-code' | 'codex';

function runtimeLabel(runtime: string): string {
  return runtime === 'claude-code' ? 'Claude Code' : runtime === 'qwen-code' ? 'Qwen Code' : 'Codex';
}

function renderForRuntime(runtime: Runtime, snapshot: HandoffSnapshot): string {
  return runtime === 'claude-code'
    ? renderHandoffClaudeCode(snapshot)
    : runtime === 'qwen-code'
      ? renderHandoffQwenCode(snapshot)
      : renderHandoffCodex(snapshot);
}

export function HandoffView({ projectId, projectName, onClose, onSessions, onCompiler }: HandoffViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<Runtime>('codex');
  const [output, setOutput] = useState('');
  const [progressSummary, setProgressSummary] = useState('');
  const [contextStatus, setContextStatus] = useState('Loading project context…');
  const [snapshot, setSnapshot] = useState<HandoffSnapshot | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [intelligence, setIntelligence] = useState<ProjectIntelligence | null>(null);
  const [recommendation, setRecommendation] = useState<NextTaskRecommendation | null>(null);
  const [intelligenceBusy, setIntelligenceBusy] = useState(false);
  const [intelligenceMessage, setIntelligenceMessage] = useState<string | null>(null);
  const runtimeRef = useRef(runtime);
  const requestRef = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => { runtimeRef.current = runtime; }, [runtime]);

  const updateDisplayedSnapshot = useCallback((next: HandoffSnapshot) => {
    setSnapshot(next);
    const progress = classifyProgress(next);
    const parts: string[] = [repositoryFreshnessLabel(next.git)];
    if (progress.isInterrupted) parts.push('Uncommitted work detected');
    if (progress.memoryMayBeStale) parts.push('Memory differs from current HEAD');
    if (next.memory.currentPhase) parts.push(`Phase: ${next.memory.currentPhase}`);
    setProgressSummary(parts.join(' · '));
    setOutput(renderForRuntime(runtimeRef.current, next));
  }, []);

  const refresh = useCallback(async (showLoading: boolean) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    const requestId = ++requestRef.current;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [project, initialMemory] = await Promise.all([getProject(projectId), getMemory(projectId)]);
      if (!project) throw new Error('The registered project could not be found.');
      let memory = initialMemory;
      const git = await getGitSnapshot(projectId, memory.semanticContext?.snapshot?.head_commit ?? undefined);

      let currentTask: TaskSpec | null = null;
      let currentCompilation: CompilationRecord | null = null;
      if (memory.currentTaskId) {
        try {
          const comp = await getCompilationForProject(projectId, memory.currentTaskId);
          if (comp?.taskspecJson) {
            currentCompilation = comp;
            currentTask = JSON.parse(comp.taskspecJson) as TaskSpec;
          }
        } catch {
          // A missing historical task should not hide current repository state.
        }
      }

      const derivedFromSession = await deriveActiveSessionContinuation({ projectId, task: currentTask, compilation: currentCompilation, memory, git, runtime });
      const derived = derivedFromSession ?? deriveContinuationState({
        task: currentTask,
        session: null,
        events: [],
        memory,
        git,
        currentCompilationProvider: currentCompilation?.providerLabel ?? null,
        target: { runtime },
      });

      const liveSnapshot = assembleSnapshot({ projectId, projectName, repoPath: project.repoPath, memory, git, currentTask, currentCompilation, continuationState: derived });
      if (requestId !== requestRef.current) return;
      updateDisplayedSnapshot(liveSnapshot);

      const [contextDocs, guidance] = await Promise.all([
        listContextDocs(projectId),
        inspectProjectGuidance(projectId),
      ].map(async (promise) => {
        try { return { ok: true as const, value: await promise }; }
        catch (err) { return { ok: false as const, error: err }; }
      }));
      const contextParts: string[] = [];
      if (guidance.ok && guidance.value.length > 0) contextParts.push('Repository guidance available');
      if (!contextDocs.ok) contextParts.push('Project context could not be loaded');
      else if (contextDocs.value.length > 0) contextParts.push('Project context documents configured');
      else contextParts.push('No project context documents configured');
      setContextStatus(contextParts.join(' · '));

      const refreshed = await refreshSemanticContextIfNeeded({ projectId, repoPath: project.repoPath, memory, git, currentTask });
      memory = refreshed.memory;
      if (requestId !== requestRef.current) return;
      updateDisplayedSnapshot(replaceLiveGitSnapshot(
        assembleSnapshot({
          projectId, projectName, repoPath: project.repoPath, memory, git, currentTask, currentCompilation,
          continuationState: derivedFromSession ?? deriveContinuationState({
            task: currentTask, session: null, events: [], memory, git,
            currentCompilationProvider: currentCompilation?.providerLabel ?? null,
            target: { runtime },
          }),
        }),
        git,
      ));
    } catch (err) {
      if (requestId === requestRef.current) setError(err instanceof Error ? err.message : 'Project state could not be loaded.');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
      refreshingRef.current = false;
    }
  }, [projectId, projectName, runtime, updateDisplayedSnapshot]);

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => { void refresh(false); }, 1500);
    const onFocus = () => { void refresh(false); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      requestRef.current += 1;
    };
  }, [refresh]);

  // The persisted record is read without deriving; deriving is an explicit action.
  useEffect(() => {
    let cancelled = false;
    getProjectIntelligence(projectId)
      .then((record) => {
        if (cancelled) return;
        setIntelligence(record);
        setRecommendation(record?.recommendation ?? null);
      })
      .catch(() => { if (!cancelled) setIntelligence(null); });
    return () => { cancelled = true; };
  }, [projectId]);

  const runProjectIntelligence = async () => {
    setIntelligenceBusy(true);
    setIntelligenceMessage(null);
    try {
      const existed = intelligence !== null;
      const result = await bootstrapProjectIntelligence(projectId);
      setIntelligence(result.intelligence);
      setRecommendation(result.intelligence.recommendation);
      setIntelligenceMessage(existed
        ? 'Project intelligence reconciled with the current repository evidence.'
        : 'Project intelligence created from the current repository evidence.');
    } catch (err) {
      setIntelligenceMessage(err instanceof Error ? err.message : 'Project intelligence could not be derived.');
    } finally {
      setIntelligenceBusy(false);
    }
  };

  const loadRecommendation = async () => {
    setIntelligenceBusy(true);
    setIntelligenceMessage(null);
    try {
      const result = await recommendNextTask(projectId);
      setIntelligence(result.intelligence);
      setRecommendation(result.recommendation);
      if (result.recommendation === null) {
        setIntelligenceMessage('No next task can be recommended from the current evidence.');
      }
    } catch (err) {
      setIntelligenceMessage(err instanceof Error ? err.message : 'A next task could not be recommended.');
    } finally {
      setIntelligenceBusy(false);
    }
  };

  const handleRuntimeChange = (nextRuntime: Runtime) => {
    setRuntime(nextRuntime);
    runtimeRef.current = nextRuntime;
    if (snapshot) {
      const state = snapshot.continuationState
        ? { ...snapshot.continuationState, continueWith: { ...snapshot.continuationState.continueWith, runtime: nextRuntime } }
        : deriveContinuationState({
            task: snapshot.currentTask,
            session: null,
            events: [],
            memory: snapshot.memory,
            git: snapshot.git,
            currentCompilationProvider: snapshot.currentCompilation?.providerLabel ?? null,
            target: { runtime: nextRuntime, binding: { modelId: snapshot.currentTask?.target_model ?? null } },
          });
      setOutput(renderForRuntime(nextRuntime, { ...snapshot, continuationState: state }));
    }
  };

  // A completed task must not be replayed as ordinary resume work.
  const taskFinished = snapshot !== null
    && (snapshot.continuationState?.taskStatus === 'completed' || snapshot.currentTask === null);

  const startPersistentSession = async () => {
    if (!snapshot) return;
    try {
      const session = await ensureExecutionSession({
        projectId,
        runtime,
        task: snapshot.currentTask,
        compilation: snapshot.currentCompilation,
        memory: snapshot.memory,
        git: snapshot.git,
      });
      setSessionId(session.id);
      setSessionMessage('Session ready to resume.');
      void refresh(false);
    } catch (err) {
      setSessionMessage(err instanceof Error ? err.message : 'Could not start a session.');
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Continue</p>
          <h2 className="mt-1 text-xl font-semibold">{projectName}</h2>
          <p className="mt-2 text-sm text-zinc-600">{contextStatus}</p>
          <p className="mt-1 text-xs text-zinc-500">Repository freshness: {progressSummary || 'Checking…'}</p>
        </div>
        <button type="button" onClick={onClose} className="text-sm text-zinc-500 hover:text-zinc-700">Back</button>
      </div>

      {loading && <p className="text-sm text-zinc-500" role="status">Refreshing project state…</p>}
      {error && <div className="border-y border-red-200 py-3 text-sm text-red-700" role="alert">{error}</div>}

      {!error && snapshot && (
        <>
          <div className="border-y border-zinc-200 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Current task</p>
            <h3 className="mt-1 text-base font-semibold">{snapshot.currentTask?.objective ?? 'No active task'}</h3>
            <p className="mt-2 text-sm text-zinc-600">
              Status: {snapshot.continuationState?.taskStatus ?? (snapshot.currentTask ? 'active' : 'No task in progress')}
            </p>
            {snapshot.currentTask && (
              <>
                <p className="mt-1 text-xs text-zinc-500">
                  Last execution: {snapshot.continuationState?.lastExecution.runtime ? runtimeLabel(snapshot.continuationState.lastExecution.runtime) : 'Unknown runtime'} · {snapshot.continuationState?.lastExecution.modelRef ?? snapshot.continuationState?.lastExecution.modelId ?? 'model unknown'}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Continue with: {runtimeLabel(runtime)} · {snapshot.continuationState?.continueWith.modelRef ?? snapshot.continuationState?.continueWith.modelId ?? snapshot.currentTask.target_model}
                </p>
              </>
            )}
            {snapshot.continuationState && (
              <div className="mt-3 grid gap-2 text-xs text-zinc-600 md:grid-cols-3">
                <div><p className="font-medium text-zinc-800">Completed</p><p>{snapshot.continuationState.verifiedCompleted.join(' · ') || 'None recorded.'}</p></div>
                <div><p className="font-medium text-zinc-800">Remaining</p><p>{snapshot.continuationState.remaining.join(' · ') || 'None.'}</p></div>
                <div><p className="font-medium text-zinc-800">Next</p><p>{snapshot.continuationState.nextAction}</p></div>
              </div>
            )}
            {taskFinished ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-medium text-zinc-900">
                  {snapshot.currentTask ? 'Current task complete.' : 'No task in progress.'}
                </p>
                {recommendation !== null && (
                  <div className="text-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Recommended next task</p>
                    <p className="mt-1 text-zinc-800">{recommendation.intent}</p>
                    <p className="mt-1 text-xs text-zinc-500">Why: {recommendation.rationale}</p>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {recommendation !== null && onCompiler && (
                    <button type="button" onClick={() => onCompiler(projectId, recommendation.intent)} className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white">Start Recommended Task</button>
                  )}
                  {onCompiler && (
                    <button type="button" onClick={() => onCompiler(projectId, '')} className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                      {recommendation === null ? 'Start New Task' : 'Describe Something Else'}
                    </button>
                  )}
                  {recommendation === null && (
                    <button type="button" onClick={() => void loadRecommendation()} disabled={intelligenceBusy} className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
                      {intelligenceBusy ? 'Deriving…' : 'Recommend next task'}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {sessionId && onSessions ? (
                  <button type="button" onClick={() => onSessions(projectId, projectName)} className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white">Open Session</button>
                ) : (
                  <button type="button" onClick={() => void startPersistentSession()} className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white">Resume / Open Session</button>
                )}
                {sessionMessage && <span className="self-center text-xs text-zinc-500">{sessionMessage}</span>}
              </div>
            )}
          </div>

          <div className="border-b border-zinc-200 pb-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Project intelligence</p>
            <p className="mt-1 text-sm text-zinc-600">
              {intelligence === null
                ? 'Not derived yet for this project.'
                : `Derived ${intelligence.reconciledAt.slice(0, 10)} · ${intelligence.verifiedComplete.length} verified · ${intelligence.partial.length} unverified · ${intelligence.blocked.length} blocked · ${intelligence.unknowns.length} unknown`}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => void runProjectIntelligence()} disabled={intelligenceBusy} className="rounded border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
                {intelligenceBusy ? 'Working…' : intelligence === null ? 'Bootstrap project intelligence' : 'Reconcile project intelligence'}
              </button>
              {intelligenceMessage && <span className="self-center text-xs text-zinc-500">{intelligenceMessage}</span>}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Execution runtime</p>
            <div className="mt-2 flex gap-4 border-b border-zinc-200">
              {(['codex', 'claude-code', 'qwen-code'] as Runtime[]).map((candidate) => (
                <button key={candidate} type="button" onClick={() => handleRuntimeChange(candidate)} className={`border-b-2 px-1 py-2 text-sm ${runtime === candidate ? 'border-zinc-900 font-medium text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
                  {runtimeLabel(candidate)}
                </button>
              ))}
            </div>
          </div>

          <details className="border-t border-zinc-200 pt-4">
            <summary className="cursor-pointer text-sm font-medium">View continuation prompt</summary>
            <p className="mt-2 text-xs text-zinc-500">Generated for {runtimeLabel(runtime)}. The canonical prompt is assembled from this project&apos;s local state.</p>
            <pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap border-y border-zinc-200 py-4 text-xs text-zinc-700">{output}</pre>
          </details>
        </>
      )}
    </section>
  );
}
