import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../ipc', () => ({ invokeIpc: vi.fn() }));

import { invokeIpc } from '../ipc';
import { compilerOutputSchema } from '../schemas/compilerOutput';
import { taskSpecSchema } from '../schemas/taskspec';
import { defaultProfile } from '../schemas/providerProfile';
import { enrich, resetTaskCounterForTests } from './enrich';
import { runPipeline } from './pipeline';
import { withQualityProfileDefaults, DEFAULT_ANTI_SLOP } from './qualityProfile';
import { renderClaudeCode } from '../renderers/renderClaudeCode';
import { renderQwenCode } from '../renderers/renderQwenCode';
import { renderCodex } from '../renderers/renderCodex';
import { PROFILES } from '../profiles/registry';
import type { CompilerOutput } from '../schemas/compilerOutput';

const mockInvoke = vi.mocked(invokeIpc);

const baseOutput: CompilerOutput = {
  task_type: 'feature',
  execution_mode: 'standard',
  target_model: 'deepseek-v4-pro',
  agent_runtime: 'claude-code',
  execution_profile: 'deepseek-v4-pro-claude-code',
  objective: 'Build a private local research feed application for technical teams.',
  scope: ['Create the feed capture and review flow'],
  acceptance_criteria: ['A user can capture a feed and review its entries locally.'],
  risk_level: 'medium',
  requirements: {
    functional: [], frontend: [], backend: [], data: [], security: [], accessibility: [], performance: [],
  },
  current_state: [], relevant_context: [], assumptions: [], blocking_questions: [], out_of_scope: [],
  edge_cases: [], execution_plan: [], test_plan: [], stop_conditions: [], final_report: [],
};

const richGreenfieldOutput: CompilerOutput = {
  ...baseOutput,
  requirements: {
    functional: ['Accept a feed URL and show fetched entries for local review.'],
    frontend: ['Show loading, empty, stale and fetch-error states.'],
    backend: ['Keep fetching behind the existing local service boundary.'],
    data: ['Store feed metadata and entries locally; do not require a hosted database.'],
    security: ['Treat feed content as untrusted input and keep credentials out of stored content.'],
    accessibility: ['Expose progress and errors with accessible status messaging.'],
    performance: ['Keep the initial review view responsive for a bounded feed.'],
  },
  execution_contract: {
    core_loop: [
      'Accept a feed URL.',
      'Fetch and validate the feed locally.',
      'Persist entries and present them for review.',
      'Show retryable failure state when fetch or parse fails.',
    ],
    invariants: ['Choose one conservative local implementation direction; do not add a hosted dependency.'],
    preserve: [],
    verification: ['Test a valid feed, empty feed, malformed feed and network failure.'],
    delivery_slices: [],
  },
  out_of_scope: ['Hosted accounts', 'Unrequested third-party integrations', 'Notifications'],
  test_plan: ['Run focused feed parsing and UI state tests.', 'Run a smoke flow from feed URL to reviewed entry.', 'Run typecheck and production build.'],
  final_report: ['Changed files', 'Tests and validation', 'Unsupported assumptions', 'Remaining risks'],
};

function providerBody(output: CompilerOutput): { status: number; latencyMs: number; body: string } {
  return {
    status: 200,
    latencyMs: 1,
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }),
  };
}

describe('execution contract compiler slice', () => {
  beforeEach(() => {
    resetTaskCounterForTests();
    mockInvoke.mockReset();
  });

  it('compiles a greenfield app request into a bounded end-to-end contract', async () => {
    mockInvoke.mockResolvedValue(providerBody(richGreenfieldOutput));
    const profile = { ...defaultProfile(), baseUrl: 'http://provider.test', modelId: 'deepseek-v4-pro' };

    const result = await runPipeline({
      profile,
      projectId: 'project-greenfield',
      rawRequest: 'Build a private local RSS research application for technical teams.',
      executionMode: 'standard',
      contextDocs: [{ relPath: '.promptforge/context/PRODUCT.md', content: 'Private local research feeds.' }],
    });

    expect(result.status).toBe('done');
    const task = result.taskSpec!;
    expect(task.execution_contract?.core_loop).toHaveLength(4);
    expect(task.requirements.data).toContain('Store feed metadata and entries locally; do not require a hosted database.');
    expect(task.requirements.security).toContain('Treat feed content as untrusted input and keep credentials out of stored content.');
    expect(task.requirements.frontend).toContain('Show loading, empty, stale and fetch-error states.');
    expect(task.out_of_scope).toContain('Unrequested third-party integrations');
    expect(task.test_plan).toContain('Run focused feed parsing and UI state tests.');
    expect(task.test_plan).toContain('Run a smoke flow from feed URL to reviewed entry.');
    expect(task.final_report).toEqual(expect.arrayContaining(['Unsupported assumptions', 'Remaining risks']));
    expect(JSON.stringify(task)).not.toContain('invented integration');
  });

  it('carries detected existing stack and guidance into compilation without replacement proposals', async () => {
    const existingOutput: CompilerOutput = {
      ...baseOutput,
      objective: 'Add a local technical site-audit report to the existing project.',
      current_state: ['The repository uses React, TypeScript and SQLite.'],
      execution_contract: {
        invariants: ['Keep React, TypeScript, SQLite and the existing service boundaries.'],
        preserve: ['Preserve the current project architecture and existing report behavior.'],
      },
      quality_profile: {
        anti_slop: ['Follow the existing report layout even when generic visual defaults differ.'],
        visual_review: true,
      },
    };
    mockInvoke.mockResolvedValue(providerBody(existingOutput));
    const profile = { ...defaultProfile(), baseUrl: 'http://provider.test', modelId: 'deepseek-v4-pro' };

    const result = await runPipeline({
      profile,
      projectId: 'project-existing',
      rawRequest: 'Add a local technical site-audit report.',
      executionMode: 'standard',
      contextDocs: [{ relPath: '.promptforge/context/ARCHITECTURE.md', content: 'React + TypeScript + SQLite.' }],
      projectMemory: {
        stack: ['React', 'TypeScript', 'SQLite'],
        currentPhase: 'reporting',
        decisions: [{ text: 'Keep the existing service boundaries.', at: '2026-08-12T00:00:00Z' }],
        blockers: [],
        relevantFiles: ['src/services/report.ts'],
      },
      projectGuidance: [{ relPath: 'AGENTS.md', content: 'Preserve the established React/TypeScript/SQLite architecture.' }],
    });

    expect(result.status).toBe('done');
    expect(result.taskSpec!.execution_contract?.invariants).toEqual([
      'Keep React, TypeScript, SQLite and the existing service boundaries.',
    ]);
    expect(result.taskSpec!.quality_profile?.anti_slop).toEqual([
      'Follow the existing report layout even when generic visual defaults differ.',
    ]);
    const sent = mockInvoke.mock.calls[0]?.[1] as { messages: Array<{ content: string }> };
    expect(sent.messages[1].content).toContain('React');
    expect(sent.messages[1].content).toContain('Preserve the established React/TypeScript/SQLite architecture.');
  });

  it('adds compact anti-slop defaults only to UI work and preserves explicit guidance', () => {
    const ui = enrich({
      compilerOutput: {
        ...baseOutput,
        task_type: 'ui',
        objective: 'Create a focused audit report screen for local users.',
      },
      projectId: 'project-ui',
    });
    expect(ui.quality_profile?.visual_review).toBe(true);
    expect(ui.quality_profile?.anti_slop).toEqual(DEFAULT_ANTI_SLOP);

    const backend = enrich({
      compilerOutput: { ...baseOutput, task_type: 'backend', requirements: { ...baseOutput.requirements } },
      projectId: 'project-backend',
    });
    expect(backend.quality_profile).toBeUndefined();

    const explicit = withQualityProfileDefaults({
      ...baseOutput,
      task_type: 'ui',
      quality_profile: {
        preferences: ['Use generous whitespace and one primary panel.'],
        anti_slop: ['Do not use nested cards; use the project layout convention.'],
        visual_review: true,
      },
    });
    expect(explicit.quality_profile?.anti_slop).toEqual(['Do not use nested cards; use the project layout convention.']);
    expect(explicit.quality_profile?.anti_slop).not.toContain(DEFAULT_ANTI_SLOP[0]);
  });

  it('rejects more than five delivery slices and keeps unsupported facts absent', () => {
    const slices = Array.from({ length: 6 }, (_, index) => ({
      title: `Slice ${index + 1}`,
      scope: ['One bounded change'],
      verification: ['Run focused verification'],
    }));
    const result = compilerOutputSchema.safeParse({
      ...baseOutput,
      execution_contract: { delivery_slices: slices },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(baseOutput)).not.toContain('Stripe');
  });

  it('renders one canonical contract through every provider wrapper', () => {
    const task = taskSpecSchema.parse(enrich({
      compilerOutput: {
        ...richGreenfieldOutput,
        quality_profile: {
          product_outcome: 'Help users review trustworthy local feeds.',
          ux_constraints: ['Make fetch status and errors understandable.'],
          preferences: ['Prefer a calm, focused reading surface.'],
          anti_slop: ['Avoid nested cards and decorative badges.'],
          completion_checks: ['Review the loading, empty and error states visually.'],
          visual_review: true,
        },
      },
      projectId: 'project-render',
    }));
    const outputs = [
      renderClaudeCode(task, PROFILES['deepseek-v4-pro-claude-code']),
      renderQwenCode(task, PROFILES['qwen-3.8-max-qwen-code']),
      renderCodex(task, PROFILES['gpt-5.6-sol-high-codex']),
    ];
    for (const output of outputs) {
      expect(output).toContain('Accept a feed URL.');
      expect(output).toContain('Store feed metadata and entries locally; do not require a hosted database.');
      expect(output).toContain('Avoid nested cards and decorative badges.');
      expect(output).toContain('Run focused feed parsing and UI state tests.');
      expect(output).toContain('Unrequested third-party integrations');
    }
  });

  it('keeps old compiler output and TaskSpec behavior valid', () => {
    const oldOutput = compilerOutputSchema.parse({
      ...baseOutput,
      execution_contract: undefined,
      quality_profile: undefined,
    });
    const task = enrich({ compilerOutput: oldOutput, projectId: 'project-legacy' });
    expect(taskSpecSchema.safeParse(task).success).toBe(true);
    expect(task.execution_contract).toBeUndefined();
    expect(task.quality_profile).toBeUndefined();
  });
});
