import type { ContinuationStatus } from '../handoff/continuationState';
import type { NextTaskRecommendation } from '../intelligence/types';
import { runtimeModelRef } from '../models/catalog';
import {
  getExecutionSessionView,
  launchExecutionSessionThroughOpenCode,
  listExecutionSessions,
  renderSessionTask,
  switchSessionModel,
} from '../sessions/executionSessionService';
import type { ExecutionSession, SessionRuntime } from '../sessions/types';
import { getMemory } from './memoryService';
import { recommendNextTask } from './projectIntelligenceService';
import { getProjectByRepoPath } from './projectsService';
import { listProfiles } from './settingsService';

/**
 * Project-aware resume.
 *
 * The workspace repository root is the only input. PromptForge resolves the
 * registered project, reconciles live repository state, derives a fresh
 * ContinuationState and decides from the existing lifecycle whether execution
 * is allowed. It never duplicates state, never guesses a model, and never
 * executes a completed, blocked or review-pending task.
 */

export type ProjectResumeStatus =
  | 'executed'
  | 'completed'
  | 'blocked'
  | 'needs-human-review'
  | 'no-active-task'
  | 'no-project'
  | 'configuration-required'
  | 'failed';

export interface ProjectResumeOutcome {
  status: ProjectResumeStatus;
  repoRoot: string;
  projectId: string | null;
  projectName: string | null;
  sessionId: string | null;
  runtime: SessionRuntime | null;
  modelRef: string | null;
  taskObjective: string | null;
  taskStatus: ContinuationStatus | null;
  nextAction: string | null;
  blockers: string[];
  recommendation: NextTaskRecommendation | null;
  message: string;
}

function outcome(partial: Partial<ProjectResumeOutcome> & { status: ProjectResumeStatus; repoRoot: string; message: string }): ProjectResumeOutcome {
  return {
    projectId: null,
    projectName: null,
    sessionId: null,
    runtime: null,
    modelRef: null,
    taskObjective: null,
    taskStatus: null,
    nextAction: null,
    blockers: [],
    recommendation: null,
    ...partial,
  };
}

async function safeRecommendation(projectId: string): Promise<NextTaskRecommendation | null> {
  try {
    return (await recommendNextTask(projectId)).recommendation;
  } catch {
    // A project without derivable intelligence still gets the Compiler path.
    return null;
  }
}

/**
 * The exact OpenCode reference saved for this session, or the one stored in the
 * provider profile the session is bound to. Nothing else is ever substituted.
 */
async function resolveSavedModelRef(session: ExecutionSession): Promise<string | null> {
  if (session.binding.modelRef !== null && session.binding.modelRef.trim() !== '') return session.binding.modelRef;
  if (session.binding.providerId === null || session.binding.modelId === null) return null;
  let profiles: Awaited<ReturnType<typeof listProfiles>>;
  try {
    profiles = await listProfiles();
  } catch {
    return null;
  }
  const profile = profiles.find((candidate) => candidate.providerId === session.binding.providerId
    && candidate.modelId === session.binding.modelId);
  return profile === undefined ? null : runtimeModelRef(profile);
}

export async function resumeCurrentProject(repoRoot: string): Promise<ProjectResumeOutcome> {
  const project = await getProjectByRepoPath(repoRoot);
  if (project === null) {
    return outcome({
      status: 'no-project',
      repoRoot,
      message: `No PromptForge project is registered for ${repoRoot}. Register this folder in PromptForge first.`,
    });
  }

  const base = { repoRoot, projectId: project.id, projectName: project.name };
  const memory = await getMemory(project.id);
  const sessions = await listExecutionSessions(project.id);
  const session = memory.currentTaskId === null
    ? null
    : sessions.find((candidate) => candidate.compilationId === memory.currentTaskId) ?? null;

  if (session === null) {
    return outcome({
      ...base,
      status: 'no-active-task',
      message: 'No active task exists for this project.',
      recommendation: await safeRecommendation(project.id),
    });
  }

  // Reconciles live Git state and derives the current ContinuationState.
  const view = await getExecutionSessionView(project.id, session.id);
  const state = view.continuationState;
  const shared = {
    ...base,
    sessionId: session.id,
    runtime: session.runtime,
    taskObjective: view.task.objective || null,
    taskStatus: state.taskStatus,
    nextAction: state.nextAction,
    blockers: state.blockers,
  };

  if (state.taskStatus === 'completed') {
    return outcome({
      ...shared,
      status: 'completed',
      message: 'Current task complete.',
      recommendation: await safeRecommendation(project.id),
    });
  }
  if (state.taskStatus === 'blocked') {
    return outcome({
      ...shared,
      status: 'blocked',
      message: state.blockers[0] ?? 'The current task is blocked.',
    });
  }
  if (state.taskStatus === 'needs human review') {
    return outcome({
      ...shared,
      status: 'needs-human-review',
      message: 'The completion gate requires a human review decision before further execution.',
    });
  }

  const modelRef = await resolveSavedModelRef(session);
  if (modelRef === null) {
    return outcome({
      ...shared,
      status: 'configuration-required',
      message: 'CONFIGURATION REQUIRED: no saved OpenCode model reference exists for this session. Set the runtime model reference on the provider profile in PromptForge Settings.',
    });
  }
  if (session.binding.modelRef !== modelRef
    && session.binding.providerId !== null && session.binding.modelId !== null) {
    await switchSessionModel(project.id, session.id, {
      providerId: session.binding.providerId,
      modelId: session.binding.modelId,
      modelRef,
    });
  }

  const mode = view.events.some((event) => event.kind === 'runtime_launch') ? 'resume' : 'start';
  const continuation = await renderSessionTask(project.id, session.id, session.userInstruction);
  try {
    await launchExecutionSessionThroughOpenCode(project.id, session.id, mode, continuation);
  } catch (error) {
    return outcome({
      ...shared,
      status: 'failed',
      modelRef,
      message: error instanceof Error ? error.message : 'OpenCode could not be launched.',
    });
  }
  return outcome({
    ...shared,
    status: 'executed',
    modelRef,
    message: `OpenCode ${mode} started with the current continuation for ${project.name}.`,
  });
}
