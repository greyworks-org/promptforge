import { z } from 'zod';
import type { QueryRunner } from '../runner';

const outcomeRowSchema = z.object({
  compilation_id: z.string().min(1),
  completion_result: z.enum(['success', 'partial', 'failure']),
  revision_count: z.number().int().default(0),
  scope_violation: z.number().int().nullable(),
  tests_passed: z.number().int().nullable(),
  completion_time_min: z.number().int().nullable(),
  used_runtime: z.string().nullable(),
  user_note: z.string().nullable(),
  recorded_at: z.string().min(1),
});

export interface OutcomeRecord {
  compilationId: string;
  completionResult: 'success' | 'partial' | 'failure';
  revisionCount: number;
  scopeViolation: number | null;
  testsPassed: number | null;
  completionTimeMin: number | null;
  usedRuntime: string | null;
  userNote: string | null;
  recordedAt: string;
}

function rowToRecord(r: z.infer<typeof outcomeRowSchema>): OutcomeRecord {
  return {
    compilationId: r.compilation_id,
    completionResult: r.completion_result,
    revisionCount: r.revision_count,
    scopeViolation: r.scope_violation,
    testsPassed: r.tests_passed,
    completionTimeMin: r.completion_time_min,
    usedRuntime: r.used_runtime,
    userNote: r.user_note,
    recordedAt: r.recorded_at,
  };
}

export interface OutcomesRepository {
  getByCompilationId(id: string): Promise<OutcomeRecord | null>;
  upsert(o: OutcomeRecord): Promise<OutcomeRecord>;
  listByProject(projectId: string): Promise<OutcomeRecord[]>;
}

export function createOutcomesRepository(runner: QueryRunner): OutcomesRepository {
  return {
    async getByCompilationId(id) {
      const rows = await runner.select<Record<string, unknown>>(
        `SELECT * FROM task_outcomes WHERE compilation_id = ?`, [id],
      );
      if (rows.length === 0) return null;
      return rowToRecord(outcomeRowSchema.parse(rows[0]));
    },

    async upsert(o) {
      const now = new Date().toISOString();
      const existing = await this.getByCompilationId(o.compilationId);
      if (existing) {
        await runner.execute(
          `UPDATE task_outcomes SET completion_result=?, revision_count=?, scope_violation=?,
           tests_passed=?, completion_time_min=?, used_runtime=?, user_note=?, recorded_at=?
           WHERE compilation_id=?`,
          [o.completionResult, o.revisionCount, o.scopeViolation, o.testsPassed,
           o.completionTimeMin, o.usedRuntime, o.userNote, now, o.compilationId],
        );
      } else {
        await runner.execute(
          `INSERT INTO task_outcomes (compilation_id, completion_result, revision_count,
           scope_violation, tests_passed, completion_time_min, used_runtime, user_note, recorded_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [o.compilationId, o.completionResult, o.revisionCount, o.scopeViolation,
           o.testsPassed, o.completionTimeMin, o.usedRuntime, o.userNote, now],
        );
      }
      return (await this.getByCompilationId(o.compilationId))!;
    },

    async listByProject(projectId) {
      const rows = await runner.select<Record<string, unknown>>(
        `SELECT o.* FROM task_outcomes o
         JOIN compilations c ON o.compilation_id = c.id
         WHERE c.project_id = ?
         ORDER BY o.recorded_at DESC`,
        [projectId],
      );
      return rows.map((r) => rowToRecord(outcomeRowSchema.parse(r)));
    },
  };
}
