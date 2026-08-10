import { useState, useEffect } from 'react';
import { getMemory } from '../services/memoryService';
import { getGitSnapshot } from '../services/gitState';
import { getCompilation } from '../services/historyService';
import { assembleSnapshot } from '../handoff/snapshot';
import { classifyProgress } from '../handoff/progress';
import { renderHandoffClaudeCode } from '../handoff/renderClaudeCode';
import { renderHandoffQwenCode } from '../handoff/renderQwenCode';
import { renderHandoffCodex } from '../handoff/renderCodex';
import type { TaskSpec } from '../schemas/taskspec';

export interface HandoffViewProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

type Runtime = 'claude-code' | 'qwen-code' | 'codex';

export function HandoffView({ projectId, projectName, onClose }: HandoffViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<Runtime>('codex');
  const [output, setOutput] = useState<string>('');
  const [progressSummary, setProgressSummary] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [memory, git] = await Promise.all([
          getMemory(projectId),
          getGitSnapshot(projectId),
        ]);
        if (cancelled) return;

        // Retrieve active task from project memory + compilation history.
        let currentTask: TaskSpec | null = null;
        if (memory.currentTaskId) {
          try {
            const comp = await getCompilation(memory.currentTaskId);
            if (comp?.taskspecJson) {
              currentTask = JSON.parse(comp.taskspecJson) as TaskSpec;
            }
          } catch { /* task unavailable — continue without */ }
        }

        const snap = assembleSnapshot({
          projectId,
          projectName,
          memory,
          git,
          currentTask,
        });
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
        const [memory, git] = await Promise.all([
          getMemory(projectId),
          getGitSnapshot(projectId),
        ]);
        const snap = assembleSnapshot({ projectId, projectName, memory, git, currentTask: null });
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
          <p className="text-xs text-zinc-500">{progressSummary}</p>
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
