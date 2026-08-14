import { z } from 'zod';

/**
 * Project Intelligence contract.
 *
 * Every statement carries at least one evidence reference. A claim without
 * evidence is never stored as a fact — it stays UNKNOWN. Repository changes
 * alone are evidence of activity, never of completion.
 */

export const INTELLIGENCE_SCHEMA_VERSION = '1.0.0';

/** `<kind>:<reference>` — the exact artefact a statement was derived from. */
export const evidenceReferenceSchema = z.string().min(3).max(400);

export const intelligenceFactSchema = z
  .object({
    statement: z.string().min(1).max(600),
    evidence: z.array(evidenceReferenceSchema).min(1).max(12),
  })
  .strict();
export type IntelligenceFact = z.infer<typeof intelligenceFactSchema>;

/**
 * Why PromptForge believes this is the next bounded task. `basis` names the
 * evidence class; there is no "inferred roadmap" basis on purpose.
 */
export const recommendationBasisSchema = z.enum([
  'blocker',
  'remaining-task-item',
  'unverified-progress',
  'active-milestone',
]);
export type RecommendationBasis = z.infer<typeof recommendationBasisSchema>;

export const nextTaskRecommendationSchema = z
  .object({
    basis: recommendationBasisSchema,
    /** Short intent text. It is Compiler input, never a TaskSpec. */
    intent: z.string().min(1).max(600),
    rationale: z.string().min(1).max(600),
    evidence: z.array(evidenceReferenceSchema).min(1).max(12),
  })
  .strict();
export type NextTaskRecommendation = z.infer<typeof nextTaskRecommendationSchema>;

export const projectIntelligenceDocumentSchema = z
  .object({
    /** Null means UNKNOWN: no repository evidence describes the product. */
    product: z.string().min(1).max(1200).nullable(),
    architecture: z.array(intelligenceFactSchema).max(60),
    constraints: z.array(intelligenceFactSchema).max(60),
    nonGoals: z.array(intelligenceFactSchema).max(60),
    decisions: z.array(intelligenceFactSchema).max(60),
    milestones: z.array(intelligenceFactSchema).max(30),
    verifiedComplete: z.array(intelligenceFactSchema).max(80),
    partial: z.array(intelligenceFactSchema).max(80),
    blocked: z.array(intelligenceFactSchema).max(40),
    remaining: z.array(intelligenceFactSchema).max(80),
    unknowns: z.array(z.string().min(1).max(400)).max(40),
    evidence: z.array(evidenceReferenceSchema).max(200),
    recommendation: nextTaskRecommendationSchema.nullable(),
  })
  .strict();
export type ProjectIntelligenceDocument = z.infer<typeof projectIntelligenceDocumentSchema>;

export interface ProjectIntelligence extends ProjectIntelligenceDocument {
  projectId: string;
  schemaVersion: string;
  /** Repository HEAD observed when this record was last derived. */
  sourceHead: string | null;
  bootstrappedAt: string;
  reconciledAt: string;
  updatedAt: string;
}

export function emptyIntelligenceDocument(): ProjectIntelligenceDocument {
  return {
    product: null,
    architecture: [],
    constraints: [],
    nonGoals: [],
    decisions: [],
    milestones: [],
    verifiedComplete: [],
    partial: [],
    blocked: [],
    remaining: [],
    unknowns: [],
    evidence: [],
    recommendation: null,
  };
}
