/**
 * Token budget enforcement (Phase 4).
 *
 * Character-based estimator (≈ chars / 4) per ARCHITECTURE.md R4.
 * All estimates are clearly labeled as estimates — never presented as
 * exact token counts.
 */

/** Token budget ranges per execution mode (spec §11). */
export const MODE_BUDGETS: Record<string, { min: number; max: number }> = {
  quick: { min: 300, max: 700 },
  standard: { min: 800, max: 2000 },
  deep: { min: 2000, max: 5000 },
  review: { min: 500, max: 3000 },
  plan: { min: 1000, max: 4000 },
};

/**
 * Estimate tokens from a string using a character-based heuristic.
 * Every caller must label the result as an estimate.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for multiple texts (e.g. a set of context documents).
 */
export function estimateTokensMultiple(texts: string[]): number {
  return texts.reduce((sum, t) => sum + estimateTokens(t), 0);
}

export interface BudgetResult {
  /** Whether the total fits within the mode budget. */
  fits: boolean;
  /** Total estimated tokens for the selected documents. */
  estimated: number;
  /** Maximum allowed for this mode. */
  max: number;
  /** Minimum suggested for this mode. */
  min: number;
  /** Surplus tokens over the max (0 if within budget). */
  surplus: number;
}

/**
 * Check whether a set of documents fits within the budget for a given
 * execution mode. Returns a structured result for UI display.
 */
export function checkBudget(
  mode: string,
  docTexts: string[],
): BudgetResult {
  const budget = MODE_BUDGETS[mode] ?? MODE_BUDGETS.standard;
  const estimated = estimateTokensMultiple(docTexts);
  const fits = estimated <= budget.max;
  const surplus = fits ? 0 : estimated - budget.max;

  return {
    fits,
    estimated,
    max: budget.max,
    min: budget.min,
    surplus,
  };
}

/**
 * Select documents that fit within the budget using a greedy approach:
 * always include priority docs first, then add remaining docs until
 * the budget is exhausted.
 */
export function fitToBudget(
  mode: string,
  documents: Array<{ id: string; text: string }>,
  priorityIds: string[],
): { selected: string[]; dropped: string[]; budget: BudgetResult } {
  const budget = MODE_BUDGETS[mode] ?? MODE_BUDGETS.standard;
  const selected: string[] = [];
  const dropped: string[] = [];
  let total = 0;

  // Build a lookup.
  const byId = new Map(documents.map((d) => [d.id, d]));

  // Priority docs first.
  for (const id of priorityIds) {
    const doc = byId.get(id);
    if (!doc) continue;
    const tokens = estimateTokens(doc.text);
    if (total + tokens <= budget.max) {
      selected.push(id);
      total += tokens;
    } else {
      dropped.push(id);
    }
  }

  // Remaining docs, sorted by token count ascending (fit more).
  const remaining = documents
    .filter((d) => !priorityIds.includes(d.id) && !selected.includes(d.id))
    .sort((a, b) => estimateTokens(a.text) - estimateTokens(b.text));

  for (const doc of remaining) {
    const tokens = estimateTokens(doc.text);
    if (total + tokens <= budget.max) {
      selected.push(doc.id);
      total += tokens;
    } else {
      dropped.push(doc.id);
    }
  }

  return {
    selected,
    dropped,
    budget: {
      fits: total <= budget.max,
      estimated: total,
      max: budget.max,
      min: budget.min,
      surplus: 0,
    },
  };
}
