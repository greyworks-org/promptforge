import { z } from 'zod';
import { invokeIpc } from '../ipc';
import { resolveProjectRoot } from './projectFs';

/** Provider/model capability data exposed by the OpenCode runtime boundary. */
export const openCodeModelSchema = z.object({
  runtime: z.literal('opencode'),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  modelRef: z.string().min(3),
  displayName: z.string().min(1),
  available: z.boolean(),
  configured: z.boolean(),
  availability: z.enum(['available', 'configured', 'unknown']),
}).strict();
export type OpenCodeModel = z.infer<typeof openCodeModelSchema>;

export const openCodeModelDiscoverySchema = z.object({
  runtime: z.literal('opencode'),
  models: z.array(openCodeModelSchema),
  source: z.enum(['opencode-cli', 'configured-fallback', 'unavailable']),
  warning: z.string().nullable(),
}).strict();
export type OpenCodeModelDiscovery = z.infer<typeof openCodeModelDiscoverySchema>;

function modelFromRef(modelRef: string): OpenCodeModel | null {
  const separator = modelRef.indexOf('/');
  if (separator <= 0 || separator === modelRef.length - 1) return null;
  const providerId = modelRef.slice(0, separator);
  const modelId = modelRef.slice(separator + 1);
  return {
    runtime: 'opencode',
    providerId,
    modelId,
    modelRef,
    displayName: modelRef,
    available: false,
    configured: false,
    availability: 'unknown',
  };
}

/**
 * Gets OpenCode's current model/provider capability read model. The Rust
 * boundary executes OpenCode's own catalog command and never returns config
 * contents or credentials. A persisted selection is retained as an unknown
 * capability when the external catalog is temporarily unavailable.
 */
export async function getOpenCodeModelDiscovery(
  projectId: string,
  selectedModelRef?: string | null,
): Promise<OpenCodeModelDiscovery> {
  const projectRoot = await resolveProjectRoot(projectId);
  const raw = await invokeIpc<unknown>('opencode_models', { projectRoot });
  const discovery = openCodeModelDiscoverySchema.parse(raw);
  if (!selectedModelRef || discovery.models.some((model) => model.modelRef === selectedModelRef)) {
    return discovery;
  }
  const selected = modelFromRef(selectedModelRef);
  if (!selected) return discovery;
  return { ...discovery, models: [...discovery.models, selected] };
}

