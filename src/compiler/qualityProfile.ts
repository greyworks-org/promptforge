import type { CompilerOutput } from '../schemas/compilerOutput';

/** Compact defaults used only when the compiled task has a visual surface. */
export const DEFAULT_ANTI_SLOP = [
  'Use hierarchy through spacing and typography; avoid unnecessary containers or nested cards.',
  'Avoid decorative badges, gratuitous shadows, gradients, glass effects and emojis unless they convey meaning.',
  'Avoid repetitive feature grids, repeated headings, filler marketing copy, invented metrics, testimonials or fake states.',
];

function hasVisualSurface(output: CompilerOutput): boolean {
  return output.task_type === 'ui'
    || (output.requirements?.frontend?.length ?? 0) > 0
    || output.quality_profile?.visual_review === true;
}

/**
 * Add bounded visual-quality defaults without changing backend-only tasks.
 * Explicit quality guidance is preserved and therefore takes precedence.
 */
export function withQualityProfileDefaults(output: CompilerOutput): CompilerOutput {
  if (!hasVisualSurface(output)) return output;

  const existing = output.quality_profile;
  if (existing?.anti_slop !== undefined || existing?.visual_review === false) return output;

  return {
    ...output,
    quality_profile: {
      ...existing,
      product_outcome: existing?.product_outcome ?? output.objective,
      anti_slop: [...DEFAULT_ANTI_SLOP],
      visual_review: existing?.visual_review ?? true,
    },
  };
}
