/**
 * JSON extraction and normalization (Phase 6, TASKSPEC.md §1 step 1).
 *
 * Extracts JSON from raw provider responses (strips code fences and
 * surrounding prose). Normalizes by stripping exactly the three
 * client-owned keys (task_id, project_id, schema_version) and
 * defaulting a missing requirements object to empty arrays.
 */

const CLIENT_OWNED_KEYS = ['task_id', 'project_id', 'schema_version'];

const EMPTY_REQUIREMENTS = {
  functional: [] as string[],
  frontend: [] as string[],
  backend: [] as string[],
  data: [] as string[],
  security: [] as string[],
  accessibility: [] as string[],
  performance: [] as string[],
};

export interface ParseResult {
  /** The parsed and normalized JSON object. */
  data: Record<string, unknown>;
  /** Whether the input contained valid JSON (before normalization). */
  jsonFound: boolean;
}

/**
 * Extract a JSON object from a raw provider response.
 *
 * 1. Strip code fences (```json ... ``` or ``` ... ```).
 * 2. Find the first `{` and last `}` to handle surrounding prose.
 * 3. Parse the JSON.
 * 4. Strip client-owned keys.
 * 5. Default missing requirements.
 */
export function extractAndNormalize(raw: string): ParseResult {
  let text = raw.trim();

  // Strip code fences.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Locate the JSON object boundaries.
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    return { data: {}, jsonFound: false };
  }

  const jsonText = text.slice(firstBrace, lastBrace + 1);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return { data: {}, jsonFound: false };
  }

  // Strip client-owned keys.
  for (const key of CLIENT_OWNED_KEYS) {
    delete parsed[key];
  }

  // Default missing requirements.
  if (parsed.requirements === undefined || parsed.requirements === null) {
    parsed.requirements = { ...EMPTY_REQUIREMENTS };
  } else if (typeof parsed.requirements === 'object') {
    const req = parsed.requirements as Record<string, unknown>;
    for (const key of Object.keys(EMPTY_REQUIREMENTS)) {
      if (!Array.isArray(req[key])) {
        req[key] = [];
      }
    }
  }

  return { data: parsed, jsonFound: true };
}
