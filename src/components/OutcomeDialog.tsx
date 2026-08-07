import { useState } from 'react';
import type { OutcomeRecord } from '../db/repos/outcomes';

/**
 * Outcome recording dialog (Phase 8, spec §14).
 *
 * Records completion result, revision count, scope violation,
 * tests passed, completion time, which runtime actually ran,
 * and user notes. Editable at any time.
 */

export interface OutcomeDialogProps {
  compilationId: string;
  existing?: OutcomeRecord | null;
  onSave: (outcome: OutcomeRecord) => void;
  onCancel: () => void;
}

export function OutcomeDialog({ compilationId, existing, onSave, onCancel }: OutcomeDialogProps) {
  const [result, setResult] = useState<string>(existing?.completionResult ?? 'success');
  const [revisions, setRevisions] = useState(existing?.revisionCount ?? 0);
  const [scopeViolation, setScopeViolation] = useState<number | null>(existing?.scopeViolation ?? null);
  const [testsPassed, setTestsPassed] = useState<number | null>(existing?.testsPassed ?? null);
  const [completionMin, setCompletionMin] = useState<number | null>(existing?.completionTimeMin ?? null);
  const [usedRuntime, setUsedRuntime] = useState(existing?.usedRuntime ?? '');
  const [note, setNote] = useState(existing?.userNote ?? '');

  const handleSave = () => {
    onSave({
      compilationId,
      completionResult: result as OutcomeRecord['completionResult'],
      revisionCount: revisions,
      scopeViolation,
      testsPassed,
      completionTimeMin: completionMin,
      usedRuntime: usedRuntime || null,
      userNote: note || null,
      recordedAt: new Date().toISOString(),
    });
  };

  const sel = 'rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm';

  return (
    <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">
        {existing ? 'Edit outcome' : 'Record outcome'}
      </h3>

      <label className="grid gap-1 text-sm">
        <span className="font-medium">Result</span>
        <select className={sel} value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="success">Success</option>
          <option value="partial">Partial</option>
          <option value="failure">Failure</option>
        </select>
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Revisions needed</span>
          <input type="number" min={0} className={sel} value={revisions}
            onChange={(e) => setRevisions(Number(e.target.value))} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Completion time (min)</span>
          <input type="number" min={0} className={sel}
            value={completionMin ?? ''} onChange={(e) => setCompletionMin(e.target.value ? Number(e.target.value) : null)} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Tests passed?</span>
          <select className={sel}
            value={testsPassed === null ? '' : String(testsPassed)}
            onChange={(e) => setTestsPassed(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Unknown</option>
            <option value="1">Yes</option>
            <option value="0">No</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Scope violation?</span>
          <select className={sel}
            value={scopeViolation === null ? '' : String(scopeViolation)}
            onChange={(e) => setScopeViolation(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Unknown</option>
            <option value="1">Yes</option>
            <option value="0">No</option>
          </select>
        </label>
      </div>

      <label className="grid gap-1 text-sm">
        <span className="font-medium">Runtime used</span>
        <select className={sel} value={usedRuntime} onChange={(e) => setUsedRuntime(e.target.value)}>
          <option value="">Unknown</option>
          <option value="claude-code">Claude Code</option>
          <option value="qwen-code">Qwen Code</option>
          <option value="codex">Codex</option>
        </select>
      </label>

      <label className="grid gap-1 text-sm">
        <span className="font-medium">Note</span>
        <textarea className={sel} rows={3} value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What worked, what didn't, what to watch for..." />
      </label>

      <div className="flex gap-3">
        <button onClick={handleSave}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
          Save
        </button>
        <button onClick={onCancel}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
