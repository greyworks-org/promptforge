import { invokeIpc } from '../ipc';
import type { ProviderProfile } from '../schemas/providerProfile';
import { keychainAccountFor } from '../schemas/providerProfile';
import { compilerOutputSchema, type CompilerOutput } from '../schemas/compilerOutput';
import { taskSpecSchema, type TaskSpec } from '../schemas/taskspec';
import { buildSystemPrompt } from './systemPrompt';
import { extractAndNormalize } from './parse';
import { enrich } from './enrich';
import { buildCriticMessage } from './critic';
import { assemblePayload } from '../services/payloadAssembly';
import type { MemoryRecord } from '../db/repos/projectMemory';

/**
 * Compiler pipeline state machine (Phase 6).
 *
 * Orchestrates: context assembly → redaction → provider call →
 * extract/normalize → validate → bounded repair (≤1) →
 * enrichment → canonical validation.
 *
 * Deep mode adds one critic call after the compiler.
 * Blocking questions cap at 2 rounds.
 */

export type PipelineStatus =
  | 'idle'
  | 'compiling'
  | 'awaiting_answers'
  | 'done'
  | 'failed';

export interface PipelineState {
  status: PipelineStatus;
  /** The canonical TaskSpec, set only when status is 'done'. */
  taskSpec: TaskSpec | null;
  /** The raw compiler-output JSON before enrichment. */
  compilerOutput: CompilerOutput | null;
  /** Blocking questions the user must answer (max 3). */
  blockingQuestions: string[];
  /** How many blocking-question rounds have occurred. */
  blockingRounds: number;
  /** Error message when status is 'failed'. */
  error: string | null;
  /** Total provider calls made in this compilation. */
  callCount: number;
  /** The assembled payload text (redacted, exactly what was sent). */
  contextSent: string;
  /** User's raw request, preserved for re-runs. */
  rawRequest: string;
  /** User's answers to blocking questions, accumulated. */
  answers: string[];
}

export interface CompileRequest {
  profile: ProviderProfile;
  projectId: string;
  rawRequest: string;
  executionMode: 'quick' | 'standard' | 'deep' | 'review' | 'plan';
  contextDocs: Array<{ relPath: string; content: string }>;
  /** Bounded provider-neutral project facts from the active memory record. */
  projectMemory?: Pick<MemoryRecord, 'stack' | 'currentPhase' | 'decisions' | 'blockers' | 'relevantFiles'>;
  /** Existing project rule files; guidance has precedence over generic defaults. */
  projectGuidance?: Array<{ relPath: string; content: string }>;
  /** Previous blocking-question answers (for re-runs). */
  answers?: string[];
  /** Previous pipeline state (for re-runs). */
  previousState?: PipelineState;
}

function emptyState(rawRequest: string): PipelineState {
  return {
    status: 'idle',
    taskSpec: null,
    compilerOutput: null,
    blockingQuestions: [],
    blockingRounds: 0,
    error: null,
    callCount: 0,
    contextSent: '',
    rawRequest,
    answers: [],
  };
}

/** Make a single provider call for compilation. */
async function providerCall(
  profile: ProviderProfile,
  systemPrompt: string,
  userMessage: string,
  jsonMode: boolean,
): Promise<string> {
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userMessage },
  ];

  const outcome = await invokeIpc<{ status: number; body: string; latencyMs: number }>(
    'provider_chat',
    {
      baseUrl: profile.baseUrl,
      modelId: profile.modelId,
      keychainAccount: keychainAccountFor(profile.id),
      messages,
      temperature: 0.2,
      maxTokens: profile.params.maxTokens,
      timeoutMs: profile.params.timeoutMs,
      jsonMode: jsonMode ? 'on' : 'off',
      reasoningEffort: profile.params.reasoningEffort ?? 'none',
    },
  );

  const body = JSON.parse(outcome.body) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return body.choices?.[0]?.message?.content ?? '';
}

/**
 * Run the full compilation pipeline.
 *
 * Standard flow: compile → validate → enrich → canonical
 * Deep flow:    compile → validate → critic → merge → re-validate → enrich → canonical
 * Repair:       invalid → ONE repair call → validate → continue or fail
 * Blocking:     questions → return to user → re-run with answers (≤2 rounds)
 */
export async function runPipeline(request: CompileRequest): Promise<PipelineState> {
  const state: PipelineState = request.previousState ?? emptyState(request.rawRequest);
  state.status = 'compiling';

  const jsonMode = request.profile.capabilities.jsonMode !== 'off';

  // Build the full user message including context + answers.
  let userMessage = request.rawRequest;
  if (request.projectMemory) {
    userMessage += `\n\nProject memory (known facts and explicit decisions; do not override repository reality):\n${JSON.stringify(request.projectMemory)}`;
  }
  if (request.projectGuidance && request.projectGuidance.length > 0) {
    const guidanceText = request.projectGuidance
      .map((d) => `--- project guidance: ${d.relPath} ---\n${d.content}`)
      .join('\n\n');
    userMessage += `\n\nProject guidance (follow when it does not conflict with the user's request):\n${guidanceText}`;
  }
  if (request.contextDocs.length > 0) {
    const ctxText = request.contextDocs
      .map((d) => `--- ${d.relPath} ---\n${d.content}`)
      .join('\n\n');
    userMessage += `\n\nRelevant context:\n\n${ctxText}`;
  }
  if (request.answers && request.answers.length > 0) {
    state.answers = request.answers;
    userMessage += `\n\nAnswers to previous questions:\n${request.answers.join('\n')}`;
  }

  // Assemble payload through the Phase 5 safety gate.
  const payload = assemblePayload({
    rawRequest: userMessage,
    contextDocs: request.contextDocs,
  });
  state.contextSent = payload.text;

  if (!payload.hasContent) {
    state.status = 'failed';
    state.error = 'No content to send — all inputs were blocked or empty.';
    return state;
  }

  // --- Compiler call ---
  let raw: string;
  try {
    raw = await providerCall(request.profile, buildSystemPrompt(), payload.text, jsonMode);
    state.callCount += 1;
  } catch (err) {
    state.status = 'failed';
    state.error = `Provider call failed: ${err instanceof Error ? err.message : String(err)}`;
    return state;
  }

  // --- Extract & normalize ---
  const parseResult = extractAndNormalize(raw);
  if (!parseResult.jsonFound) {
    // Empty/invalid JSON — try repair.
    const repaired = await tryRepair(request.profile, raw, state, jsonMode);
    if (!repaired) return state;
    return finishCompilation(repaired, request.projectId, state, request, jsonMode);
  }

  // --- Validate against compiler-output schema ---
  const coResult = compilerOutputSchema.safeParse(parseResult.data);
  if (!coResult.success) {
    // Invalid — try repair.
    const repaired = await tryRepair(request.profile, raw, state, jsonMode);
    if (!repaired) return state;
    return finishCompilation(repaired, request.projectId, state, request, jsonMode);
  }

  return finishCompilation(coResult.data, request.projectId, state, request, jsonMode);
}

async function tryRepair(
  profile: ProviderProfile,
  previousRaw: string,
  state: PipelineState,
  jsonMode: boolean,
): Promise<CompilerOutput | null> {
  if (state.callCount >= 2) {
    state.status = 'failed';
    state.error = 'Compiler output was invalid after repair attempt.';
    return null;
  }

  const repairPrompt = `Your previous response was not valid JSON matching the required schema. The schema is embedded in the system prompt. Return ONLY a valid JSON object this time. Previous response:\n\n${previousRaw}`;

  let raw: string;
  try {
    raw = await providerCall(profile, buildSystemPrompt(), repairPrompt, jsonMode);
    state.callCount += 1;
  } catch (err) {
    state.status = 'failed';
    state.error = `Repair call failed: ${err instanceof Error ? err.message : String(err)}`;
    return null;
  }

  const parseResult = extractAndNormalize(raw);
  if (!parseResult.jsonFound) {
    state.status = 'failed';
    state.error = 'Repair produced no valid JSON.';
    return null;
  }

  const coResult = compilerOutputSchema.safeParse(parseResult.data);
  if (!coResult.success) {
    state.status = 'failed';
    state.error = `Repair produced invalid output: ${coResult.error.issues.map((i) => i.message).join('; ')}`;
    return null;
  }

  return coResult.data;
}

async function finishCompilation(
  co: CompilerOutput,
  projectId: string,
  state: PipelineState,
  request: CompileRequest,
  jsonMode: boolean,
): Promise<PipelineState> {
  state.compilerOutput = co;

  // Blocking questions?
  if (co.blocking_questions && co.blocking_questions.length > 0) {
    state.blockingQuestions = co.blocking_questions;
    state.blockingRounds += 1;
    if (state.blockingRounds > 2) {
      state.status = 'failed';
      state.error = 'Too many blocking-question rounds (max 2).';
      return state;
    }
    state.status = 'awaiting_answers';
    return state;
  }

  // Deep mode: critic call.
  if (request.executionMode === 'deep' && state.callCount < 3) {
    try {
      const criticRaw = await providerCall(
        request.profile,
        buildSystemPrompt(),
        buildCriticMessage(JSON.stringify(co, null, 2)),
        jsonMode,
      );
      state.callCount += 1;
      // Apply critic suggestions to the compiler output (simple merge).
      const criticResult = extractAndNormalize(criticRaw);
      if (criticResult.jsonFound) {
        const criticData = criticResult.data;
        // Merge critic revisions into the compiler output.
        if (Array.isArray(criticData.revised_scope)) {
          co.scope = criticData.revised_scope as string[];
        }
        if (Array.isArray(criticData.revised_acceptance_criteria)) {
          co.acceptance_criteria = criticData.revised_acceptance_criteria as string[];
        }
        if (Array.isArray(criticData.revised_edge_cases)) {
          co.edge_cases = [
            ...(co.edge_cases ?? []),
            ...(criticData.revised_edge_cases as string[]),
          ];
        }
      }
    } catch {
      // Critic failure is non-fatal — continue with the original compiler output.
    }
  }

  // Enrich.
  const taskSpec = enrich({ compilerOutput: co, projectId });

  // Canonical validation — must always pass (assert).
  const canonicalResult = taskSpecSchema.safeParse(taskSpec);
  if (!canonicalResult.success) {
    state.status = 'failed';
    state.error = `Canonical validation failed (client bug): ${canonicalResult.error.issues.map((i) => i.message).join('; ')}`;
    return state;
  }

  state.taskSpec = canonicalResult.data;
  state.status = 'done';
  return state;
}
