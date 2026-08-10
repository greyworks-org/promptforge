import { z } from 'zod';
import { invokeIpc } from '../ipc';
import { keychainAccountFor, type ProviderProfile } from '../schemas/providerProfile';
import type { TaskSpec } from '../schemas/taskspec';
import type {
  MemoryRecord,
  SemanticContextState,
  SemanticSnapshot,
} from '../db/repos/projectMemory';
import { updateMemory } from './memoryService';
import type { GitSnapshot } from './gitState';
import { loadProfile } from './settingsService';
import { assemblePayload } from './payloadAssembly';
import { listContextDocs } from './contextService';
import { readTextFile } from './projectFs';
import { isBinaryByExtension, isBlockedFilePath } from '../redaction/blocklist';

const MAX_FILES = 16;
const MAX_FILE_CHARS = 4_000;
const MAX_DIFF_CHARS = 16_000;
const MAX_CONTEXT_CHARS = 24_000;

const semanticOutputSchema = z.object({
  observed_completed: z.array(z.string().min(1).max(500)).max(20),
  observed_partial: z.array(z.string().min(1).max(500)).max(20),
  acceptance_requiring_verification: z.array(z.string().min(1).max(500)).max(50),
  changed_files: z.array(z.object({
    path: z.string().min(1).max(500),
    description: z.string().min(1).max(500),
  })).max(20),
  validation_evidence: z.array(z.string().min(1).max(500)).max(20),
  architecture_facts_observed: z.array(z.string().min(1).max(500)).max(20),
  blockers_observed: z.array(z.string().min(1).max(500)).max(20),
  risks_observed: z.array(z.string().min(1).max(500)).max(20),
  immediate_next_action: z.string().min(1).max(500),
}).strict();

export interface SemanticRefreshInput {
  projectId: string;
  repoPath: string;
  memory: MemoryRecord;
  git: GitSnapshot;
  currentTask: TaskSpec | null;
}

export interface SemanticRefreshResult {
  memory: MemoryRecord;
  state: 'fresh' | 'unavailable' | 'reused';
}

function sourcePath(path: string): boolean {
  return !isBlockedFilePath(path) && !isBinaryByExtension(path);
}

function changedSourcePaths(git: GitSnapshot): string[] {
  return [...new Set([
    ...git.uncommitted.staged,
    ...git.uncommitted.unstaged,
    ...git.uncommitted.untracked,
  ].filter(sourcePath))].sort();
}

function diffForPaths(diff: string, paths: string[]): string {
  if (diff.trim() === '' || paths.length === 0) return '';
  const allowed = new Set(paths);
  return diff
    .split(/(?=^diff --git )/m)
    .filter((chunk) => {
      const header = chunk.match(/^diff --git a\/(.+) b\/(.+)$/m);
      return header !== null && allowed.has(header[2]);
    })
    .join('')
    .slice(0, MAX_DIFF_CHARS);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readChangedFiles(projectId: string, paths: string[]): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  for (const path of paths.slice(0, MAX_FILES)) {
    try {
      files.push({ path, content: (await readTextFile(projectId, path)).slice(0, MAX_FILE_CHARS) });
    } catch {
      // Deleted or unreadable files remain represented by Git evidence.
    }
  }
  return files;
}

async function repositoryFingerprint(
  input: SemanticRefreshInput,
  paths: string[],
  files: Array<{ path: string; content: string }>,
): Promise<string> {
  const diff = diffForPaths(input.git.diff ?? '', paths);
  const untrackedContent = files
    .filter(({ path }) => input.git.uncommitted.untracked.includes(path))
    .map(({ path, content }) => ({ path, content }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return sha256(JSON.stringify({
    repoPath: input.repoPath,
    head: input.git.head?.hash ?? null,
    branch: input.git.branch,
    staged: input.git.uncommitted.staged.filter(sourcePath).sort(),
    unstaged: input.git.uncommitted.unstaged.filter(sourcePath).sort(),
    untracked: input.git.uncommitted.untracked.filter(sourcePath).sort(),
    diff,
    untrackedContent,
  }));
}

function parseProviderJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? raw.trim();
  return JSON.parse(candidate);
}

function semanticSystemPrompt(): string {
  return `You are a bounded repository-state analyst. Return ONLY JSON matching the requested semantic snapshot fields.
Use only the supplied repository evidence. The current repository and diff are authoritative over stale task wording.
Do not claim completion when evidence is ambiguous. Use evidence wording such as "observed implemented", "evidence suggests", or "requires verification".
Do not invent rationale or read files that were not supplied. Describe only changed files supplied in the evidence.
Keep every list concise and omit unsupported claims.`;
}

async function buildSemanticRequestWithDocs(
  input: SemanticRefreshInput,
  paths: string[],
  files: Array<{ path: string; content: string }>,
): Promise<string> {
  const task = input.currentTask ? JSON.stringify(input.currentTask, null, 2) : 'No active TaskSpec.';
  const diff = diffForPaths(input.git.diff ?? '', paths);
  let docs = '(no directly relevant context summaries)';
  if (input.currentTask) {
    try {
      const records = await listContextDocs(input.projectId);
      const relevant = records
        .filter((doc) => doc.taskTypes.includes(input.currentTask!.task_type) || doc.summary !== null)
        .slice(0, 4)
        .map((doc) => `${doc.relPath}: ${doc.summary ?? 'summary unavailable'}`);
      if (relevant.length > 0) docs = relevant.join('\n');
    } catch {
      // Context docs are supplemental; Git evidence remains sufficient.
    }
  }
  const fileText = files.map((file) => `--- changed file: ${file.path} ---\n${file.content}`).join('\n\n');
  return [
    `Canonical repository path: ${input.repoPath}`,
    `HEAD: ${input.git.head?.hash ?? 'unavailable'} ${input.git.head?.subject ?? ''}`,
    `Changed source/test paths: ${JSON.stringify(paths)}`,
    `Current TaskSpec:\n${task}`,
    `Project memory evidence:\n${JSON.stringify({ decisions: input.memory.decisions, blockers: input.memory.blockers, relevantFiles: input.memory.relevantFiles })}`,
    `Directly relevant context summaries:\n${docs}`,
    `Bounded Git diff:\n${diff || '(no tracked diff; inspect supplied changed-file content)'}`,
    `Changed-file content excerpts:\n${fileText || '(none readable)'}`,
  ].join('\n\n').slice(0, MAX_CONTEXT_CHARS);
}

async function unavailable(input: SemanticRefreshInput, fingerprint: string, error?: string): Promise<SemanticRefreshResult> {
  const state: SemanticContextState = {
    fingerprint,
    attemptedAt: new Date().toISOString(),
    status: 'unavailable',
    snapshot: null,
    error: error ? 'Semantic refresh unavailable.' : undefined,
  };
  try {
    const memory = await updateMemory(input.projectId, { semanticContext: state });
    return { memory, state: 'unavailable' };
  } catch {
    return {
      memory: { ...input.memory, semanticContext: state },
      state: 'unavailable',
    };
  }
}

export async function refreshSemanticContextIfNeeded(input: SemanticRefreshInput): Promise<SemanticRefreshResult> {
  const paths = changedSourcePaths(input.git);
  const files = await readChangedFiles(input.projectId, paths);
  const fingerprint = await repositoryFingerprint(input, paths, files);
  const previous = input.memory.semanticContext;
  if (previous?.fingerprint === fingerprint) {
    return { memory: input.memory, state: previous.status === 'fresh' ? 'reused' : 'unavailable' };
  }

  let profile: ProviderProfile | null;
  try {
    profile = await loadProfile();
  } catch {
    profile = null;
  }
  if (profile === null) return unavailable(input, fingerprint);

  const request = await buildSemanticRequestWithDocs(input, paths, files);
  const payload = assemblePayload({ rawRequest: request, contextDocs: [] });
  if (!payload.hasContent) return unavailable(input, fingerprint);

  try {
    const outcome = await invokeIpc<{ body: string }>('provider_chat', {
      baseUrl: profile.baseUrl,
      modelId: profile.modelId,
      keychainAccount: keychainAccountFor(profile.id),
      messages: [
        { role: 'system', content: semanticSystemPrompt() },
        { role: 'user', content: payload.text },
      ],
      temperature: 0.1,
      maxTokens: Math.min(profile.params.maxTokens, 1200),
      timeoutMs: profile.params.timeoutMs,
      jsonMode: profile.capabilities.jsonMode === 'off' ? 'off' : 'on',
    });
    const body = JSON.parse(outcome.body) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const rawContent = body.choices?.[0]?.message?.content;
    if (typeof rawContent !== 'string') throw new Error('Semantic provider returned no content.');
    const parsed = semanticOutputSchema.parse(parseProviderJson(rawContent));
    const allowed = new Set(paths);
    const snapshot: SemanticSnapshot = {
      project_id: input.projectId,
      repo_fingerprint: fingerprint,
      generated_at: new Date().toISOString(),
      current_task_id: input.currentTask?.task_id ?? null,
      observed_completed: parsed.observed_completed,
      observed_partial: parsed.observed_partial,
      acceptance_requiring_verification: input.currentTask?.acceptance_criteria ?? parsed.acceptance_requiring_verification,
      changed_files: parsed.changed_files.filter((file) => allowed.has(file.path)),
      validation_evidence: parsed.validation_evidence,
      architecture_facts_observed: parsed.architecture_facts_observed,
      blockers_observed: parsed.blockers_observed,
      risks_observed: parsed.risks_observed,
      immediate_next_action: parsed.immediate_next_action,
    };
    const state: SemanticContextState = {
      fingerprint,
      attemptedAt: new Date().toISOString(),
      status: 'fresh',
      snapshot,
    };
    const memory = await updateMemory(input.projectId, { semanticContext: state });
    return { memory, state: 'fresh' };
  } catch {
    return unavailable(input, fingerprint, 'provider');
  }
}
