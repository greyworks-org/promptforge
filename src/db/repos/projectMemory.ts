import { z } from 'zod';
import type { QueryRunner } from '../runner';

const memoryRowSchema = z.object({
  project_id: z.string().min(1),
  stack_json: z.string().default('[]'),
  current_phase: z.string().nullable(),
  last_validated_task_id: z.string().nullable(),
  current_task_id: z.string().nullable(),
  next_task_json: z.string().nullable(),
  decisions_json: z.string().default('[]'),
  blockers_json: z.string().default('[]'),
  relevant_files_json: z.string().default('[]'),
  last_test_json: z.string().nullable(),
  base_commit: z.string().nullable(),
  updated_at: z.string().min(1),
});

export interface MemoryRecord {
  projectId: string;
  stack: string[];
  currentPhase: string | null;
  lastValidatedTaskId: string | null;
  currentTaskId: string | null;
  nextTask: string | null;
  decisions: Array<{ text: string; at: string; taskId?: string }>;
  blockers: Array<{ text: string; kind: string; at: string }>;
  relevantFiles: string[];
  lastTest: { commands: string[]; results: string; at: string } | null;
  baseCommit: string | null;
  updatedAt: string;
}

function safeJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function rowToRecord(r: z.infer<typeof memoryRowSchema>): MemoryRecord {
  return {
    projectId: r.project_id,
    stack: safeJson<string[]>(r.stack_json, []),
    currentPhase: r.current_phase,
    lastValidatedTaskId: r.last_validated_task_id,
    currentTaskId: r.current_task_id,
    nextTask: r.next_task_json ? safeJson<string>(r.next_task_json, '') : null,
    decisions: safeJson(r.decisions_json, []),
    blockers: safeJson(r.blockers_json, []),
    relevantFiles: safeJson<string[]>(r.relevant_files_json, []),
    lastTest: r.last_test_json ? safeJson(r.last_test_json, null) : null,
    baseCommit: r.base_commit,
    updatedAt: r.updated_at,
  };
}

export interface ProjectMemoryRepository {
  getByProject(projectId: string): Promise<MemoryRecord | null>;
  upsert(projectId: string, patch: Partial<MemoryRecord>): Promise<MemoryRecord>;
}

export function createProjectMemoryRepository(runner: QueryRunner): ProjectMemoryRepository {
  return {
    async getByProject(projectId) {
      const rows = await runner.select<Record<string, unknown>>(
        'SELECT * FROM project_memory WHERE project_id = ?', [projectId],
      );
      if (rows.length === 0) return null;
      return rowToRecord(memoryRowSchema.parse(rows[0]));
    },

    async upsert(projectId, patch) {
      const now = new Date().toISOString();
      const existing = await this.getByProject(projectId);

      if (existing) {
        const sets: string[] = [];
        const params: unknown[] = [];
        if (patch.stack !== undefined) { sets.push('stack_json = ?'); params.push(JSON.stringify(patch.stack)); }
        if (patch.currentPhase !== undefined) { sets.push('current_phase = ?'); params.push(patch.currentPhase); }
        if (patch.lastValidatedTaskId !== undefined) { sets.push('last_validated_task_id = ?'); params.push(patch.lastValidatedTaskId); }
        if (patch.currentTaskId !== undefined) { sets.push('current_task_id = ?'); params.push(patch.currentTaskId); }
        if (patch.nextTask !== undefined) { sets.push('next_task_json = ?'); params.push(patch.nextTask ? JSON.stringify(patch.nextTask) : null); }
        if (patch.decisions !== undefined) { sets.push('decisions_json = ?'); params.push(JSON.stringify(patch.decisions)); }
        if (patch.blockers !== undefined) { sets.push('blockers_json = ?'); params.push(JSON.stringify(patch.blockers)); }
        if (patch.relevantFiles !== undefined) { sets.push('relevant_files_json = ?'); params.push(JSON.stringify(patch.relevantFiles)); }
        if (patch.lastTest !== undefined) { sets.push('last_test_json = ?'); params.push(patch.lastTest ? JSON.stringify(patch.lastTest) : null); }
        if (patch.baseCommit !== undefined) { sets.push('base_commit = ?'); params.push(patch.baseCommit); }
        sets.push('updated_at = ?'); params.push(now);
        params.push(projectId);
        if (sets.length > 0) {
          await runner.execute(`UPDATE project_memory SET ${sets.join(', ')} WHERE project_id = ?`, params as any);
        }
      } else {
        await runner.execute(
          `INSERT INTO project_memory (project_id, stack_json, current_phase, last_validated_task_id,
           current_task_id, next_task_json, decisions_json, blockers_json, relevant_files_json,
           last_test_json, base_commit, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            projectId,
            JSON.stringify(patch.stack ?? []), patch.currentPhase ?? null,
            patch.lastValidatedTaskId ?? null, patch.currentTaskId ?? null,
            patch.nextTask ? JSON.stringify(patch.nextTask) : null,
            JSON.stringify(patch.decisions ?? []), JSON.stringify(patch.blockers ?? []),
            JSON.stringify(patch.relevantFiles ?? []),
            patch.lastTest ? JSON.stringify(patch.lastTest) : null,
            patch.baseCommit ?? null, now,
          ],
        );
      }
      return (await this.getByProject(projectId))!;
    },
  };
}
