import { useState, useEffect, useCallback } from 'react';
import type { CompilationRecord } from '../db/repos/compilations';
import type { OutcomeRecord } from '../db/repos/outcomes';
import type { ProjectUsage, RuntimeUsage } from '../services/usageService';
import { OutcomeDialog } from '../components/OutcomeDialog';

/**
 * History screen (Phase 8).
 *
 * Shows compilation history for the active project with pagination,
 * usage aggregates, and per-compilation outcome recording.
 */

export interface HistoryScreenProps {
  projectId: string;
  deps?: {
    listHistory?: (projectId: string, limit: number, offset: number) => Promise<CompilationRecord[]>;
    getOutcome?: (compilationId: string) => Promise<OutcomeRecord | null>;
    saveOutcome?: (outcome: OutcomeRecord) => Promise<void>;
    getUsage?: (projectId: string) => Promise<ProjectUsage>;
    getRuntimeUsage?: (projectId: string) => Promise<RuntimeUsage[]>;
  };
}

export function HistoryScreen({ projectId, deps }: HistoryScreenProps) {
  const [history, setHistory] = useState<CompilationRecord[]>([]);
  const [usage, setUsage] = useState<ProjectUsage | null>(null);
  const [runtimeUsage, setRuntimeUsage] = useState<RuntimeUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const [existingOutcome, setExistingOutcome] = useState<OutcomeRecord | null>(null);
  const [outcomes, setOutcomes] = useState<Map<string, OutcomeRecord>>(new Map());

  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    if (!deps?.listHistory) return;
    setLoading(true);
    const h = await deps.listHistory(projectId, PAGE_SIZE, page * PAGE_SIZE);
    setHistory(h);
    if (deps.getUsage) setUsage(await deps.getUsage(projectId));
    if (deps.getRuntimeUsage) setRuntimeUsage(await deps.getRuntimeUsage(projectId));
    // Load outcomes for visible history rows.
    if (deps.getOutcome) {
      const map = new Map<string, OutcomeRecord>();
      for (const c of h) {
        const o = await deps.getOutcome(c.id);
        if (o) map.set(c.id, o);
      }
      setOutcomes(map);
    }
    setLoading(false);
  }, [projectId, page, deps]);

  useEffect(() => { load(); }, [load]);

  const openOutcome = async (compId: string) => {
    setOutcomeFor(compId);
    if (deps?.getOutcome) {
      setExistingOutcome(await deps.getOutcome(compId));
    }
  };

  const handleSaveOutcome = async (o: OutcomeRecord) => {
    if (deps?.saveOutcome) {
      await deps.saveOutcome(o);
      setOutcomeFor(null);
      load();
    }
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      done: 'bg-green-100 text-green-700',
      failed: 'bg-red-100 text-red-700',
      awaiting_answers: 'bg-amber-100 text-amber-700',
      compiling: 'bg-blue-100 text-blue-700',
    };
    return `rounded px-1.5 py-0.5 text-xs font-medium ${map[s] ?? 'bg-zinc-100 text-zinc-600'}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">History</h2>
        <p className="mt-1 text-sm text-zinc-500">Compilation history for this project.</p>
      </div>

      {/* Usage summary */}
      {usage && (
        <div className="grid grid-cols-4 gap-3 text-sm">
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-center">
            <p className="text-lg font-semibold">{usage.totalCompilations}</p>
            <p className="text-xs text-zinc-500">total</p>
          </div>
          <div className="rounded-md border border-green-200 bg-green-50 p-3 text-center">
            <p className="text-lg font-semibold text-green-700">{usage.successCount}</p>
            <p className="text-xs text-green-600">success</p>
          </div>
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-center">
            <p className="text-lg font-semibold text-red-700">{usage.failureCount}</p>
            <p className="text-xs text-red-600">failed</p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-center">
            <p className="text-lg font-semibold">
              {usage.avgDurationMs !== null ? `${Math.round(usage.avgDurationMs / 1000)}s` : '—'}
            </p>
            <p className="text-xs text-zinc-500">avg duration</p>
          </div>
        </div>
      )}

      {/* Runtime breakdown */}
      {runtimeUsage.length > 0 && (
        <div className="flex gap-2 text-xs">
          {runtimeUsage.map((r) => (
            <span key={r.agentRuntime} className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600">
              {r.agentRuntime}: {r.count}
            </span>
          ))}
        </div>
      )}

      {/* Token estimates label */}
      <p className="text-xs text-zinc-400">
        Token counts from API responses are marked with ⓘ. All other token counts are local estimates.
      </p>

      {/* History list */}
      {loading && <p className="text-sm text-zinc-500">Loading…</p>}

      {!loading && history.length === 0 && (
        <p className="text-sm text-zinc-500">No compilations yet.</p>
      )}

      {history.map((c) => (
        <div key={c.id} className="rounded-md border border-zinc-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-zinc-400">{c.id}</span>
            <div className="flex items-center gap-2">
              <span className={statusBadge(c.status)}>{c.status}</span>
              {outcomes.get(c.id) && (
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                  outcomes.get(c.id)!.completionResult === 'success' ? 'bg-green-100 text-green-700' :
                  outcomes.get(c.id)!.completionResult === 'failure' ? 'bg-red-100 text-red-700' :
                  'bg-amber-100 text-amber-700'
                }`}>
                  {outcomes.get(c.id)!.completionResult}
                </span>
              )}
              <span className="text-xs text-zinc-400">{c.createdAt.slice(0, 16).replace('T', ' ')}</span>
            </div>
          </div>
          <p className="mt-1 text-sm text-zinc-700">{c.rawRequest.slice(0, 200)}</p>
          <div className="mt-2 flex items-center gap-3 text-xs text-zinc-400">
            <span>{c.taskType} · {c.executionMode}</span>
            {c.agentRuntime && <span>{c.agentRuntime}</span>}
            {c.error && <span className="text-red-500">{c.error.slice(0, 80)}</span>}
          </div>
          <button
            onClick={() => openOutcome(c.id)}
            className="mt-2 text-xs text-zinc-500 hover:text-zinc-700 underline">
            {outcomeFor === c.id ? 'Editing…' : 'Record outcome'}
          </button>

          {outcomeFor === c.id && (
            <div className="mt-3">
              <OutcomeDialog
                compilationId={c.id}
                existing={existingOutcome}
                onSave={handleSaveOutcome}
                onCancel={() => setOutcomeFor(null)}
              />
            </div>
          )}
        </div>
      ))}

      {/* Pagination */}
      {history.length >= PAGE_SIZE && (
        <div className="flex gap-2">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-zinc-300 px-3 py-1 text-sm disabled:opacity-30">
            Previous
          </button>
          <button onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-zinc-300 px-3 py-1 text-sm">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
