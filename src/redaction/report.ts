/**
 * Redaction report (Phase 5, SECURITY.md §3.2 rule 3).
 *
 * Every match produces a RedactionReport entry: file, line number, class.
 * The report MUST NEVER contain the matched secret itself.
 * The report is user-visible — explain every action taken.
 */

export interface RedactionEntry {
  /** File name or source identifier (e.g. "raw_request", "context/PRODUCT.md"). */
  file: string;
  /** 1-indexed line number where the match occurred. */
  line: number;
  /** Pattern class (e.g. "aws-access-key", "jwt"). */
  class: string;
}

export interface EntropyWarning {
  /** File or source identifier. */
  file: string;
  /** 1-indexed line number. */
  line: number;
  /** The high-entropy string (truncated for display, never the full value). */
  snippet: string;
}

export interface RedactionReport {
  /** When the redaction was performed. */
  timestamp: string;
  /** Total number of secrets redacted. */
  totalRedacted: number;
  /** Per-match details (class + location only, never the secret). */
  entries: RedactionEntry[];
  /** High-entropy strings that matched no pattern (flagged, not blocked). */
  entropyWarnings: EntropyWarning[];
  /** Summary message for the UI. */
  summary: string;
}

/** Create an empty report. */
export function emptyReport(): RedactionReport {
  return {
    timestamp: new Date().toISOString(),
    totalRedacted: 0,
    entries: [],
    entropyWarnings: [],
    summary: '',
  };
}

/** Finalise a report with a summary string. */
export function finaliseReport(
  report: RedactionReport,
): RedactionReport {
  const parts: string[] = [];
  if (report.totalRedacted > 0) {
    parts.push(
      `${report.totalRedacted} secret${report.totalRedacted > 1 ? 's' : ''} redacted`,
    );
  }
  if (report.entropyWarnings.length > 0) {
    parts.push(
      `${report.entropyWarnings.length} high-entropy warning${report.entropyWarnings.length > 1 ? 's' : ''}`,
    );
  }
  if (parts.length === 0) {
    parts.push('No secrets or entropy warnings detected.');
  }
  return { ...report, summary: parts.join('; ') };
}
