import { isBlockedFilePath } from '../redaction/blocklist';
import { redactAll, type RedactInput } from '../redaction/redact';
import type { RedactionReport } from '../redaction/report';
import { estimateTokens } from './tokenBudget';

/**
 * Payload assembly (Phase 5).
 *
 * The single entry point for building an outbound payload. Every call
 * path that sends content to a provider MUST go through this function.
 * Redaction is built-in — there is no bypass path.
 *
 * Blocked files are rejected before redaction. Secret patterns are
 * applied to every input. The returned payload is the exact text that
 * will be sent; the report describes every action taken.
 */

export interface PayloadInput {
  /** User's raw request text. */
  rawRequest: string;
  /** Selected context documents with their project-relative paths. */
  contextDocs: Array<{ relPath: string; content: string }>;
  /** Optional file attachments (descriptions only — actual binary data never sent). */
  attachments?: Array<{ relPath: string; description: string }>;
}

export interface AssembledPayload {
  /** The exact text that will be sent to the provider. */
  text: string;
  /** Estimated token count (chars/4 heuristic). */
  estTokens: number;
  /** Redaction report — describes every secret found and entropy flagged. */
  report: RedactionReport;
  /** Files that were blocked and excluded from the payload. */
  blockedFiles: string[];
  /** Whether the payload contains any content (false if everything was blocked). */
  hasContent: boolean;
}

/**
 * Assemble the final outbound payload. Blocked files are rejected;
 * all remaining content passes through the redaction engine.
 */
export function assemblePayload(input: PayloadInput): AssembledPayload {
  const blockedFiles: string[] = [];
  const redactInputs: RedactInput[] = [];

  // 1. Raw request — always included, always redacted.
  if (input.rawRequest.trim().length > 0) {
    redactInputs.push({ source: 'raw_request', content: input.rawRequest });
  }

  // 2. Context docs — blocklist check first, then redact.
  for (const doc of input.contextDocs) {
    if (isBlockedFilePath(doc.relPath)) {
      blockedFiles.push(doc.relPath);
      continue;
    }
    redactInputs.push({ source: doc.relPath, content: doc.content });
  }

  // 3. Attachment descriptions — blocklist check, then redact.
  if (input.attachments) {
    for (const att of input.attachments) {
      if (isBlockedFilePath(att.relPath)) {
        blockedFiles.push(att.relPath);
        continue;
      }
      if (att.description.trim().length > 0) {
        redactInputs.push({
          source: `attachment:${att.relPath}`,
          content: att.description,
        });
      }
    }
  }

  // 4. Run redaction.
  const outputs = redactAll(redactInputs);

  // 5. Merge results.
  const textParts: string[] = [];
  let totalEstTokens = 0;
  const mergedReport = outputs[0]?.report ?? {
    timestamp: new Date().toISOString(),
    totalRedacted: 0,
    entries: [],
    entropyWarnings: [],
    summary: 'No content to send.',
  };

  let allEntries = [...mergedReport.entries];
  let allWarnings = [...mergedReport.entropyWarnings];
  let totalRedacted = mergedReport.totalRedacted;

  for (const output of outputs) {
    textParts.push(output.redacted);
    totalEstTokens += estimateTokens(output.redacted);
    allEntries.push(...output.report.entries);
    allWarnings.push(...output.report.entropyWarnings);
    totalRedacted += output.report.totalRedacted;
  }

  const text = textParts.join('\n\n');
  const hasContent = text.trim().length > 0;

  return {
    text,
    estTokens: totalEstTokens,
    report: {
      timestamp: new Date().toISOString(),
      totalRedacted,
      entries: allEntries,
      entropyWarnings: allWarnings,
      summary: hasContent
        ? `Payload assembled: ${totalEstTokens} est tokens, ${totalRedacted} secret(s) redacted, ${blockedFiles.length} file(s) blocked.`
        : 'No content to send — everything was blocked or empty.',
    },
    blockedFiles,
    hasContent,
  };
}
