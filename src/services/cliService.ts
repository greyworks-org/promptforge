import { invokeIpc } from '../ipc';
import { resolveProjectRoot } from './projectFs';

/**
 * CLI delivery service (Phase 11).
 *
 * All delivery operations accept `projectId` and resolve the canonical
 * project root from the Rust registry (same trust boundary as Phase 3
 * fs commands). The frontend cannot supply an arbitrary path.
 *
 * Boundaries:
 * - Open in Terminal targets only the registered project's canonical root.
 * - CLI launch requires explicit user confirmation (caller responsibility).
 * - Executables come only from the validated runtime/profile mapping.
 * - No user/model content can inject executable names or arguments.
 * - Working directory = registered project root (resolved from projectId).
 * - Delivery = clipboard + launched session (no pipe/injection).
 * - No shell command ever constructed from TaskSpec/memory content.
 */

/** Runtime → default CLI binary name mapping. */
export const RUNTIME_BINARIES: Record<string, string> = {
  'claude-code': 'claude',
  'qwen-code': 'qwen',
  'codex': 'codex',
};

export function resolveBinary(runtime: string): { ok: true; binary: string } | { ok: false; error: string } {
  const binary = RUNTIME_BINARIES[runtime];
  if (!binary) {
    return { ok: false, error: `Unknown runtime: '${runtime}'. Supported: ${Object.keys(RUNTIME_BINARIES).join(', ')}` };
  }
  return { ok: true, binary };
}

export function validateBinaryName(name: string): { ok: true } | { ok: false; error: string } {
  if (name.length === 0) return { ok: false, error: 'Binary name must not be empty.' };
  if (name.includes('/')) return { ok: false, error: 'Binary name must not contain path separators.' };
  if (name.includes('\\')) return { ok: false, error: 'Binary name must not contain path separators.' };
  if (/[;&|$`!<>(){}[\]*?#~]/.test(name)) {
    return { ok: false, error: `Binary name contains unsafe characters: '${name}'` };
  }
  return { ok: true };
}

/**
 * Open a terminal at the project root, resolved from the registered
 * `projectId`. The frontend cannot supply an arbitrary path.
 */
export async function openTerminal(projectId: string): Promise<void> {
  const root = await resolveProjectRoot(projectId);
  await invokeIpc('open_terminal', { projectRoot: root });
}

/**
 * Launch a CLI binary at the project root, resolved from the registered
 * `projectId`. No prompt text is injected — delivery = clipboard +
 * launched session. Caller must obtain user confirmation before calling.
 */
export async function launchCli(binary: string, projectId: string): Promise<void> {
  const binCheck = validateBinaryName(binary);
  if (!binCheck.ok) throw new Error(binCheck.error);
  const root = await resolveProjectRoot(projectId);
  await invokeIpc('launch_cli', { binaryPath: binary, projectRoot: root });
}

/**
 * Full delivery flow from a runtime selection:
 * 1. Resolve runtime → binary name.
 * 2. Validate binary name.
 * 3. Resolve project root from projectId (Rust registry).
 * 4. Return the launch parameters (caller handles user confirmation UI).
 *
 * This function starts no process — it is pure validation + resolution.
 */
export async function prepareDelivery(
  runtime: string,
  projectId: string,
): Promise<{ ok: true; binary: string; projectRoot: string } | { ok: false; error: string }> {
  const binResult = resolveBinary(runtime);
  if (!binResult.ok) return binResult;

  const nameCheck = validateBinaryName(binResult.binary);
  if (!nameCheck.ok) return nameCheck;

  try {
    const root = await resolveProjectRoot(projectId);
    return { ok: true, binary: binResult.binary, projectRoot: root };
  } catch (err) {
    return { ok: false, error: `Could not resolve project root: ${err instanceof Error ? err.message : String(err)}` };
  }
}
