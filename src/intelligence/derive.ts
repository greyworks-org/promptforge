import type { MemoryRecord } from '../db/repos/projectMemory';
import type { ContinuationState } from '../handoff/continuationState';
import type { GitSnapshot } from '../services/gitState';
import {
  emptyIntelligenceDocument,
  type IntelligenceFact,
  type NextTaskRecommendation,
  type ProjectIntelligence,
  type ProjectIntelligenceDocument,
} from './types';

/**
 * Evidence-only derivation of Project Intelligence.
 *
 * Rules enforced here and relied on by the rest of the product:
 * - Every fact carries the artefact it came from. No evidence, no fact.
 * - Only PromptForge-side verification produces `verifiedComplete`.
 *   Repository content and repository changes are UNVERIFIED evidence.
 * - Anything the evidence does not answer stays in `unknowns`.
 * - Reconciliation merges with the previous record; it never resets it.
 */

export interface IntelligenceDocumentSource {
  /** Repository-relative path; also used as the evidence reference. */
  path: string;
  content: string;
}

export type TaskEvidenceStatus = 'verified' | 'active' | 'unverified';

export interface TaskEvidence {
  compilationId: string;
  taskId: string;
  objective: string;
  acceptanceCriteria: string[];
  outOfScope: string[];
  /** `execution_contract.preserve` + `.invariants`. */
  constraints: string[];
  status: TaskEvidenceStatus;
  verificationEvidence: string[];
}

export interface IntelligenceEvidenceBundle {
  project: { id: string; name: string; repoPath: string; currentMilestone: string | null };
  documents: IntelligenceDocumentSource[];
  contextDocuments: Array<{ relPath: string; summary: string | null }>;
  guidancePaths: string[];
  git: GitSnapshot;
  memory: MemoryRecord;
  tasks: TaskEvidence[];
  continuation: ContinuationState | null;
  existing: ProjectIntelligence | null;
}

const MAX_STATEMENT = 300;
const MAX_PER_CATEGORY = 24;

// Heading vocabulary is bilingual because project documents in this product are
// written in English or Turkish. Only the vocabulary is language-aware; no
// project-specific conclusion is encoded anywhere in this file.
const ARCHITECTURE_HEADING = /architect|structure|stack|module|folder map|data model|component|pipeline|system|what it does|end to end|how it works|overview|flow|mimari|yap[iı]|ak[iı][sş]|nas[iı]l çal|ne in[sş]a/i;
const CONSTRAINT_HEADING = /rule|constraint|standard|security|discipline|invariant|polic|guardrail|safety|convention|guarantee|definition of done|privacy|quality gate|before touching|kural|k[iı]s[iı]t|güvenlik|garanti|de[gğ]i[sş]meyecek|kalite|tuzak|bilmen gereken/i;
const NON_GOAL_HEADING = /non-goal|not in scope|out of scope|will not|won'?t|excluded|do not|never|olmayacak|kapsam d[iı][sş][iı]|de[gğ]ildir/i;
const BLOCKER_HEADING = /blocker|blocked|known issue|open bug|open problem|limitation|risk|engel|bilinen sorun|bo[sş]luk/i;
const REMAINING_HEADING = /next|todo|to do|remaining|roadmap|backlog|milestone|phase|plan|upcoming|outstanding|s[iı]radaki|sonraki|kalan|yap[iı]lacak|faz/i;
const MILESTONE_HEADING = /milestone|phase|roadmap|release|sprint|faz|s[üu]r[üu]m|kilometre/i;
const ARCHITECTURE_DOCUMENT = /architect|design|structure|adapter|data.?model/i;

/**
 * Sentence-level classification for documents that do not organise state under
 * headings. A deliberate design statement is a non-goal, never a blocker; an
 * explicit incompleteness marker is outstanding work, never a blocker. Only a
 * blocker-titled section or persisted PromptForge state can declare a blocker.
 */
const NON_GOAL_MARKER = /\b(never|deliberately not|intentionally not|by design|no automated|must not|refuses to|is not supported|will not|out of scope)\b/i;
const INCOMPLETE_MARKER = /\b(not complete|incomplete|not yet|unfinished|todo|to do|still missing|unimplemented|not implemented|work in progress)\b/i;

interface DocumentSection {
  heading: string;
  /** Heading breadcrumb, so a subsection inherits its parent's classification. */
  path: string[];
  bullets: string[];
  doneBullets: string[];
  openBullets: string[];
  paragraphs: string[];
}

function clean(text: string): string {
  return text
    .replace(/`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_]{1,3}/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_STATEMENT);
}

/** Bounded markdown reader: headings, bullets, checkbox state, paragraphs. */
export function parseSections(content: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  // The document title is a name, not a classification, so it never
  // propagates its wording to the sections underneath it.
  const ancestors: Array<{ level: number; heading: string; isTitle: boolean }> = [];
  let titleSeen = false;
  let current: DocumentSection = { heading: '', path: [], bullets: [], doneBullets: [], openBullets: [], paragraphs: [] };
  let inFence = false;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading !== null) {
      sections.push(current);
      const level = heading[1].length;
      const text = clean(heading[2]);
      while (ancestors.length > 0 && ancestors[ancestors.length - 1].level >= level) ancestors.pop();
      const isTitle = level === 1 && !titleSeen;
      if (isTitle) titleSeen = true;
      ancestors.push({ level, heading: text, isTitle });
      current = {
        heading: text,
        path: ancestors.filter((item) => !item.isTitle).map((item) => item.heading),
        bullets: [], doneBullets: [], openBullets: [], paragraphs: [],
      };
      continue;
    }
    const bullet = line.match(/^\s{0,8}(?:[-*+]|\d+\.)\s+(.*)$/);
    if (bullet !== null) {
      const checkbox = bullet[1].match(/^\[( |x|X)\]\s*(.*)$/);
      const text = clean(checkbox === null ? bullet[1] : checkbox[2]);
      if (text.length < 8) continue;
      current.bullets.push(text);
      if (checkbox !== null) {
        if (checkbox[1].toLowerCase() === 'x') current.doneBullets.push(text);
        else current.openBullets.push(text);
      }
      continue;
    }
    const text = clean(line);
    if (text.length >= 20) current.paragraphs.push(text);
  }
  sections.push(current);
  return sections.filter((section) => section.heading !== '' || section.bullets.length > 0 || section.paragraphs.length > 0);
}

function fact(statement: string, evidence: string[]): IntelligenceFact | null {
  const normalized = statement.trim().slice(0, MAX_STATEMENT);
  const references = [...new Set(evidence.map((item) => item.trim()).filter((item) => item.length >= 3))].slice(0, 12);
  if (normalized.length === 0 || references.length === 0) return null;
  return { statement: normalized, evidence: references };
}

function collect(items: Array<IntelligenceFact | null>): IntelligenceFact[] {
  const byStatement = new Map<string, IntelligenceFact>();
  for (const item of items) {
    if (item === null) continue;
    const existing = byStatement.get(item.statement);
    if (existing === undefined) {
      byStatement.set(item.statement, item);
      continue;
    }
    byStatement.set(item.statement, {
      statement: item.statement,
      evidence: [...new Set([...existing.evidence, ...item.evidence])].slice(0, 12),
    });
  }
  return [...byStatement.values()].slice(0, MAX_PER_CATEGORY);
}

function bulletsUnder(
  documents: IntelligenceDocumentSource[],
  heading: RegExp,
  documentPath?: RegExp,
): Array<IntelligenceFact | null> {
  const facts: Array<IntelligenceFact | null> = [];
  for (const document of documents) {
    const pathMatches = documentPath !== undefined && documentPath.test(document.path);
    for (const section of parseSections(document.content)) {
      const breadcrumb = section.path.join(' > ');
      const headingMatches = breadcrumb !== '' && heading.test(breadcrumb);
      if (!pathMatches && !headingMatches) continue;
      const reference = `document:${document.path}${section.heading === '' ? '' : `#${section.heading}`}`;
      // A subsection title under a matching parent is itself a statement.
      if (headingMatches && section.path.length > 1 && !heading.test(section.heading)) {
        facts.push(fact(section.heading, [reference]));
      }
      for (const bullet of section.bullets.slice(0, 12)) {
        facts.push(fact(bullet, [reference]));
      }
    }
  }
  return facts;
}

/** Statements that carry their own classification marker, wherever they appear. */
function markedStatements(
  documents: IntelligenceDocumentSource[],
  marker: RegExp,
  includeParagraphs: boolean,
): Array<IntelligenceFact | null> {
  const facts: Array<IntelligenceFact | null> = [];
  for (const document of documents) {
    let taken = 0;
    for (const section of parseSections(document.content)) {
      const candidates = includeParagraphs ? [...section.bullets, ...section.paragraphs] : section.bullets;
      for (const candidate of candidates) {
        if (taken >= 8) break;
        if (!marker.test(candidate)) continue;
        taken += 1;
        facts.push(fact(candidate, [`document:${document.path}${section.heading === '' ? '' : `#${section.heading}`}`]));
      }
    }
  }
  return facts;
}

/** First descriptive paragraph of the highest-priority identity document. */
function productSummary(documents: IntelligenceDocumentSource[]): { summary: string; evidence: string } | null {
  const priority = ['README.md', 'README', 'AGENTS.md', 'CLAUDE.md', 'PRODUCT_SPEC.md', 'docs/PROJECT_STATE.md'];
  const ordered = [
    ...priority.flatMap((name) => documents.filter((document) => document.path === name)),
    ...documents.filter((document) => !priority.includes(document.path)),
  ];
  for (const document of ordered) {
    for (const section of parseSections(document.content)) {
      const paragraph = section.paragraphs.find((item) => item.length >= 40);
      if (paragraph !== undefined) {
        return { summary: paragraph.slice(0, 1200), evidence: `document:${document.path}` };
      }
    }
  }
  return null;
}

function repositoryClaims(documents: IntelligenceDocumentSource[]): Array<IntelligenceFact | null> {
  const facts: Array<IntelligenceFact | null> = [];
  for (const document of documents) {
    for (const section of parseSections(document.content)) {
      for (const done of section.doneBullets.slice(0, 8)) {
        facts.push(fact(
          `Documented as complete in the repository (UNVERIFIED by PromptForge): ${done}`,
          [`document:${document.path}${section.heading === '' ? '' : `#${section.heading}`}`],
        ));
      }
    }
  }
  return facts;
}

function openRepositoryItems(documents: IntelligenceDocumentSource[]): Array<IntelligenceFact | null> {
  const facts: Array<IntelligenceFact | null> = [];
  for (const document of documents) {
    for (const section of parseSections(document.content)) {
      for (const open of section.openBullets.slice(0, 8)) {
        facts.push(fact(open, [`document:${document.path}${section.heading === '' ? '' : `#${section.heading}`}`]));
      }
    }
  }
  return facts;
}

function changedFiles(git: GitSnapshot): string[] {
  return [...new Set([
    ...git.uncommitted.staged,
    ...git.uncommitted.unstaged,
    ...git.uncommitted.untracked,
  ])].sort();
}

/** Previously derived facts stay unless the evidence artefact disappeared. */
function mergeWithExisting(
  derived: IntelligenceFact[],
  previous: IntelligenceFact[],
  liveEvidence: Set<string>,
): IntelligenceFact[] {
  const retained = previous.filter((item) => item.evidence.some((reference) => liveEvidence.has(reference)));
  return collect([...derived, ...retained]);
}

function recommend(document: ProjectIntelligenceDocument, project: IntelligenceEvidenceBundle['project']): NextTaskRecommendation | null {
  const blocker = document.blocked[0];
  if (blocker !== undefined) {
    return {
      basis: 'blocker',
      intent: `Resolve the current blocker: ${blocker.statement}`,
      rationale: 'This is the blocking edge of the project. Work after it cannot be validated until it clears.',
      evidence: blocker.evidence,
    };
  }
  const remaining = document.remaining[0];
  if (remaining !== undefined) {
    return {
      basis: 'remaining-task-item',
      intent: `Complete the next remaining item: ${remaining.statement}`,
      rationale: 'This item is recorded as outstanding and nothing blocks it.',
      evidence: remaining.evidence,
    };
  }
  const partial = document.partial[0];
  if (partial !== undefined) {
    return {
      basis: 'unverified-progress',
      intent: `Verify the unverified progress: ${partial.statement}`,
      rationale: 'Progress exists but no verification evidence proves it. Verify before adding new work.',
      evidence: partial.evidence,
    };
  }
  const milestone = document.milestones[0];
  if (milestone !== undefined && project.currentMilestone !== null) {
    return {
      basis: 'active-milestone',
      intent: `Advance the active milestone: ${milestone.statement}`,
      rationale: 'The active milestone is the only recorded direction; no blocker or outstanding item exists.',
      evidence: milestone.evidence,
    };
  }
  return null;
}

export function deriveProjectIntelligence(bundle: IntelligenceEvidenceBundle): ProjectIntelligenceDocument {
  const { documents, memory, git, tasks, continuation, project } = bundle;
  const document = emptyIntelligenceDocument();

  const evidenceInventory = new Set<string>();
  for (const source of documents) evidenceInventory.add(`document:${source.path}`);
  for (const path of bundle.guidancePaths) evidenceInventory.add(`guidance:${path}`);
  for (const contextDocument of bundle.contextDocuments) evidenceInventory.add(`context-document:${contextDocument.relPath}`);
  for (const task of tasks) evidenceInventory.add(`taskspec:${task.taskId}`);
  if (git.head !== null) evidenceInventory.add(`git:${git.head.hash}`);
  if (memory.decisions.length > 0) evidenceInventory.add('memory:decisions');
  if (memory.blockers.length > 0) evidenceInventory.add('memory:blockers');
  if (memory.stack.length > 0) evidenceInventory.add('memory:stack');
  if (memory.currentPhase !== null) evidenceInventory.add('memory:currentPhase');
  if (project.currentMilestone !== null) evidenceInventory.add('project:currentMilestone');

  const identity = productSummary(documents);
  document.product = identity?.summary ?? null;

  document.architecture = collect([
    ...bulletsUnder(documents, ARCHITECTURE_HEADING, ARCHITECTURE_DOCUMENT),
    ...memory.stack.map((item) => fact(`Stack: ${item}`, ['memory:stack'])),
    ...bundle.contextDocuments
      .filter((item) => item.summary !== null && item.summary.trim() !== '')
      .map((item) => fact(item.summary!, [`context-document:${item.relPath}`])),
  ]);

  document.constraints = collect([
    ...bulletsUnder(documents, CONSTRAINT_HEADING),
    ...tasks.flatMap((task) => task.constraints.map((item) => fact(item, [`taskspec:${task.taskId}`]))),
    ...(continuation?.scopeConstraints ?? []).map((item) => fact(
      item,
      continuation?.originalTaskReference ? [`taskspec:${continuation.originalTaskReference}`] : ['memory:currentTask'],
    )),
  ]);

  document.nonGoals = collect([
    ...bulletsUnder(documents, NON_GOAL_HEADING),
    ...markedStatements(documents, NON_GOAL_MARKER, true),
    ...tasks.flatMap((task) => task.outOfScope.map((item) => fact(`Out of scope: ${item}`, [`taskspec:${task.taskId}`]))),
  ]);

  document.decisions = collect([
    ...memory.decisions.map((item) => fact(item.text, [`memory:decisions`, `decision:${item.at}`])),
    ...(continuation?.decisions ?? []).map((item) => fact(item, ['memory:decisions'])),
  ]);

  document.milestones = collect([
    ...(project.currentMilestone === null ? [] : [fact(`Active milestone: ${project.currentMilestone}`, ['project:currentMilestone'])]),
    ...(memory.currentPhase === null ? [] : [fact(`Current phase: ${memory.currentPhase}`, ['memory:currentPhase'])]),
    ...bulletsUnder(documents, MILESTONE_HEADING).slice(0, 8),
  ]);

  // Only PromptForge-side verification proves completion.
  document.verifiedComplete = collect(tasks
    .filter((task) => task.status === 'verified')
    .flatMap((task) => [
      fact(`Verified complete: ${task.objective}`, [`taskspec:${task.taskId}`, ...task.verificationEvidence.slice(0, 3).map((item) => `verification:${item.slice(0, 200)}`)]),
      ...task.acceptanceCriteria.map((item) => fact(item, [`taskspec:${task.taskId}`])),
    ]));

  const repositoryChanges = changedFiles(git);
  document.partial = collect([
    ...(continuation?.unverified ?? []).map((item) => fact(item, [`git:${git.head?.hash ?? 'working-tree'}`])),
    ...(repositoryChanges.length === 0
      ? []
      : [fact(
          `Repository changes are present and UNVERIFIED: ${repositoryChanges.slice(0, 12).join(', ')}`,
          [`git:${git.head?.hash ?? 'working-tree'}`],
        )]),
    ...repositoryClaims(documents),
    ...tasks
      .filter((task) => task.status === 'unverified')
      .map((task) => fact(`Task work exists without verification evidence (UNVERIFIED): ${task.objective}`, [`taskspec:${task.taskId}`])),
  ]);

  document.blocked = collect([
    ...memory.blockers.map((item) => fact(item.text, ['memory:blockers'])),
    ...(continuation?.blockers ?? []).map((item) => fact(item, ['memory:blockers'])),
    ...bulletsUnder(documents, BLOCKER_HEADING),
  ]);

  document.remaining = collect([
    ...(continuation?.remaining ?? []).map((item) => fact(
      item,
      continuation?.originalTaskReference ? [`taskspec:${continuation.originalTaskReference}`] : ['memory:currentTask'],
    )),
    ...tasks
      .filter((task) => task.status === 'active')
      .flatMap((task) => task.acceptanceCriteria.map((item) => fact(item, [`taskspec:${task.taskId}`]))),
    ...openRepositoryItems(documents),
    ...bulletsUnder(documents, REMAINING_HEADING),
    ...markedStatements(documents, INCOMPLETE_MARKER, false),
  ]);

  document.evidence = [...evidenceInventory].sort().slice(0, 200);

  if (bundle.existing !== null) {
    const previous = bundle.existing;
    document.product = document.product ?? previous.product;
    document.architecture = mergeWithExisting(document.architecture, previous.architecture, evidenceInventory);
    document.constraints = mergeWithExisting(document.constraints, previous.constraints, evidenceInventory);
    document.nonGoals = mergeWithExisting(document.nonGoals, previous.nonGoals, evidenceInventory);
    document.decisions = mergeWithExisting(document.decisions, previous.decisions, evidenceInventory);
    document.milestones = mergeWithExisting(document.milestones, previous.milestones, evidenceInventory);
    document.verifiedComplete = mergeWithExisting(document.verifiedComplete, previous.verifiedComplete, evidenceInventory);
    document.blocked = mergeWithExisting(document.blocked, previous.blocked, evidenceInventory);
    document.remaining = mergeWithExisting(document.remaining, previous.remaining, evidenceInventory);
    document.evidence = [...new Set([...document.evidence, ...previous.evidence])].sort().slice(0, 200);
  }

  document.unknowns = [
    ...(document.product === null ? ['Product definition is UNKNOWN: no repository document describes what this project is.'] : []),
    ...(document.architecture.length === 0 ? ['Architecture to preserve is UNKNOWN: no architecture evidence was found.'] : []),
    ...(document.constraints.length === 0 ? ['Constraints are UNKNOWN: no rules, invariants or execution contract evidence was found.'] : []),
    ...(document.nonGoals.length === 0 ? ['Non-goals are UNKNOWN: nothing in the repository records what is out of scope.'] : []),
    ...(document.milestones.length === 0 ? ['Roadmap/milestone state is UNKNOWN: no milestone, phase or roadmap evidence exists.'] : []),
    ...(document.verifiedComplete.length === 0 ? ['No work is verified complete: no PromptForge verification evidence exists yet.'] : []),
    ...(document.remaining.length === 0 && document.blocked.length === 0
      ? ['The next bounded task is UNKNOWN: no blocker, outstanding item or unverified progress was found.']
      : []),
  ].slice(0, 40);

  document.recommendation = recommend(document, project);
  return document;
}
