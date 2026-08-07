/**
 * Deep-mode critic (Phase 6).
 *
 * In deep mode, after the compiler produces a TaskSpec, a second call
 * critiques it for completeness, contradictions, and unnecessary scope.
 * The critic receives the existing JSON and the schema, and returns
 * suggested changes. The result is merged back and re-validated.
 */

export const CRITIC_PROMPT = `You are a software-development task critic.

Review the TaskSpec JSON below. Identify:
1. Missing information that blocks correct execution.
2. Contradictions between scope, requirements, or acceptance criteria.
3. Unnecessary scope items that expand the task beyond the requested outcome.
4. Missing edge cases or failure states.
5. Vague or unverifiable acceptance criteria.

Return ONLY a JSON object with these fields:
- "issues": array of strings describing each issue found
- "suggestions": array of strings with concrete fixes
- "revised_scope": (optional) revised scope array if scope needs changes
- "revised_acceptance_criteria": (optional) revised criteria
- "revised_edge_cases": (optional) additional edge cases

If no issues are found, return empty arrays.
Do NOT regenerate the entire TaskSpec — only suggest changes.`;

/**
 * Build the critic user message containing the current TaskSpec JSON.
 */
export function buildCriticMessage(taskSpecJson: string): string {
  return `Review this TaskSpec:\n\n${taskSpecJson}`;
}
