import { z } from 'zod';

const deliverySliceSchema = z.object({
  title: z.string().min(1).max(200),
  scope: z.array(z.string().min(1).max(500)).min(1).max(20),
  verification: z.array(z.string().min(1).max(500)).min(1).max(10),
}).strict();

const executionContractSchema = z.object({
  core_loop: z.array(z.string().min(1).max(500)).max(12).optional(),
  invariants: z.array(z.string().min(1).max(500)).max(20).optional(),
  preserve: z.array(z.string().min(1).max(500)).max(20).optional(),
  verification: z.array(z.string().min(1).max(500)).max(20).optional(),
  delivery_slices: z.array(deliverySliceSchema).max(5).optional(),
}).strict();

const qualityProfileSchema = z.object({
  product_outcome: z.string().min(1).max(500).optional(),
  ux_constraints: z.array(z.string().min(1).max(500)).max(20).optional(),
  preferences: z.array(z.string().min(1).max(500)).max(20).optional(),
  anti_slop: z.array(z.string().min(1).max(500)).max(12).optional(),
  completion_checks: z.array(z.string().min(1).max(500)).max(20).optional(),
  visual_review: z.boolean().optional(),
}).strict();

/**
 * Zod mirror of schemas/compiler-output.schema.json (v1.1.0).
 *
 * This is what the compiler model must produce. Client-owned identifiers
 * (task_id, project_id, schema_version) are deliberately absent — they are
 * rejected by .strict(). Unknown fields are also rejected. The Zod schema
 * must behave identically to the JSON Schema for every fixture in
 * schemas/fixtures/compiler-output/.
 */

export const compilerOutputSchema = z
  .object({
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
    execution_contract: executionContractSchema.optional(),
    quality_profile: qualityProfileSchema.optional(),
    risk_level: z.enum(['low', 'medium', 'high']),
    confidence: z.number().min(0).max(1).optional(),
    estimated_prompt_tokens: z.number().int().min(0).optional(),
  })
  .strict();

export type CompilerOutput = z.infer<typeof compilerOutputSchema>;
