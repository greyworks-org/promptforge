import { invokeIpc } from '../ipc';
import { resolveProjectRoot } from './projectFs';
import type { SessionRuntime } from '../sessions/types';

export interface RuntimeAvailability {
  runtime: SessionRuntime;
  binary: string;
  installed: boolean;
  canLaunch: boolean;
  supportsResume: boolean;
  supportsModelRouting: boolean;
  version: string | null;
  capabilities: string[];
  error: string | null;
}

interface RuntimeStatusResponse extends RuntimeAvailability {}

export async function detectRuntime(runtime: SessionRuntime): Promise<RuntimeAvailability> {
  return invokeIpc<RuntimeStatusResponse>('runtime_status', { runtime });
}

export interface LaunchRuntimeInput {
  runtime: SessionRuntime;
  projectId: string;
  resume: boolean;
  externalSessionId: string | null;
  modelRef: string | null;
}

/** Launches a fixed runtime binary in the registered project root. No prompt text is injected. */
export async function launchRuntimeProcess(input: LaunchRuntimeInput): Promise<void> {
  const projectRoot = await resolveProjectRoot(input.projectId);
  await invokeIpc('launch_runtime', {
    runtime: input.runtime,
    projectRoot,
    resume: input.resume,
    externalSessionId: input.externalSessionId,
    modelRef: input.modelRef,
  });
}
