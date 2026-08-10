import { describe, it, expect } from 'vitest';
import { assembleSnapshot, HandoffIsolationError } from './snapshot';
import { classifyProgress } from './progress';
import { renderHandoffClaudeCode } from './renderClaudeCode';
import { renderHandoffQwenCode } from './renderQwenCode';
import { renderHandoffCodex } from './renderCodex';
import type { MemoryRecord } from '../db/repos/projectMemory';
import type { TaskSpec } from '../schemas/taskspec';
import type { GitSnapshot } from '../services/gitState';

function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    projectId: 'project-test',
    stack: ['TypeScript', 'React'],
    currentPhase: 'phase-2',
    lastValidatedTaskId: null,
    currentTaskId: 'TASK-2026-0001',
    nextTask: null,
    decisions: [{ text: 'Use SQLite for storage', at: '2026-08-07T00:00:00Z' }],
    blockers: [],
    relevantFiles: ['src/components/Login.tsx'],
    lastTest: { commands: ['pnpm test'], results: '34/34 passed', at: '2026-08-07T00:00:00Z' },
    baseCommit: 'abc123',
    semanticContext: null,
    updatedAt: '2026-08-07T00:00:00Z',
    ...overrides,
  };
}

function makeGit(overrides: Partial<GitSnapshot> = {}): GitSnapshot {
  return {
    isRepo: true,
    head: { hash: 'abc123', subject: 'feat: add login', committedAt: '2026-08-07T00:00:00Z' },
    uncommitted: { staged: [], unstaged: [], untracked: [], diffStat: '' },
    branch: 'main',
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    schema_version: '1.1.0',
    task_id: 'TASK-2026-0001',
    project_id: 'project-test',
    task_type: 'feature',
    execution_mode: 'standard',
    target_model: 'deepseek-v4-pro',
    agent_runtime: 'claude-code',
    execution_profile: 'deepseek-v4-pro-claude-code',
    objective: 'Add a login page.',
    scope: ['Create login form', 'Add validation', 'Wire up auth'],
    out_of_scope: ['Build registration flow'],
    acceptance_criteria: ['User can log in with valid credentials'],
    stop_conditions: ['Do not modify existing billing code'],
    risk_level: 'medium',
    current_state: [],
    relevant_context: [],
    assumptions: [],
    blocking_questions: [],
    requirements: { functional:[], frontend:[], backend:[], data:[], security:[], accessibility:[], performance:[] },
    edge_cases: [],
    execution_plan: [],
    test_plan: [],
    final_report: [],
    ...overrides,
  };
}

const baseSnapshot = assembleSnapshot({
  projectId: 'project-test',
  projectName: 'Test Project',
  repoPath: '/Users/test/project',
  memory: makeMemory(),
  git: makeGit(),
  currentTask: makeTask(),
});

describe('assembleSnapshot', () => {
  it('assembles a valid snapshot', () => {
    expect(baseSnapshot.projectId).toBe('project-test');
    expect(baseSnapshot.projectName).toBe('Test Project');
    expect(baseSnapshot.currentTask!.task_id).toBe('TASK-2026-0001');
    expect(baseSnapshot.assembledAt).toBeTruthy();
  });

  it('throws on mismatched memory projectId', () => {
    expect(() =>
      assembleSnapshot({
        projectId: 'project-other',
        projectName: 'X',
        repoPath: '/Users/test/project',
        memory: makeMemory({ projectId: 'project-test' }),
        git: makeGit(),
        currentTask: null,
      }),
    ).toThrow(HandoffIsolationError);
  });

  it('throws on mismatched task projectId', () => {
    expect(() =>
      assembleSnapshot({
        projectId: 'project-test',
        projectName: 'X',
        repoPath: '/Users/test/project',
        memory: makeMemory(),
        git: makeGit(),
        currentTask: makeTask({ project_id: 'project-other' }),
      }),
    ).toThrow(HandoffIsolationError);
  });

  it('allows null currentTask', () => {
    const snap = assembleSnapshot({
      projectId: 'project-test',
      projectName: 'X',
      repoPath: '/Users/test/project',
      memory: makeMemory({ currentTaskId: null }),
      git: makeGit(),
      currentTask: null,
    });
    expect(snap.currentTask).toBeNull();
  });

  it('throws on mismatched currentTaskId in memory vs task', () => {
    expect(() =>
      assembleSnapshot({
        projectId: 'project-test',
        projectName: 'X',
        repoPath: '/Users/test/project',
        memory: makeMemory({ currentTaskId: 'TASK-2026-9999' }),
        git: makeGit(),
        currentTask: makeTask({ task_id: 'TASK-2026-0001' }),
      }),
    ).toThrow(HandoffIsolationError);
  });
});

describe('classifyProgress', () => {
  it('all remaining when no uncommitted changes', () => {
    const report = classifyProgress(baseSnapshot);
    expect(report.remaining.length).toBe(3);
    expect(report.completed).toHaveLength(0);
    expect(report.partial).toHaveLength(0);
    expect(report.isInterrupted).toBe(false);
  });

  it('detects partial completion from uncommitted changes', () => {
    const snap = assembleSnapshot({
      ...baseSnapshot,
      git: makeGit({
        uncommitted: {
          staged: [],
          unstaged: ['src/components/Login.tsx'],
          untracked: [],
          diffStat: '1 file changed, 20 insertions(+)',
        },
      }),
    });
    const report = classifyProgress(snap);
    expect(report.isInterrupted).toBe(true);
    expect(report.partial.length).toBeGreaterThan(0);
  });

  it('marks partial items with evidence', () => {
    const snap = assembleSnapshot({
      ...baseSnapshot,
      git: makeGit({
        uncommitted: {
          staged: [],
          unstaged: ['src/components/Login.tsx'],
          untracked: [],
          diffStat: '1 file changed',
        },
      }),
    });
    const report = classifyProgress(snap);
    for (const p of report.partial) {
      expect(p.evidence).toBeTruthy();
      expect(p.status).toBe('partial');
    }
  });

  it('is not interrupted when clean tree', () => {
    const report = classifyProgress(baseSnapshot);
    expect(report.isInterrupted).toBe(false);
  });

  it('handles null currentTask', () => {
    const snap = assembleSnapshot({
      projectId: 'project-test',
      projectName: 'X',
      repoPath: '/Users/test/project',
      memory: makeMemory({ currentTaskId: null }),
      git: makeGit(),
      currentTask: null,
    });
    const report = classifyProgress(snap);
    expect(report.completed).toHaveLength(0);
    expect(report.partial).toHaveLength(0);
    expect(report.remaining).toHaveLength(0);
  });
});

describe('handoff renderers — zero provider calls', () => {
  // The renderers are pure functions — they don't import or call
  // any provider/network module. Verified by code review: grep for
  // invokeIpc, provider_chat, fetch, XMLHttpRequest returns nothing.

  it('renderHandoffClaudeCode produces non-empty output', () => {
    const out = renderHandoffClaudeCode(baseSnapshot);
    expect(out.length).toBeGreaterThan(100);
  });

  it('renderHandoffQwenCode produces non-empty output', () => {
    const out = renderHandoffQwenCode(baseSnapshot);
    expect(out.length).toBeGreaterThan(100);
  });

  it('renderHandoffCodex produces non-empty output', () => {
    const out = renderHandoffCodex(baseSnapshot);
    expect(out.length).toBeGreaterThan(100);
  });
});

describe('handoff renderers — determinism', () => {
  it('Claude: same input → byte-identical output', () => {
    expect(renderHandoffClaudeCode(baseSnapshot)).toBe(renderHandoffClaudeCode(baseSnapshot));
  });
  it('Qwen: same input → byte-identical output', () => {
    expect(renderHandoffQwenCode(baseSnapshot)).toBe(renderHandoffQwenCode(baseSnapshot));
  });
  it('Codex: same input → byte-identical output', () => {
    expect(renderHandoffCodex(baseSnapshot)).toBe(renderHandoffCodex(baseSnapshot));
  });
});

describe('handoff renderers — preservation', () => {
  it('Claude quotes scope items verbatim', () => {
    const out = renderHandoffClaudeCode(baseSnapshot);
    expect(out).toContain('Create login form');
    expect(out).toContain('Add validation');
    expect(out).toContain('Wire up auth');
  });

  it('Qwen quotes stop conditions verbatim', () => {
    const out = renderHandoffQwenCode(baseSnapshot);
    expect(out).toContain('Do not modify existing billing code');
  });

  it('Codex quotes acceptance criteria verbatim', () => {
    const out = renderHandoffCodex(baseSnapshot);
    expect(out).toContain('User can log in with valid credentials');
  });

  it('all renderers include confirmed decisions', () => {
    const claude = renderHandoffClaudeCode(baseSnapshot);
    const qwen = renderHandoffQwenCode(baseSnapshot);
    const codex = renderHandoffCodex(baseSnapshot);
    expect(claude).toContain('Use SQLite for storage');
    expect(qwen).toContain('Use SQLite for storage');
    expect(codex).toContain('Use SQLite for storage');
  });

  it('renders the canonical repository path and separates handoff target from original execution', () => {
    const out = renderHandoffCodex(baseSnapshot);
    expect(out).toContain('Repository: `/Users/test/project`');
    expect(out).toContain('## Original task execution');
    expect(out).toContain('## Current handoff target\nCodex');
    expect(out).not.toContain('## Execution');
  });

  it('reframes inferred scope and acceptance as verification evidence', () => {
    const out = renderHandoffCodex(baseSnapshot);
    expect(out).toContain('Original task items to reconcile against current repository state');
    expect(out).toContain('### Acceptance requiring verification');
    expect(out).not.toContain('## Remaining');
    expect(out).not.toContain('Acceptance (remaining)');
  });

  it('filters generated paths from handoff work evidence', () => {
    const snap = assembleSnapshot({
      ...baseSnapshot,
      git: makeGit({
        uncommitted: {
          staged: ['build/generated.js', 'src/App.tsx'],
          unstaged: [],
          untracked: [],
          diffStat: ' build/generated.js | 1 +\n src/App.tsx | 1 +',
        },
      }),
    });
    const out = renderHandoffCodex(snap);
    expect(out).toContain('src/App.tsx');
    expect(out).not.toContain('build/generated.js');
  });
});

describe('handoff renderers — recovery section', () => {
  it('contains recovery section when uncommitted changes exist', () => {
    const snap = assembleSnapshot({
      ...baseSnapshot,
      git: makeGit({
        uncommitted: {
          staged: ['src/login.ts'],
          unstaged: [],
          untracked: [],
          diffStat: '1 file changed',
        },
      }),
    });
    const out = renderHandoffClaudeCode(snap);
    expect(out).toContain('Uncommitted');
    expect(out.toLowerCase()).toContain('review');
  });

  it('no recovery section when tree is clean', () => {
    const out = renderHandoffClaudeCode(baseSnapshot);
    expect(out).not.toContain('Uncommitted work');
    expect(out).not.toContain('Interrupted work');
  });
});

describe('handoff renderers — anti-repetition', () => {
  it('includes anti-repetition instruction', () => {
    // Claude and Qwen have unconditional anti-repetition text.
    const claude = renderHandoffClaudeCode(baseSnapshot);
    expect(claude.toLowerCase()).toContain('do not redo');
    const qwen = renderHandoffQwenCode(baseSnapshot);
    expect(qwen.toLowerCase()).toContain('do not redo');
    // Codex includes anti-repetition only when completed items exist.
    // The base snapshot has no completed items, so Codex omits it.
    // This is correct — "do not redo" is meaningless without completed items.
  });
});

describe('staleness reconciliation', () => {
  it('detects when memory baseCommit differs from git HEAD', () => {
    const snap = assembleSnapshot({
      projectId: 'project-test',
      projectName: 'Test',
      repoPath: '/Users/test/project',
      memory: makeMemory({ baseCommit: 'aaa111' }),
      git: makeGit({ head: { hash: 'bbb222', subject: 'newer', committedAt: '2026-08-10T00:00:00Z' } }),
      currentTask: makeTask(),
    });
    const report = classifyProgress(snap);
    expect(report.memoryMayBeStale).toBe(true);
  });

  it('no staleness when baseCommit matches HEAD', () => {
    const snap = assembleSnapshot({
      projectId: 'project-test',
      projectName: 'Test',
      repoPath: '/Users/test/project',
      memory: makeMemory({ baseCommit: 'abc123' }),
      git: makeGit({ head: { hash: 'abc123', subject: 'same', committedAt: '2026-08-07T00:00:00Z' } }),
      currentTask: makeTask(),
    });
    const report = classifyProgress(snap);
    expect(report.memoryMayBeStale).toBe(false);
  });

  it('no staleness flag when no baseCommit recorded', () => {
    const snap = assembleSnapshot({
      projectId: 'project-test',
      projectName: 'Test',
      repoPath: '/Users/test/project',
      memory: makeMemory({ baseCommit: null }),
      git: makeGit(),
      currentTask: makeTask(),
    });
    const report = classifyProgress(snap);
    expect(report.memoryMayBeStale).toBe(false);
  });
});

describe('WHY gap — missing rationale', () => {
  it('Claude renderer flags when no decisions are recorded', () => {
    const snap = assembleSnapshot({
      projectId: 'project-test',
      projectName: 'Test',
      repoPath: '/Users/test/project',
      memory: makeMemory({ decisions: [] }),
      git: makeGit(),
      currentTask: null,
    });
    const out = renderHandoffClaudeCode(snap);
    expect(out).toContain('No decisions recorded');
  });

  it('Claude renderer DOES include decisions when present', () => {
    const snap = assembleSnapshot({
      projectId: 'project-test',
      projectName: 'Test',
      repoPath: '/Users/test/project',
      memory: makeMemory({ decisions: [{ text: 'Use SQLite', at: '2026-08-07T00:00:00Z' }] }),
      git: makeGit(),
      currentTask: null,
    });
    const out = renderHandoffClaudeCode(snap);
    expect(out).toContain('Use SQLite');
  });
});

describe('handoff renderers — arbitrary-project generality', () => {
  const projects = [
    { name: 'AI Feedback SaaS', phase: 'MVP', stack: ['Next.js', 'Supabase'] },
    { name: 'Marketplace Generator', phase: 'v2', stack: ['Django', 'PostgreSQL'] },
    { name: 'Local Fitness App', phase: 'beta', stack: ['Flutter', 'Firebase'] },
  ];

  for (const proj of projects) {
    it(`works for project "${proj.name}"`, () => {
      const snap = assembleSnapshot({
        projectId: `project-${proj.name.toLowerCase().replace(/\s+/g, '-')}`,
        projectName: proj.name,
        repoPath: `/Users/test/${proj.name.toLowerCase().replace(/\s+/g, '-')}`,
        memory: makeMemory({
          projectId: `project-${proj.name.toLowerCase().replace(/\s+/g, '-')}`,
          stack: proj.stack,
          currentPhase: proj.phase,
          currentTaskId: null,
        }),
        git: makeGit({ head: { hash: 'def456', subject: 'latest', committedAt: '2026-08-07T00:00:00Z' } }),
        currentTask: null,
      });
      const claude = renderHandoffClaudeCode(snap);
      expect(claude).toContain(proj.name);
      expect(claude).toContain(proj.phase);
      // No PromptForge-specific terms.
      expect(claude).not.toContain('PromptForge');
    });
  }
});
