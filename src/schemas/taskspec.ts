import { z } from 'zod';

/**
 * Zod mirror of schemas/taskspec.schema.json (v1.1.0).
 *
 * The canonical (enriched) TaskSpec. Produced by client enrichment of a
 * validated CompilerOutput. Only canonical TaskSpecs are rendered, stored,
 * or exported. Must behave identically to the JSON Schema for every
 * fixture in schemas/fixtures/taskspec/.
 */

export const taskSpecSchema = z
  .object({
    schema_version: z.literal('1.1.0'),
    task_id: z.string().regex(/^TASK-[0-9]{4}-[0-9]{4,}$/),
    project_id: z.string().min(1).max(128),
    task_type: z.enum([
      'planning', 'feature', 'ui', 'backend', 'database',
      'integration', 'bugfix', 'refactor', 'review',
      'security', 'testing', 'deployment',
    ]),
    execution_mode: z.enum(['quick', 'standard', 'deep', 'review', 'plan']),
    target_model: z.string().min(1).max(128),
    agent_runtime: z.enum(['claude-code', 'qwen-code', 'codex']),
    execution_profile: z.string().min(1).max(128),
    objective: z.string().min(10).max(500),
    user_value: z.string().max(500).optional(),
    current_state: z.array(z.string().min(1).max(500)).max(50).default([]),
    relevant_context: z.array(z.string().min(1).max(256)).max(20).default([]),
    assumptions: z.array(z.string().min(1).max(500)).max(20).default([]),
    blocking_questions: z.array(z.string().min(1).max(500)).max(3).default([]),
    scope: z.array(z.string().min(1).max(500)).min(1).max(50),
    out_of_scope: z.array(z.string().min(1).max(500)).max(50).default([]),
    requirements: z.object({
      functional: z.array(z.string().min(1).max(500)).max(50).default([]),
      frontend: z.array(z.string().min(1).max(500)).max(50).default([]),
      backend: z.array(z.string().min(1).max(500)).max(50).default([]),
      data: z.array(z.string().min(1).max(500)).max(50).default([]),
      security: z.array(z.string().min(1).max(500)).max(50).default([]),
      accessibility: z.array(z.string().min(1).max(500)).max(50).default([]),
      performance: z.array(z.string().min(1).max(500)).max(50).default([]),
    }).optional().default({
      functional: [],
      frontend: [],
      backend: [],
      data: [],
      security: [],
      accessibility: [],
      performance: [],
    }),
    edge_cases: z.array(z.string().min(1).max(500)).max(50).default([]),
    acceptance_criteria: z.array(z.string().min(1).max(500)).min(1).max(50),
    execution_plan: z.array(z.string().min(1).max(500)).max(50).default([]),
    test_plan: z.array(z.string().min(1).max(500)).max(50).default([]),
    stop_conditions: z.array(z.string().min(1).max(500)).max(20).default([]),
    final_report: z.array(z.string().min(1).max(256)).max(20).default([]),
    risk_level: z.enum(['low', 'medium', 'high']),
    confidence: z.number().min(0).max(1).optional(),
    estimated_prompt_tokens: z.number().int().min(0).optional(),
  })
  .strict();

export type TaskSpec = z.infer<typeof taskSpecSchema>;
