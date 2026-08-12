import { invokeIpc } from '../ipc';
import type { ChatOutcome } from './providerService';
import type { ProviderProfile } from '../schemas/providerProfile';
import { keychainAccountFor } from '../schemas/providerProfile';

export interface DraftRequest {
  projectName: string;
  readmePreview: string | null;
  identityFiles: Array<{ relPath: string; preview: string | null }>;
  techIndicators: Array<{ relPath: string; preview: string | null }>;
  /** Richer evidence available for existing projects. */
  existingProject?: {
    /** Existing documentation found in the repo (relevance-ordered). */
    existingDocs: Array<{ relPath: string; preview: string }>;
    /** Git HEAD subject + recent commit subjects. */
    recentHistory: string[];
    /** Whether uncommitted changes exist. */
    hasUncommitted: boolean;
    /** When uncommitted: diff stat + changed paths detail. */
    uncommittedDetail?: string;
  };
}

export interface DraftResult {
  suggestedName: string;
  summary: string;
  detectedStack: string[];
  contextDocs: Record<string, string>;
}

const DRAFT_OUTPUT_SCHEMA = `{
  "suggestedName": "string",
  "summary": "string (1-3 sentences describing what this project IS, based on evidence)",
  "detectedStack": ["string"],
  "contextDocs": {
    "PRODUCT.md": "string",
    "ARCHITECTURE.md": "string",
    "DESIGN.md": "string",
    "DATA_MODEL.md": "string",
    "INTEGRATIONS.md": "string",
    "SECURITY.md": "string",
    "TESTING.md": "string",
    "DECISIONS.md": "string",
    "CURRENT_STATE.md": "string",
    "BACKLOG.md": "string"
  }
}`;

const CONTEXT_DOC_KEYS = [
  'PRODUCT.md', 'ARCHITECTURE.md', 'DESIGN.md', 'DATA_MODEL.md',
  'INTEGRATIONS.md', 'SECURITY.md', 'TESTING.md', 'DECISIONS.md',
  'CURRENT_STATE.md', 'BACKLOG.md',
];

function buildDraftPrompt(req: DraftRequest): string {
  const hasHistory = req.existingProject && req.existingProject.recentHistory.length > 0;
  const hasDocs = req.existingProject && req.existingProject.existingDocs.length > 0;

  const parts: string[] = [];

  if (req.existingProject) {
    parts.push(`You are documenting an EXISTING software project. Your job is to describe what IS, not what should be.`);
    parts.push(`Use evidence precedence: current implementation > recent project state/docs > recent decisions > older plans > inference.`);
    parts.push(`When sources conflict, preserve the evolution: original intent → current implementation → current direction.`);
    parts.push(`If you must infer something, label it as "[Inferred: ...]" — never present inference as confirmed fact.`);
  } else {
    parts.push(`You are analyzing a NEW software project to create onboarding documentation.`);
  }
  parts.push('');

  parts.push(`Project folder: ${req.projectName}`);
  parts.push('');

  // Evidence.
  if (req.readmePreview) {
    parts.push(`README (first 1000 chars):`, '```', req.readmePreview.slice(0, 1000), '```', '');
  }

  if (req.identityFiles.length > 0) {
    parts.push(`Project identity files:`);
    for (const f of req.identityFiles) parts.push(`- ${f.relPath}`);
    parts.push('');
  }

  if (req.techIndicators.length > 0) {
    parts.push(`Technology indicators (up to 25):`);
    for (const f of req.techIndicators.slice(0, 25)) parts.push(`- ${f.relPath}`);
    parts.push('');
  }

  if (hasHistory) {
    parts.push(`Recent git history (newest first):`);
    for (const h of req.existingProject!.recentHistory) parts.push(`- ${h}`);
    parts.push('');
  }

  if (req.existingProject?.hasUncommitted) {
    const detail = req.existingProject.uncommittedDetail || 'uncommitted changes exist';
    parts.push(`Uncommitted changes: ${detail}. Active development may be in progress.`);
    parts.push('');
  }

  if (hasDocs) {
    parts.push(`Existing project documentation found:`);
    for (const d of req.existingProject!.existingDocs) {
      parts.push(`--- ${d.relPath} ---`);
      parts.push(d.preview.slice(0, 600));
      parts.push('');
    }
  }

  // Per-doc guidance — adaptive to evidence availability.
  const hasRichEvidence = (req.techIndicators?.length ?? 0) > 5;
  const maxWords = hasRichEvidence ? 250 : 150;

  parts.push(`For each context doc:`);
  parts.push(`- CURRENT_STATE.md: what exists NOW. Active implementation area.`);
  parts.push(`  Relevant files/modules. Incomplete/in-progress work if evidenced.`);
  parts.push(`  Blockers or unresolved state when evidenced.`);
  parts.push(`- DECISIONS.md: meaningful architectural/product decisions supported`);
  parts.push(`  by repo evidence. Changes from earlier approaches. No inventions.`);
  parts.push(`- BACKLOG.md: remaining work from TODOs, incomplete flows, explicit docs,`);
  parts.push(`  or current implementation gaps. No speculative features.`);
  parts.push(`- Other docs: describe the CURRENT implementation, not best practices.`);
  parts.push(`  Preserve useful original intent where still relevant.`);
  parts.push(`- Placeholder "[Add X]" only where no evidence exists.`);
  parts.push(`  Keep each doc under ${maxWords} words.`);

  parts.push('');
  parts.push(`Return ONLY valid JSON matching the schema. No other text.`);

  return parts.join('\n');
}

const DRAFT_TEMPERATURE = 0.3;
const DRAFT_MAX_TOKENS = 3072;

function extractJson(rawContent: string): Record<string, unknown> | null {
  let jsonText = rawContent.trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonText = fenceMatch[1].trim();
  const firstBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonText = jsonText.slice(firstBrace, lastBrace + 1);
  }
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return null;
  } catch { return null; }
}

function parseDraftResponse(raw: Record<string, unknown>): { ok: true; result: DraftResult } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  if (typeof raw.suggestedName !== 'string' || raw.suggestedName.length === 0) missing.push('suggestedName');
  if (typeof raw.summary !== 'string' || raw.summary.length === 0) missing.push('summary');
  const detectedStack: string[] = [];
  if (Array.isArray(raw.detectedStack)) {
    for (const item of raw.detectedStack) { if (typeof item === 'string') detectedStack.push(item); }
  }
  const contextDocs: Record<string, string> = {};
  if (typeof raw.contextDocs === 'object' && raw.contextDocs !== null) {
    for (const key of CONTEXT_DOC_KEYS) {
      const val = (raw.contextDocs as Record<string, unknown>)[key];
      contextDocs[key] = typeof val === 'string' ? val : `[Add ${key.replace('.md', '')} content here.]\n`;
    }
  } else {
    missing.push('contextDocs');
  }
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, result: { suggestedName: raw.suggestedName as string, summary: raw.summary as string, detectedStack, contextDocs } };
}

async function makeProviderCall(
  profile: ProviderProfile,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const outcome = await invokeIpc<ChatOutcome>('provider_chat', {
    baseUrl: profile.baseUrl, modelId: profile.modelId,
    keychainAccount: keychainAccountFor(profile.id), messages,
    temperature: DRAFT_TEMPERATURE, maxTokens: DRAFT_MAX_TOKENS,
    timeoutMs: profile.params.timeoutMs, jsonMode: 'on',
    reasoningEffort: profile.params.reasoningEffort ?? 'none',
  });
  const body = JSON.parse(outcome.body) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) throw new Error('Provider returned empty response.');
  return content;
}

export async function draftProjectProfile(
  profile: ProviderProfile,
  request: DraftRequest,
): Promise<DraftResult> {
  const systemPrompt = [
    `You are a project profile drafting assistant. Analyze the provided evidence`,
    `and return ONLY a valid JSON object matching the schema. No markdown, no explanation.`,
    `Schema:`, DRAFT_OUTPUT_SCHEMA,
  ].join('\n');

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: buildDraftPrompt(request) },
  ];

  let rawContent: string;
  try { rawContent = await makeProviderCall(profile, messages); }
  catch (err) { throw new Error(`Provider request failed: ${err instanceof Error ? err.message : 'Unknown error'}. Check Settings.`); }

  const parsed = extractJson(rawContent);
  if (parsed !== null) {
    const result = parseDraftResponse(parsed);
    if (result.ok) return result.result;

    const repairSystem = [`You are a JSON repair assistant. Return ONLY a valid JSON matching:`, DRAFT_OUTPUT_SCHEMA].join('\n');
    const repairUser = `Missing fields: ${result.missing.join(', ')}. Return a complete JSON object.`;
    try {
      const repairContent = await makeProviderCall(profile, [
        { role: 'system' as const, content: repairSystem },
        { role: 'user' as const, content: repairUser },
      ]);
      const repairParsed = extractJson(repairContent);
      if (repairParsed !== null) {
        const repairResult = parseDraftResponse(repairParsed);
        if (repairResult.ok) return repairResult.result;
        throw new Error(`Repair failed. Missing: ${repairResult.missing.join(', ')}.`);
      }
      throw new Error('Repair produced no valid JSON.');
    } catch (repairErr) {
      if (repairErr instanceof Error && repairErr.message.includes('Repair')) throw repairErr;
      throw new Error(`Repair failed: ${repairErr instanceof Error ? repairErr.message : String(repairErr)}. Missing: ${result.missing.join(', ')}.`);
    }
  }
  throw new Error('Profile draft response was not valid JSON.');
}
