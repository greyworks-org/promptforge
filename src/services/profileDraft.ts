import { invokeIpc } from '../ipc';
import type { ChatOutcome } from './providerService';
import type { ProviderProfile } from '../schemas/providerProfile';
import { keychainAccountFor } from '../schemas/providerProfile';

/**
 * Profile drafting service (Phase 3).
 *
 * Uses the configured provider to draft context documents from scan results.
 * The draft is editable in the wizard before any file is written.
 *
 * Draft quality varies; the user always reviews and edits before consent.
 */

export interface DraftRequest {
  projectName: string;
  readmePreview: string | null;
  identityFiles: Array<{ relPath: string; preview: string | null }>;
  techIndicators: Array<{ relPath: string; preview: string | null }>;
}

export interface DraftResult {
  /** Suggested project name (may differ from folder basename). */
  suggestedName: string;
  /** Brief project summary (1-3 sentences). */
  summary: string;
  /** Detected tech stack items. */
  detectedStack: string[];
  /** Draft content for each context doc filename. */
  contextDocs: Record<string, string>;
}

function buildDraftPrompt(req: DraftRequest): string {
  const parts: string[] = [
    `You are analyzing a software project to create onboarding documentation.`,
    ``,
    `Project folder name: ${req.projectName}`,
    ``,
  ];

  if (req.readmePreview) {
    parts.push(`README preview:`, '```', req.readmePreview.slice(0, 2000), '```', '');
  }

  if (req.identityFiles.length > 0) {
    parts.push(`Key project files found:`);
    for (const f of req.identityFiles) {
      parts.push(`- ${f.relPath}`);
    }
    parts.push('');
  }

  if (req.techIndicators.length > 0) {
    parts.push(`Technology indicators:`);
    for (const f of req.techIndicators) {
      parts.push(`- ${f.relPath}`);
    }
    parts.push('');
  }

  parts.push(
    `Return a JSON object with these fields:`,
    `- suggestedName: a short, readable project name`,
    `- summary: 1-3 sentence description of the project`,
    `- detectedStack: array of detected languages/frameworks/tools`,
    `- contextDocs: object mapping these filenames to draft Markdown content:`,
    `  PRODUCT, ARCHITECTURE, DESIGN, DATA_MODEL, INTEGRATIONS, SECURITY, TESTING, DECISIONS, CURRENT_STATE, BACKLOG`,
    ``,
    `For each context doc, write a reasonable starting draft based on what`,
    `you can infer. Use placeholder text like "[Add your ...]" for sections`,
    `where you lack information. Never invent facts. Keep each doc under`,
    `500 words.`,
    ``,
    `Return ONLY valid JSON, no explanation.`,
  );

  return parts.join('\n');
}

const DRAFT_TEMPERATURE = 0.3;
const DRAFT_MAX_TOKENS = 4096;

export async function draftProjectProfile(
  profile: ProviderProfile,
  request: DraftRequest,
): Promise<DraftResult> {
  const messages = [{ role: 'user' as const, content: buildDraftPrompt(request) }];

  const outcome = await invokeIpc<ChatOutcome>('provider_chat', {
    baseUrl: profile.baseUrl,
    modelId: profile.modelId,
    keychainAccount: keychainAccountFor(profile.id),
    messages,
    temperature: DRAFT_TEMPERATURE,
    maxTokens: DRAFT_MAX_TOKENS,
    timeoutMs: profile.params.timeoutMs,
    jsonMode: profile.capabilities.jsonMode === 'on' ? 'on' : 'off',
  });

  const body = JSON.parse(outcome.body) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawContent = body.choices?.[0]?.message?.content;
  if (typeof rawContent !== 'string' || rawContent.length === 0) {
    throw new Error('Provider returned empty response for profile draft.');
  }

  // Extract JSON from the response (may be wrapped in fences).
  let jsonText = rawContent.trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonText = fenceMatch[1].trim();

  const parsed = JSON.parse(jsonText) as Record<string, unknown>;

  if (typeof parsed.suggestedName !== 'string' || typeof parsed.summary !== 'string') {
    throw new Error('Profile draft response missing required fields.');
  }

  return {
    suggestedName: parsed.suggestedName as string,
    summary: parsed.summary as string,
    detectedStack: Array.isArray(parsed.detectedStack)
      ? (parsed.detectedStack as string[])
      : [],
    contextDocs: (typeof parsed.contextDocs === 'object' && parsed.contextDocs !== null
      ? parsed.contextDocs as Record<string, string>
      : {}),
  };
}

/** Estimate tokens in a text using a simple word-based heuristic. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}
