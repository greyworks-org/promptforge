import { z } from 'zod';
import type { QueryRunner } from '../runner';

const compilationRowSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  created_at: z.string().min(1),
  raw_request: z.string(),
  task_type: z.string(),
  execution_mode: z.string(),
  target_model: z.string().default(''),
  agent_runtime: z.string().default(''),
  execution_profile: z.string().default(''),
  profile_version: z.string().default('1.0.0'),
  provider_label: z.string(),
  model_id: z.string(),
  context_doc_ids_json: z.string().default('[]'),
  context_sent: z.string(),
  blocking_rounds: z.number().int().default(0),
  taskspec_json: z.string().nullable(),
  prompt_qwen: z.string().nullable(),
  prompt_codex: z.string().nullable(),
  prompt_claude: z.string().nullable(),
  compiler_prompt_tokens: z.number().int().nullable(),
  compiler_completion_tokens: z.number().int().nullable(),
  compiler_tokens_estimated: z.number().int().default(0),
  final_prompt_tokens_est: z.number().int().nullable(),
  duration_ms: z.number().int().nullable(),
  status: z.string(),
  error: z.string().nullable(),
  recompile_of: z.string().nullable(),
});

export interface CompilationRecord {
  id: string;
  projectId: string;
  createdAt: string;
  rawRequest: string;
  taskType: string;
  executionMode: string;
  targetModel: string;
  agentRuntime: string;
  executionProfile: string;
  profileVersion: string;
  providerLabel: string;
  modelId: string;
  contextDocIds: string[];
  contextSent: string;
  blockingRounds: number;
  taskspecJson: string | null;
  promptQwen: string | null;
  promptCodex: string | null;
  promptClaude: string | null;
  compilerPromptTokens: number | null;
  compilerCompletionTokens: number | null;
  compilerTokensEstimated: number;
  finalPromptTokensEst: number | null;
  durationMs: number | null;
  status: string;
  error: string | null;
  recompileOf: string | null;
}

function rowToRecord(r: z.infer<typeof compilationRowSchema>): CompilationRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    createdAt: r.created_at,
    rawRequest: r.raw_request,
    taskType: r.task_type,
    executionMode: r.execution_mode,
    targetModel: r.target_model,
    agentRuntime: r.agent_runtime,
    executionProfile: r.execution_profile,
    profileVersion: r.profile_version,
    providerLabel: r.provider_label,
    modelId: r.model_id,
    contextDocIds: safeJsonArray(r.context_doc_ids_json),
    contextSent: r.context_sent,
    blockingRounds: r.blocking_rounds,
    taskspecJson: r.taskspec_json,
    promptQwen: r.prompt_qwen,
    promptCodex: r.prompt_codex,
    promptClaude: r.prompt_claude,
    compilerPromptTokens: r.compiler_prompt_tokens,
    compilerCompletionTokens: r.compiler_completion_tokens,
    compilerTokensEstimated: r.compiler_tokens_estimated,
    finalPromptTokensEst: r.final_prompt_tokens_est,
    durationMs: r.duration_ms,
    status: r.status,
    error: r.error,
    recompileOf: r.recompile_of,
  };
}

function safeJsonArray(raw: string): string[] {
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
}

const SELECT = `SELECT id, project_id, created_at, raw_request, task_type, execution_mode,
  target_model, agent_runtime, execution_profile, profile_version,
  provider_label, model_id, context_doc_ids_json, context_sent,
  blocking_rounds, taskspec_json, prompt_qwen, prompt_codex, prompt_claude,
  compiler_prompt_tokens, compiler_completion_tokens, compiler_tokens_estimated,
  final_prompt_tokens_est, duration_ms, status, error, recompile_of
FROM compilations`;

export interface NewCompilation {
  id: string;
  projectId: string;
  rawRequest: string;
  taskType: string;
  executionMode: string;
  targetModel?: string;
  agentRuntime?: string;
  executionProfile?: string;
  profileVersion?: string;
  providerLabel: string;
  modelId: string;
  contextDocIds?: string[];
  contextSent: string;
  blockingRounds?: number;
  taskspecJson?: string | null;
  promptQwen?: string | null;
  promptCodex?: string | null;
  promptClaude?: string | null;
  compilerPromptTokens?: number | null;
  compilerCompletionTokens?: number | null;
  compilerTokensEstimated?: number;
  finalPromptTokensEst?: number | null;
  durationMs?: number | null;
  status: string;
  error?: string | null;
}

export interface CompilationsRepository {
  getById(id: string): Promise<CompilationRecord | null>;
  listByProject(projectId: string, limit?: number, offset?: number): Promise<CompilationRecord[]>;
  insert(c: NewCompilation): Promise<CompilationRecord>;
  update(id: string, patch: Partial<NewCompilation>): Promise<CompilationRecord | null>;
}

export function createCompilationsRepository(runner: QueryRunner): CompilationsRepository {
  return {
    async getById(id) {
      const rows = await runner.select<Record<string, unknown>>(`${SELECT} WHERE id = ?`, [id]);
      if (rows.length === 0) return null;
      return rowToRecord(compilationRowSchema.parse(rows[0]));
    },

    async listByProject(projectId, limit = 50, offset = 0) {
      const rows = await runner.select<Record<string, unknown>>(
        `${SELECT} WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [projectId, limit, offset],
      );
      return rows.map((r) => rowToRecord(compilationRowSchema.parse(r)));
    },

    async insert(c) {
      const now = new Date().toISOString();
      await runner.execute(
        `INSERT INTO compilations (id, project_id, created_at, raw_request, task_type,
         execution_mode, target_model, agent_runtime, execution_profile, profile_version,
         provider_label, model_id, context_doc_ids_json, context_sent,
         blocking_rounds, taskspec_json, prompt_qwen, prompt_codex, prompt_claude,
         compiler_prompt_tokens, compiler_completion_tokens, compiler_tokens_estimated,
         final_prompt_tokens_est, duration_ms, status, error)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          c.id, c.projectId, now, c.rawRequest, c.taskType,
          c.executionMode, c.targetModel ?? '', c.agentRuntime ?? '', c.executionProfile ?? '', c.profileVersion ?? '1.0.0',
          c.providerLabel, c.modelId, JSON.stringify(c.contextDocIds ?? []), c.contextSent,
          c.blockingRounds ?? 0, c.taskspecJson ?? null, c.promptQwen ?? null, c.promptCodex ?? null, c.promptClaude ?? null,
          c.compilerPromptTokens ?? null, c.compilerCompletionTokens ?? null, c.compilerTokensEstimated ?? 0,
          c.finalPromptTokensEst ?? null, c.durationMs ?? null, c.status, c.error ?? null,
        ],
      );
      return (await this.getById(c.id))!;
    },

    async update(id, patch) {
      const existing = await this.getById(id);
      if (!existing) return null;
      const sets: string[] = [];
      const params: unknown[] = [];
      if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
      if (patch.taskspecJson !== undefined) { sets.push('taskspec_json = ?'); params.push(patch.taskspecJson); }
      if (patch.promptQwen !== undefined) { sets.push('prompt_qwen = ?'); params.push(patch.promptQwen); }
      if (patch.promptCodex !== undefined) { sets.push('prompt_codex = ?'); params.push(patch.promptCodex); }
      if (patch.promptClaude !== undefined) { sets.push('prompt_claude = ?'); params.push(patch.promptClaude); }
      if (patch.error !== undefined) { sets.push('error = ?'); params.push(patch.error); }
      if (patch.blockingRounds !== undefined) { sets.push('blocking_rounds = ?'); params.push(patch.blockingRounds); }
      if (patch.compilerPromptTokens !== undefined) { sets.push('compiler_prompt_tokens = ?'); params.push(patch.compilerPromptTokens); }
      if (patch.compilerCompletionTokens !== undefined) { sets.push('compiler_completion_tokens = ?'); params.push(patch.compilerCompletionTokens); }
      if (patch.compilerTokensEstimated !== undefined) { sets.push('compiler_tokens_estimated = ?'); params.push(patch.compilerTokensEstimated); }
      if (patch.finalPromptTokensEst !== undefined) { sets.push('final_prompt_tokens_est = ?'); params.push(patch.finalPromptTokensEst); }
      if (patch.durationMs !== undefined) { sets.push('duration_ms = ?'); params.push(patch.durationMs); }
      if (sets.length === 0) return existing;
      params.push(id);
      await runner.execute(`UPDATE compilations SET ${sets.join(', ')} WHERE id = ?`, params as any);
      return this.getById(id);
    },
  };
}
