import { invokeIpc } from '../ipc';
import { getProject } from './projectsService';
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
  projectRoot: string;
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

interface GitValidationResult {
  isRepo: boolean;
}

/** Resolve and validate the exact registered root before any runtime launch. */
export async function validateRuntimeProject(projectId: string, boundRoot: string | null): Promise<string> {
  const project = await getProject(projectId);
  if (project === null) throw new Error('The registered project could not be found.');

  if (boundRoot !== null && boundRoot !== project.repoPath) {
    throw new Error(`OpenCode launch blocked: session cwd ${boundRoot} differs from registered project root ${project.repoPath}.`);
  }

  const resolvedRoot = await resolveProjectRoot(projectId);
  if (resolvedRoot !== project.repoPath) {
    throw new Error(`OpenCode launch blocked: resolved project root ${resolvedRoot} differs from registered project root ${project.repoPath}.`);
  }

  const git = await invokeIpc<GitValidationResult>('git_inspect', {
    repoPath: resolvedRoot,
    baseCommit: null,
  });
  if (!git.isRepo) {
    throw new Error(`OpenCode launch blocked: registered project root is not a Git repository: ${resolvedRoot}.`);
  }
  return resolvedRoot;
}

/** Launches a fixed runtime in the explicitly validated project root. Continuation text is optional and explicit. */
export async function launchRuntimeProcess(input: LaunchRuntimeInput): Promise<RuntimeLaunchResult> {
  return invokeIpc<RuntimeLaunchResult>('launch_runtime', {
    runtime: input.runtime,
    projectId: input.projectId,
    projectRoot: input.projectRoot,
    resume: input.resume,
    externalSessionId: input.externalSessionId,
    modelRef: input.modelRef,
    continuationPrompt: input.continuationPrompt ?? null,
  });
}
