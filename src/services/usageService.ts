import { getAppDb } from '../db/appDb';
import { createCompilationsRepository } from '../db/repos/compilations';
import { createOutcomesRepository } from '../db/repos/outcomes';
import type { QueryRunner } from '../db/runner';

/**
 * Usage aggregates (Phase 8).
 *
 * Per-project totals. Token numbers from API usage vs estimates are
 * visually distinguished. No secrets, no subjective quality scores.
 */

let testRunner: QueryRunner | null = null;
export function setDbForTests(runner: QueryRunner | null): void { testRunner = runner; }

export interface ProjectUsage {
  projectId: string;
  totalCompilations: number;
  successCount: number;
  partialCount: number;
  failureCount: number;
  totalCompilerPromptTokens: number;
  totalCompilerCompletionTokens: number;
  totalEstimatedTokens: number;
  avgDurationMs: number | null;
}

export interface RuntimeUsage {
  agentRuntime: string;
  count: number;
}

export async function getProjectUsage(projectId: string): Promise<ProjectUsage> {
  const runner = testRunner ?? (await getAppDb());
  const comps = createCompilationsRepository(runner);
  const outcomes = createOutcomesRepository(runner);

  const history = await comps.listByProject(projectId, 1000, 0);
  const outcomeList = await outcomes.listByProject(projectId);
  const outcomeByComp = new Map(outcomeList.map((o) => [o.compilationId, o]));

  let successCount = 0;
  let partialCount = 0;
  let failureCount = 0;
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalEst = 0;
  let totalDuration = 0;
  let durationCount = 0;

  for (const c of history) {
    const o = outcomeByComp.get(c.id);
    if (o) {
      if (o.completionResult === 'success') successCount++;
      else if (o.completionResult === 'partial') partialCount++;
      else failureCount++;
    } else if (c.status === 'failed') {
      failureCount++;
    }
    totalPrompt += c.compilerPromptTokens ?? 0;
    totalCompletion += c.compilerCompletionTokens ?? 0;
    totalEst += c.compilerTokensEstimated;
    if (c.durationMs !== null) {
      totalDuration += c.durationMs;
      durationCount++;
    }
  }

  return {
    projectId,
    totalCompilations: history.length,
    successCount,
    partialCount,
    failureCount,
    totalCompilerPromptTokens: totalPrompt,
    totalCompilerCompletionTokens: totalCompletion,
    totalEstimatedTokens: totalEst,
    avgDurationMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : null,
  };
}

export async function getRuntimeUsage(projectId: string): Promise<RuntimeUsage[]> {
  const runner = testRunner ?? (await getAppDb());
  const comps = createCompilationsRepository(runner);
  const history = await comps.listByProject(projectId, 1000, 0);

  const byRuntime = new Map<string, number>();
  for (const c of history) {
    const rt = c.agentRuntime || 'unknown';
    byRuntime.set(rt, (byRuntime.get(rt) ?? 0) + 1);
  }

  return Array.from(byRuntime.entries()).map(([agentRuntime, count]) => ({
    agentRuntime,
    count,
  }));
}
