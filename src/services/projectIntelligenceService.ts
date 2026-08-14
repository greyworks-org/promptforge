import { getAppDb } from '../db/appDb';
import {
  createProjectIntelligenceRepository,
  type ProjectIntelligenceRepository,
} from '../db/repos/projectIntelligence';
import type { QueryRunner } from '../db/runner';
import { deriveContinuationState, type ContinuationState } from '../handoff/continuationState';
import { deriveProjectIntelligence, type IntelligenceDocumentSource, type TaskEvidence } from '../intelligence/derive';
import {
  INTELLIGENCE_SCHEMA_VERSION,
  type NextTaskRecommendation,
  type ProjectIntelligence,
} from '../intelligence/types';
import { isBinaryByExtension, isBlockedFilePath } from '../redaction/blocklist';
import { taskSpecSchema, type TaskSpec } from '../schemas/taskspec';
import type { ExecutionSession, SessionEvent } from '../sessions/types';
import {
  listExecutionSessions,
  listSessionEvents,
} from '../sessions/executionSessionService';
import { listContextDocs } from './contextService';
import { getGitSnapshot, type GitSnapshot } from './gitState';
import { listHistory } from './historyService';
import { getMemory } from './memoryService';
import { listDirectory, readTextFile } from './projectFs';
import { inspectProjectGuidance } from './projectGuidance';
import { getProject } from './projectsService';

/**
 * Project Intelligence service.
 *
 * Gathers bounded evidence from the registered project (repository documents,
 * Git state, guidance files, context documents, persisted TaskSpecs, sessions,
 * checkpoints and verification records), derives the structured state, and
 * persists it. Bootstrapping and reconciliation share one derivation: an
 * existing record is merged, never reset.
 */

const MAX_DOCUMENTS = 18;
const MAX_DOCUMENT_CHARS = 16_000;
const DOCUMENT_PRIORITY = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'QWEN.md',
  'CODEX.md',
  'PRODUCT_SPEC.md',
  'docs/PROJECT_STATE.md',
  'docs/ROADMAP.md',
  'docs/ARCHITECTURE.md',
];

let testRunner: QueryRunner | null = null;
export function setDbForTests(runner: QueryRunner | null): void { testRunner = runner; }

async function repo(): Promise<ProjectIntelligenceRepository> {
  return createProjectIntelligenceRepository(testRunner ?? (await getAppDb()));
}

async function markdownPathsIn(projectId: string, directory: string, limit: number): Promise<string[]> {
  try {
    const entries = await listDirectory(projectId, directory);
    return entries
      .filter((entry) => !entry.isDir && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => (directory === '' ? entry.name : `${directory}/${entry.name}`))
      .filter((path) => !isBlockedFilePath(path) && !isBinaryByExtension(path))
      .sort()
      .slice(0, limit);
  } catch {
    // A project without a readable directory still has other evidence.
    return [];
  }
}

/** Documents whose name says they carry current state are read before the rest. */
const STATE_DOCUMENT = /state|status|next|progress|roadmap|plan|durum|sonraki|s[iı]radaki/i;

/** Bounded, read-only inventory of the repository documents that carry intent. */
async function gatherDocuments(projectId: string): Promise<IntelligenceDocumentSource[]> {
  const discovered = [
    ...(await markdownPathsIn(projectId, '', 8)),
    ...(await markdownPathsIn(projectId, 'docs', 10)),
    // Decision and design records are the strongest evidence of intent.
    ...(await markdownPathsIn(projectId, 'docs/decisions', 6)),
    ...(await markdownPathsIn(projectId, 'docs/designs', 6)),
  ];
  const candidates = [...new Set([
    ...DOCUMENT_PRIORITY,
    ...discovered.filter((path) => STATE_DOCUMENT.test(path)),
    ...discovered,
  ])];
  const documents: IntelligenceDocumentSource[] = [];
  for (const path of candidates) {
    if (documents.length >= MAX_DOCUMENTS) break;
    try {
      const content = await readTextFile(projectId, path);
      if (content.trim() === '') continue;
      documents.push({ path, content: content.slice(0, MAX_DOCUMENT_CHARS) });
    } catch {
      // A missing candidate document is normal, not an error.
    }
  }
  return documents;
}

interface SessionEvidence {
  session: ExecutionSession;
  events: SessionEvent[];
}

async function gatherSessions(projectId: string): Promise<SessionEvidence[]> {
  try {
    const sessions = await listExecutionSessions(projectId);
    const evidence: SessionEvidence[] = [];
    for (const session of sessions) {
      try {
        evidence.push({ session, events: await listSessionEvents(projectId, session.id) });
      } catch {
        evidence.push({ session, events: [] });
      }
    }
    return evidence;
  } catch {
    return [];
  }
}

function readyEvidence(events: SessionEvent[]): string[] {
  return events
    .filter((event) => event.metadata.outcome === 'READY')
    .map((event) => event.content);
}

function taskStatusFor(
  compilationId: string,
  lastValidatedTaskId: string | null,
  currentTaskId: string | null,
  sessions: SessionEvidence[],
): { status: TaskEvidence['status']; verificationEvidence: string[] } {
  const owned = sessions.filter((item) => item.session.compilationId === compilationId);
  const ready = owned.flatMap((item) => readyEvidence(item.events));
  const evidence = [
    ...ready,
    ...owned.flatMap((item) => (item.session.state.lastValidation ? [item.session.state.lastValidation] : [])),
  ];
  // Completion requires PromptForge-side verification: an explicit validated
  // task, a completed session, or a recorded READY completion outcome.
  const verified = lastValidatedTaskId === compilationId
    || owned.some((item) => item.session.status === 'completed')
    || ready.length > 0;
  if (verified) return { status: 'verified', verificationEvidence: evidence };
  if (currentTaskId === compilationId) return { status: 'active', verificationEvidence: [] };
  return { status: 'unverified', verificationEvidence: [] };
}

function parseTask(json: string | null): TaskSpec | null {
  if (json === null) return null;
  try {
    return taskSpecSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

export interface ProjectIntelligenceInputs {
  intelligence: ProjectIntelligence;
  continuation: ContinuationState | null;
  activeTask: TaskSpec | null;
  git: GitSnapshot;
}

async function deriveAndPersist(projectId: string): Promise<ProjectIntelligenceInputs> {
  const project = await getProject(projectId);
  if (project === null) throw new Error('The registered project could not be found.');

  const memory = await getMemory(projectId);
  const git = await getGitSnapshot(projectId, memory.baseCommit ?? undefined);
  const [documents, guidance, contextDocuments, sessions] = await Promise.all([
    gatherDocuments(projectId),
    inspectProjectGuidance(projectId).catch(() => []),
    listContextDocs(projectId).catch(() => []),
    gatherSessions(projectId),
  ]);

  let compilations: Awaited<ReturnType<typeof listHistory>> = [];
  try {
    compilations = await listHistory(projectId, 200, 0);
  } catch {
    // History is supporting evidence; the record is still derivable without it.
  }

  const tasks: TaskEvidence[] = [];
  let activeTask: TaskSpec | null = null;
  for (const compilation of compilations) {
    const task = parseTask(compilation.taskspecJson);
    if (task === null || task.project_id !== projectId) continue;
    const resolved = taskStatusFor(compilation.id, memory.lastValidatedTaskId, memory.currentTaskId, sessions);
    if (compilation.id === memory.currentTaskId) activeTask = task;
    tasks.push({
      compilationId: compilation.id,
      taskId: task.task_id,
      objective: task.objective,
      acceptanceCriteria: task.acceptance_criteria,
      outOfScope: task.out_of_scope,
      constraints: [
        ...(task.execution_contract?.preserve ?? []),
        ...(task.execution_contract?.invariants ?? []),
      ],
      status: resolved.status,
      verificationEvidence: resolved.verificationEvidence,
    });
  }

  const activeSession = sessions.find((item) => item.session.compilationId === memory.currentTaskId) ?? null;
  const continuation = memory.currentTaskId === null && activeSession === null
    ? null
    : deriveContinuationState({
        task: activeTask,
        session: activeSession?.session ?? null,
        events: activeSession?.events ?? [],
        memory,
        git,
        target: activeSession === null
          ? undefined
          : { runtime: activeSession.session.runtime, binding: activeSession.session.binding },
      });

  const existing = await (await repo()).getByProject(projectId);
  const document = deriveProjectIntelligence({
    project: {
      id: project.id,
      name: project.name,
      repoPath: project.repoPath,
      currentMilestone: project.currentMilestone,
    },
    documents,
    contextDocuments: contextDocuments.map((item) => ({ relPath: item.relPath, summary: item.summary })),
    guidancePaths: guidance.map((entry) => entry.path),
    git,
    memory,
    tasks,
    continuation,
    existing,
  });

  const now = new Date().toISOString();
  const intelligence = await (await repo()).upsert(projectId, {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    document,
    sourceHead: git.head?.hash ?? null,
    bootstrappedAt: existing?.bootstrappedAt ?? now,
    reconciledAt: now,
  });
  return { intelligence, continuation, activeTask, git };
}

/** Persisted record only; null when the project has never been bootstrapped. */
export async function getProjectIntelligence(projectId: string): Promise<ProjectIntelligence | null> {
  return (await repo()).getByProject(projectId);
}

/**
 * Bounded bootstrap/reconciliation action. Creating the first record and
 * refreshing an existing one run the same evidence derivation; the original
 * bootstrap timestamp and still-supported facts are preserved.
 */
export async function bootstrapProjectIntelligence(projectId: string): Promise<ProjectIntelligenceInputs> {
  return deriveAndPersist(projectId);
}

/** Explicit reconciliation entry point. Never recreates state from scratch. */
export async function reconcileProjectIntelligence(projectId: string): Promise<ProjectIntelligenceInputs> {
  return deriveAndPersist(projectId);
}

/** Read the record, bootstrapping it once when the project has none yet. */
export async function ensureProjectIntelligence(projectId: string): Promise<ProjectIntelligence> {
  const existing = await getProjectIntelligence(projectId);
  if (existing !== null) return existing;
  return (await bootstrapProjectIntelligence(projectId)).intelligence;
}

export interface NextTaskSuggestion {
  intelligence: ProjectIntelligence;
  recommendation: NextTaskRecommendation | null;
}

/**
 * The recommendation is Compiler input. It never becomes a TaskSpec on its own
 * and never starts execution.
 */
export async function recommendNextTask(projectId: string): Promise<NextTaskSuggestion> {
  const intelligence = await ensureProjectIntelligence(projectId);
  return { intelligence, recommendation: intelligence.recommendation };
}

/** Bounded, provider-safe intelligence summary for a Compiler request. */
export function compilerIntelligenceSummary(intelligence: ProjectIntelligence): {
  product: string | null;
  architecture: string[];
  constraints: string[];
  nonGoals: string[];
  decisions: string[];
  milestones: string[];
  verifiedComplete: string[];
  partial: string[];
  blocked: string[];
  remaining: string[];
  unknowns: string[];
} {
  const statements = (facts: Array<{ statement: string }>, limit: number): string[] =>
    facts.slice(0, limit).map((item) => item.statement);
  return {
    product: intelligence.product,
    architecture: statements(intelligence.architecture, 10),
    constraints: statements(intelligence.constraints, 10),
    nonGoals: statements(intelligence.nonGoals, 8),
    decisions: statements(intelligence.decisions, 8),
    milestones: statements(intelligence.milestones, 5),
    verifiedComplete: statements(intelligence.verifiedComplete, 10),
    partial: statements(intelligence.partial, 8),
    blocked: statements(intelligence.blocked, 6),
    remaining: statements(intelligence.remaining, 10),
    unknowns: intelligence.unknowns.slice(0, 8),
  };
}
