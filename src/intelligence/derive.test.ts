import { describe, expect, it } from 'vitest';
import type { MemoryRecord } from '../db/repos/projectMemory';
import type { GitSnapshot } from '../services/gitState';
import { deriveProjectIntelligence, parseSections, type IntelligenceEvidenceBundle } from './derive';
import { INTELLIGENCE_SCHEMA_VERSION, projectIntelligenceDocumentSchema, type ProjectIntelligence } from './types';

const memory: MemoryRecord = {
  projectId: 'project-intel',
  stack: ['TypeScript'],
  currentPhase: null,
  lastValidatedTaskId: null,
  currentTaskId: null,
  nextTask: null,
  decisions: [],
  blockers: [],
  relevantFiles: [],
  lastTest: null,
  baseCommit: null,
  semanticContext: null,
  updatedAt: '2026-08-14T00:00:00Z',
};

const cleanGit: GitSnapshot = {
  isRepo: true,
  head: { hash: 'head-1', subject: 'baseline', committedAt: '2026-08-14T00:00:00Z' },
  uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' },
  branch: 'main',
  diff: '',
  recentCommits: [],
};

function bundle(overrides: Partial<IntelligenceEvidenceBundle> = {}): IntelligenceEvidenceBundle {
  return {
    project: { id: 'project-intel', name: 'Intel', repoPath: '/tmp/intel', currentMilestone: null },
    documents: [],
    contextDocuments: [],
    guidancePaths: [],
    git: cleanGit,
    memory,
    tasks: [],
    continuation: null,
    existing: null,
    ...overrides,
  };
}

const readme = {
  path: 'README.md',
  content: [
    '# Offerlike',
    '',
    'Offerlike is a local application pipeline that discovers postings, scores them and prepares submissions.',
    '',
    '## Architecture',
    '',
    '- Discovery, scoring and safety modules run inside one worker process.',
    '- Submission always stops before the final send step.',
    '',
    '## Non-goals',
    '',
    '- Never submit an application without an explicit confirmation command.',
    '',
    '## Known issues',
    '',
    '- The pipeline is blocked before a successful real prefill.',
    '',
    '## Next',
    '',
    '- [ ] Multi-step form execution is not complete.',
    '- [x] Requirement-fit gate shipped.',
  ].join('\n'),
};

describe('project intelligence derivation', () => {
  it('parses bounded markdown sections, bullets and checkbox state', () => {
    const sections = parseSections(readme.content);
    const next = sections.find((section) => section.heading === 'Next');
    expect(next?.openBullets).toContain('Multi-step form execution is not complete.');
    expect(next?.doneBullets).toContain('Requirement-fit gate shipped.');
  });

  it('inherits a parent classification into subsections without letting the document title classify', () => {
    const stateDoc = {
      path: 'docs/state-and-next-steps.md',
      content: [
        '# Where this is, and what is next',
        '',
        '## The state in numbers',
        '',
        '- Two thousand postings are stored.',
        '',
        '## Next, in order',
        '',
        '### 1. Mail client — the only thing in flight',
        '',
        '- The classifier is ready but the client does not exist.',
        '',
        '### 2. Retire the old tracker',
      ].join('\n'),
    };

    const document = deriveProjectIntelligence(bundle({ documents: [stateDoc] }));
    const remaining = document.remaining.map((item) => item.statement);

    expect(remaining).toContain('1. Mail client — the only thing in flight');
    expect(remaining).toContain('The classifier is ready but the client does not exist.');
    expect(remaining).toContain('2. Retire the old tracker');
    expect(remaining).not.toContain('The state in numbers');
    expect(remaining).not.toContain('Two thousand postings are stored.');
    expect(document.recommendation?.intent).toContain('1. Mail client — the only thing in flight');
  });

  it('bootstraps a project with no prior intelligence from repository evidence', () => {
    const document = deriveProjectIntelligence(bundle({ documents: [readme] }));

    expect(projectIntelligenceDocumentSchema.safeParse(document).success).toBe(true);
    expect(document.product).toContain('Offerlike is a local application pipeline');
    expect(document.architecture.map((item) => item.statement).join('\n')).toContain('Discovery, scoring and safety modules');
    expect(document.nonGoals.map((item) => item.statement).join('\n')).toContain('without an explicit confirmation command');
    expect(document.blocked.map((item) => item.statement).join('\n')).toContain('blocked before a successful real prefill');
    expect(document.remaining.map((item) => item.statement).join('\n')).toContain('Multi-step form execution is not complete');
    expect(document.architecture.every((item) => item.evidence.length > 0)).toBe(true);
  });

  it('keeps unsupported product, architecture and roadmap facts unknown', () => {
    const document = deriveProjectIntelligence(bundle());

    expect(document.product).toBeNull();
    expect(document.architecture.filter((item) => !item.statement.startsWith('Stack:'))).toEqual([]);
    expect(document.milestones).toEqual([]);
    expect(document.unknowns.join('\n')).toContain('Roadmap/milestone state is UNKNOWN');
    expect(document.unknowns.join('\n')).toContain('Product definition is UNKNOWN');
    expect(document.recommendation).toBeNull();
  });

  it('feeds verified TaskSpec completion into verified project progress', () => {
    const document = deriveProjectIntelligence(bundle({
      tasks: [{
        compilationId: 'comp-1',
        taskId: 'TASK-2026-1001',
        objective: 'Add the requirement-fit gate.',
        acceptanceCriteria: ['The gate rejects postings below the threshold.'],
        outOfScope: ['Rewriting the scorer'],
        constraints: ['Preserve the existing worker contract.'],
        status: 'verified',
        verificationEvidence: ['Completion verification: READY.'],
      }],
    }));

    expect(document.verifiedComplete.map((item) => item.statement)).toContain('Verified complete: Add the requirement-fit gate.');
    expect(document.verifiedComplete.map((item) => item.statement)).toContain('The gate rejects postings below the threshold.');
    expect(document.nonGoals.map((item) => item.statement)).toContain('Out of scope: Rewriting the scorer');
    expect(document.constraints.map((item) => item.statement)).toContain('Preserve the existing worker contract.');
  });

  it('never marks repository changes or repository claims as verified', () => {
    const document = deriveProjectIntelligence(bundle({
      documents: [readme],
      git: {
        ...cleanGit,
        uncommitted: { staged: ['src/prefill.ts'], unstaged: [], untracked: [], diffStat: 'src/prefill.ts | 9 +' },
      },
    }));

    expect(document.verifiedComplete).toEqual([]);
    const partial = document.partial.map((item) => item.statement).join('\n');
    expect(partial).toContain('Repository changes are present and UNVERIFIED: src/prefill.ts');
    expect(partial).toContain('Documented as complete in the repository (UNVERIFIED by PromptForge): Requirement-fit gate shipped.');
  });

  it('recommends the blocking edge before any later work', () => {
    const document = deriveProjectIntelligence(bundle({ documents: [readme] }));

    expect(document.recommendation?.basis).toBe('blocker');
    expect(document.recommendation?.intent).toContain('blocked before a successful real prefill');
    expect(document.recommendation?.evidence.length).toBeGreaterThan(0);
  });

  it('reconciles an existing record instead of resetting it', () => {
    const existing: ProjectIntelligence = {
      ...deriveProjectIntelligence(bundle({ documents: [readme] })),
      projectId: 'project-intel',
      schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
      sourceHead: 'head-0',
      bootstrappedAt: '2026-08-01T00:00:00Z',
      reconciledAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    };

    const reconciled = deriveProjectIntelligence(bundle({ documents: [readme], existing }));

    expect(reconciled.blocked.map((item) => item.statement)).toEqual(
      expect.arrayContaining(existing.blocked.map((item) => item.statement)),
    );
    expect(reconciled.product).toBe(existing.product);
    expect(reconciled.architecture.length).toBeGreaterThanOrEqual(existing.architecture.length);
  });

  it('drops previously derived facts whose evidence artefact disappeared', () => {
    const existing: ProjectIntelligence = {
      ...deriveProjectIntelligence(bundle({ documents: [readme] })),
      projectId: 'project-intel',
      schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
      sourceHead: 'head-0',
      bootstrappedAt: '2026-08-01T00:00:00Z',
      reconciledAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    };

    const reconciled = deriveProjectIntelligence(bundle({ documents: [], existing }));

    expect(reconciled.architecture.filter((item) => item.evidence.some((reference) => reference.startsWith('document:')))).toEqual([]);
    expect(reconciled.blocked.filter((item) => item.evidence.some((reference) => reference.startsWith('document:')))).toEqual([]);
    expect(reconciled.unknowns.join('\n')).toContain('Non-goals are UNKNOWN');
  });
});
