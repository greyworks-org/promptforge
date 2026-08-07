import {
  SECRET_PATTERNS,
  isHighEntropy,
  type SecretPattern,
} from './patterns';
import {
  emptyReport,
  finaliseReport,
  type RedactionReport,
  type RedactionEntry,
  type EntropyWarning,
} from './report';

/**
 * Redaction engine (Phase 5).
 *
 * Pure, deterministic function: same input → same output.
 * Applies all SECRET_PATTERNS to every line of the input text.
 * Produces redacted text + a RedactionReport (never containing secrets).
 *
 * Rules (SECURITY.md §3.2):
 * 1. Match → replace with `[REDACTED:<class>]`
 * 2. Whole-line patterns → entire line becomes `[REDACTED:<class>]`
 * 3. Report entries: file, line, class — never the secret
 * 4. High-entropy strings matching no class → flagged as warnings
 */

export interface RedactInput {
  /** Source identifier (e.g. "raw_request", "context/PRODUCT.md"). */
  source: string;
  /** The text to redact. */
  content: string;
}

export interface RedactOutput {
  /** Redacted text (safe to transmit). */
  redacted: string;
  /** Report of what was found (never contains secrets). */
  report: RedactionReport;
}

/**
 * Redact multiple inputs and combine the results.
 */
export function redactAll(inputs: RedactInput[]): RedactOutput[] {
  return inputs.map((input) => redactSingle(input));
}

/**
 * Redact a single input and merge the report into an accumulator.
 */
export function redactSingle(input: RedactInput): RedactOutput {
  const report = emptyReport();
  let redacted = input.content;

  for (const pattern of SECRET_PATTERNS) {
    const result = applyPattern(input.source, redacted, pattern);
    redacted = result.text;
    report.entries.push(...result.entries);
  }

  // High-entropy scan on the redacted output (so already-caught secrets
  // don't double-flag).
  const entropyResult = scanEntropy(input.source, redacted);
  report.entropyWarnings.push(...entropyResult);

  report.totalRedacted = report.entries.length;
  return { redacted, report: finaliseReport(report) };
}

interface PatternResult {
  text: string;
  entries: RedactionEntry[];
}

function applyPattern(
  source: string,
  text: string,
  pattern: SecretPattern,
): PatternResult {
  const entries: RedactionEntry[] = [];
  const lines = text.split('\n');
  const marker = `[REDACTED:${pattern.class}]`;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = pattern.regex.test(line);
    // Reset lastIndex since we used test() before potential global match.
    pattern.regex.lastIndex = 0;

    if (!match) continue;

    if (pattern.wholeLine) {
      if (pattern.multiLine && pattern.endMarker) {
        // Redact from BEGIN line through END line (inclusive).
        const endRx = pattern.endMarker;
        let endLine = i;
        for (let j = i; j < lines.length; j++) {
          endRx.lastIndex = 0;
          if (endRx.test(lines[j])) {
            endLine = j;
            break;
          }
        }
        for (let j = i; j <= endLine; j++) {
          lines[j] = marker;
          entries.push({ file: source, line: j + 1, class: pattern.class });
        }
        i = endLine; // skip past the block
      } else {
        lines[i] = marker;
        entries.push({ file: source, line: i + 1, class: pattern.class });
      }
    } else {
      // Replace every match on this line.
      let replaced = line;
      let lineMatch: RegExpExecArray | null;
      pattern.regex.lastIndex = 0;
      let matchCount = 0;

      // Collect all matches first to avoid infinite loops.
      const replacements: Array<{ start: number; end: number }> = [];
      while ((lineMatch = pattern.regex.exec(line)) !== null) {
        replacements.push({ start: lineMatch.index, end: lineMatch.index + lineMatch[0].length });
        matchCount++;
        if (!pattern.regex.global) break;
      }

      // Apply replacements from right to left so indices stay valid.
      for (let r = replacements.length - 1; r >= 0; r--) {
        const { start, end } = replacements[r];
        replaced = replaced.slice(0, start) + marker + replaced.slice(end);
      }

      lines[i] = replaced;
      for (let m = 0; m < matchCount; m++) {
        entries.push({ file: source, line: i + 1, class: pattern.class });
      }
    }
  }

  return { text: lines.join('\n'), entries };
}

/**
 * Scan for high-entropy strings that matched no secret pattern.
 * Returns warnings, never blocks.
 */
function scanEntropy(source: string, text: string): EntropyWarning[] {
  const warnings: EntropyWarning[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Find long alphanumeric/symbol runs.
    const tokens = line.match(/[A-Za-z0-9_\-./+=]{40,}/g);
    if (!tokens) continue;

    for (const token of tokens) {
      if (isHighEntropy(token)) {
        warnings.push({
          file: source,
          line: i + 1,
          snippet: token.length > 60
            ? `${token.slice(0, 30)}...${token.slice(-30)}`
            : token,
        });
      }
    }
  }

  return warnings;
}
