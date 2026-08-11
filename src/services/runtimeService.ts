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
  continuationPrompt?: string | null;
}

export interface RuntimeLaunchResult {
  started: boolean;
  pid: number | null;
  exitCode: number | null;
  stderr: string | null;
}

/** Launches a fixed runtime binary in the registered project root. Continuation text is optional and explicit. */
export async function launchRuntimeProcess(input: LaunchRuntimeInput): Promise<RuntimeLaunchResult> {
  const projectRoot = await resolveProjectRoot(input.projectId);
  return invokeIpc<RuntimeLaunchResult>('launch_runtime', {
    runtime: input.runtime,
    projectRoot,
    resume: input.resume,
    externalSessionId: input.externalSessionId,
    modelRef: input.modelRef,
    continuationPrompt: input.continuationPrompt ?? null,
  });
}
