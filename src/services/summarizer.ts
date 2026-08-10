import { invokeIpc } from '../ipc';
import type { ProviderProfile } from '../schemas/providerProfile';
import { keychainAccountFor } from '../schemas/providerProfile';
import { estimateTokens } from './tokenBudget';

/**
 * Context-document summarizer (Phase 4).
 *
 * Calls the configured provider to generate a 200–500 token summary
 * for a context document. Summaries are cached by content_hash —
 * unchanged files are never re-summarized.
 */

export interface SummarizeRequest {
  title: string;
  content: string;
  /** Existing summary hash — if unchanged, the summarizer skips the call. */
  existingContentHash?: string;
}

export interface SummarizeResult {
  summary: string;
  tags: string[];
  /** Estimated token count of the source document. */
  estTokens: number;
  /** SHA-256 hex of the source content (supplied by caller). */
  contentHash: string;
}

const SUMMARIZE_SYSTEM = `You are a project documentation analyst.
Given a context document from a software project, produce:
1. A 3–6 sentence summary (200–500 tokens estimated) covering what the
   document contains and why it matters to a coding agent.
2. 3–8 lowercase tags describing the document's domain.

Return ONLY valid JSON with fields "summary" (string) and "tags" (string array).
No explanation outside the JSON.`;

const SUMMARIZE_MAX_TOKENS = 600;

export async function summarizeDocument(
  profile: ProviderProfile,
  request: SummarizeRequest,
): Promise<SummarizeResult> {
  const prompt = [
    `Title: ${request.title}`,
    ``,
    `Content:`,
    request.content.slice(0, 8000),
  ].join('\n');

  const messages = [
    { role: 'system' as const, content: SUMMARIZE_SYSTEM },
    { role: 'user' as const, content: prompt },
  ];

  const outcome = await invokeIpc<{
    status: number;
    body: string;
    latencyMs: number;
  }>('provider_chat', {
    baseUrl: profile.baseUrl,
    modelId: profile.modelId,
    keychainAccount: keychainAccountFor(profile.id),
    messages,
    temperature: 0.2,
    maxTokens: SUMMARIZE_MAX_TOKENS,
    timeoutMs: profile.params.timeoutMs,
    jsonMode: 'on',
  });

  const body = JSON.parse(outcome.body) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawContent = body.choices?.[0]?.message?.content;
  if (typeof rawContent !== 'string' || rawContent.length === 0) {
    throw new Error('Summarizer returned empty response.');
  }

  let jsonText = rawContent.trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonText = fenceMatch[1].trim();

  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter((t): t is string => typeof t === 'string')
    : [];

  if (summary === '') {
    throw new Error('Summarizer returned empty summary.');
  }

  return {
    summary,
    tags,
    estTokens: estimateTokens(request.content),
    contentHash: request.existingContentHash ?? '',
  };
}
