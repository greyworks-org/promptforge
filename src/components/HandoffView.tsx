import { useState, useEffect } from 'react';
import { getMemory } from '../services/memoryService';
import { getGitSnapshot } from '../services/gitState';
import { getCompilation } from '../services/historyService';
import { getProject } from '../services/projectsService';
import { refreshSemanticContextIfNeeded } from '../services/semanticContext';
import { assembleSnapshot } from '../handoff/snapshot';
import { classifyProgress } from '../handoff/progress';
import { renderHandoffClaudeCode } from '../handoff/renderClaudeCode';
import { renderHandoffQwenCode } from '../handoff/renderQwenCode';
import { renderHandoffCodex } from '../handoff/renderCodex';
import type { TaskSpec } from '../schemas/taskspec';
import type { CompilationRecord } from '../db/repos/compilations';
import type { HandoffSnapshot } from '../handoff/snapshot';
import { ensureExecutionSession } from '../sessions/executionSessionService';

export interface HandoffViewProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onSessions?: (projectId: string, projectName: string) => void;
}

type Runtime = 'claude-code' | 'qwen-code' | 'codex';

export function HandoffView({ projectId, projectName, onClose, onSessions }: HandoffViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<Runtime>('codex');
  const [output, setOutput] = useState<string>('');
  const [progressSummary, setProgressSummary] = useState<string>('');
  const [contextStatus, setContextStatus] = useState<string>('Updating project context…');
  const [snapshot, setSnapshot] = useState<HandoffSnapshot | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [project, initialMemory] = await Promise.all([
          getProject(projectId),
          getMemory(projectId),
        ]);
        if (cancelled) return;
        if (!project) throw new Error('The registered project could not be found.');
        let memory = initialMemory;
        const git = await getGitSnapshot(projectId, memory.semanticContext?.snapshot?.head_commit ?? undefined);

        // Retrieve active task from project memory + compilation history.
        let currentTask: TaskSpec | null = null;
        let currentCompilation: CompilationRecord | null = null;
        if (memory.currentTaskId) {
          try {
            const comp = await getCompilation(memory.currentTaskId);
            if (comp?.taskspecJson) {
              currentCompilation = comp;
              currentTask = JSON.parse(comp.taskspecJson) as TaskSpec;
            }
          } catch { /* task unavailable — continue without */ }
        }

        const refreshed = await refreshSemanticContextIfNeeded({
          projectId,
          repoPath: project.repoPath,
          memory,
          git,
          currentTask,
        });
        memory = refreshed.memory;
        if (refreshed.state === 'unavailable') {
          setContextStatus('Git state current · semantic context unavailable');
        } else {
          setContextStatus('Fresh');
        }

        const snap = assembleSnapshot({
          projectId,
          projectName,
          repoPath: project.repoPath,
          memory,
          git,
          currentTask,
          currentCompilation,
        });
        setSnapshot(snap);
        if (cancelled) return;

        const progress = classifyProgress(snap);
        const parts: string[] = [];
        if (git.isRepo) {
          parts.push(`HEAD ${git.head?.hash.slice(0, 8) ?? 'unknown'}`);
          const changed = git.uncommitted.staged.length + git.uncommitted.unstaged.length;
          if (changed > 0) parts.push(`${changed} file(s) modified`);
        } else {
          parts.push('(git unavailable — memory-only)');
        }
        if (progress.isInterrupted) parts.push('Uncommitted work detected.');
        if (progress.memoryMayBeStale) parts.push('Memory may be stale vs current HEAD.');
        if (memory.currentPhase) parts.push(`Phase: ${memory.currentPhase}`);
        setProgressSummary(parts.join(' · ') || 'Ready.');

        // Initial render.
        const rendered = renderHandoffCodex(snap);
        if (!cancelled) setOutput(rendered);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Handoff failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, projectName]);

  const handleRuntimeChange = (rt: Runtime) => {
    setRuntime(rt);
    // Re-render with same snapshot (memory + git are stale in closure but
    // sufficient for a quick switch — full refresh on effect re-run).
    // For the MVP flow, re-fetch.
    setLoading(true);
    (async () => {
      try {
        const [project, memory, git] = await Promise.all([
          getProject(projectId),
          getMemory(projectId),
          getGitSnapshot(projectId),
        ]);
        if (!project) throw new Error('The registered project could not be found.');
        let currentTask: TaskSpec | null = null;
        let currentCompilation: CompilationRecord | null = null;
        if (memory.currentTaskId) {
          const comp = await getCompilation(memory.currentTaskId);
          if (comp?.taskspecJson) {
            currentCompilation = comp;
            currentTask = JSON.parse(comp.taskspecJson) as TaskSpec;
          }
        }
        const snap = assembleSnapshot({ projectId, projectName, repoPath: project.repoPath, memory, git, currentTask, currentCompilation });
        const fn = rt === 'claude-code' ? renderHandoffClaudeCode
          : rt === 'qwen-code' ? renderHandoffQwenCode
          : renderHandoffCodex;
        setOutput(fn(snap));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Handoff failed.');
      } finally {
        setLoading(false);
      }
    })();
  };

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
      setSessionMessage(`Persistent session started (${session.id.slice(0, 20)}…).`);
    } catch (err) {
      setSessionMessage(err instanceof Error ? err.message : 'Could not start a persistent session.');
    }
  };

  const tabClass = (rt: Runtime) =>
    `rounded-t-md px-3 py-1.5 text-xs font-medium ${
      runtime === rt
        ? 'border-x border-t border-zinc-200 bg-white text-zinc-900'
        : 'text-zinc-500 hover:text-zinc-700'
    }`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Continue: {projectName}</h2>
          <p className="text-xs text-zinc-500">Context: {contextStatus} · {progressSummary}</p>
        </div>
        <button onClick={onClose} className="text-sm text-zinc-500 hover:text-zinc-700">
          Close
        </button>
      </div>

      {loading && <p className="text-sm text-zinc-500">Loading project state…</p>}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {!loading && !error && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs">
            <span className="text-zinc-600">Session Core</span>
            {sessionId ? (
              <>
                <span className="text-emerald-700">Persistent session active.</span>
                {onSessions && <button type="button" onClick={() => onSessions(projectId, projectName)} className="underline">Open Sessions</button>}
              </>
            ) : (
              <button type="button" onClick={() => void startPersistentSession()} className="rounded border border-zinc-300 bg-white px-2 py-1 font-medium">Start persistent session</button>
            )}
            {sessionMessage && <span className="text-zinc-500">{sessionMessage}</span>}
          </div>
          <div className="flex gap-1 border-b border-zinc-200">
            {(['codex', 'claude-code', 'qwen-code'] as Runtime[]).map((rt) => (
              <button key={rt} onClick={() => handleRuntimeChange(rt)} className={tabClass(rt)}>
                {rt === 'claude-code' ? 'Claude Code' : rt === 'qwen-code' ? 'Qwen Code' : 'Codex'}
              </button>
            ))}
          </div>
          <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-700 font-mono">
            {output}
          </pre>
        </>
      )}
    </div>
  );
}
