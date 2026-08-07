import type { AssembledPayload } from '../services/payloadAssembly';

/**
 * "Context sent" preview component (Phase 5).
 *
 * Shows the exact payload that will be sent to the provider before
 * transmission. The user must explicitly Cancel or Send.
 *
 * SECURITY.md §3.3 — this is the final gate before any compile call
 * leaves the machine.
 */

export interface ContextSentViewProps {
  payload: AssembledPayload;
  onSend: () => void;
  onCancel: () => void;
}

export function ContextSentView({ payload, onSend, onCancel }: ContextSentViewProps) {
  const { report, blockedFiles, hasContent, estTokens } = payload;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Context sent</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Review exactly what will be sent to the provider.
          No content leaves your machine without this preview.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-center">
          <p className="text-lg font-semibold text-zinc-900">{estTokens}</p>
          <p className="text-xs text-zinc-500">est tokens</p>
        </div>
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-center">
          <p className="text-lg font-semibold text-zinc-900">
            {report.totalRedacted}
          </p>
          <p className="text-xs text-zinc-500">secrets redacted</p>
        </div>
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-center">
          <p className="text-lg font-semibold text-zinc-900">
            {blockedFiles.length}
          </p>
          <p className="text-xs text-zinc-500">files blocked</p>
        </div>
      </div>

      {/* Blocked files */}
      {blockedFiles.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-800">Blocked files</p>
          <p className="mt-1 text-xs text-amber-700">
            These files match blocked patterns and were excluded from the
            payload:
          </p>
          <ul className="mt-1 list-disc list-inside text-xs text-amber-700 font-mono">
            {blockedFiles.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Redaction details */}
      {report.entries.length > 0 && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3">
          <p className="text-sm font-medium text-green-800">
            Redactions applied
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-green-700 font-mono">
            {report.entries.map((e, i) => (
              <li key={i}>
                {e.file}:{e.line} → [{e.class}]
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Entropy warnings */}
      {report.entropyWarnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-800">
            High-entropy content detected
          </p>
          <p className="mt-1 text-xs text-amber-700">
            The following look like secrets but matched no known pattern.
            They are included in the payload — verify they are safe to send.
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-amber-700 font-mono">
            {report.entropyWarnings.map((w, i) => (
              <li key={i}>
                {w.file}:{w.line} — {w.snippet}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Payload text preview */}
      <div>
        <h3 className="text-sm font-medium">Payload text</h3>
        <pre className="mt-1 max-h-64 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700 whitespace-pre-wrap">
          {hasContent ? payload.text : '(no content to send)'}
        </pre>
      </div>

      {/* Empty state */}
      {!hasContent && (
        <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center">
          <p className="text-sm text-zinc-500">
            No content to send. All inputs were blocked or empty.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onSend}
          disabled={!hasContent}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          Send
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
