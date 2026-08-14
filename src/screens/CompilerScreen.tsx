import { useState, useCallback, useEffect } from 'react';
import type { ProviderProfile } from '../schemas/providerProfile';
import { runPipeline, type PipelineState, type CompileRequest } from '../compiler/pipeline';
import { BlockingQuestionsDialog } from '../components/BlockingQuestionsDialog';
import { listContextDocs, readContextContent } from '../services/contextService';
import { recordCompilation } from '../services/historyService';
import { recordCompileSuccess } from '../services/memoryService';
import { hasApiKey } from '../services/providerService';
import { listProfiles, loadSelectedModelId, saveSelectedModelId } from '../services/settingsService';
import { resolveExecutionProfile } from '../services/providerRegistry';
import { DEFAULT_MODEL_ID, MODEL_CATALOG, resolveCatalogModel, runtimeModelRef } from '../models/catalog';
import { ensureExecutionSession } from '../sessions/executionSessionService';
import { getMemory } from '../services/memoryService';
import { getCompilationForProject } from '../services/historyService';
import { inspectProjectGuidance } from '../services/projectGuidance';
import { readTextFile } from '../services/projectFs';
import { compilerIntelligenceSummary, recommendNextTask } from '../services/projectIntelligenceService';
import type { NextTaskRecommendation, ProjectIntelligence } from '../intelligence/types';

/**
 * Compiler screen (Phase 6).
 *
 * Automatically loads context documents for the active project via
 * Phase 4 contracts. Raw request input, task type/depth/target
 * selectors. Orchestrates the full compilation pipeline.
 */

export interface CompilerScreenProps {
  activeProjectId: string | null;
  /** Prefilled intent, for example an accepted next-task recommendation. */
  initialRequest?: string;
}

export function CompilerScreen({
  activeProjectId,
  initialRequest,
}: CompilerScreenProps) {
  const [rawRequest, setRawRequest] = useState(initialRequest ?? '');
  const [taskType, setTaskType] = useState('auto');
  const [depth, setDepth] = useState('auto');
  const [targetRuntime, setTargetRuntime] = useState('claude-code');
  const [selectedModelId, setSelectedModelId] = useState<string>(DEFAULT_MODEL_ID);
  const [availableProfiles, setAvailableProfiles] = useState<ProviderProfile[]>([]);

  const [state, setState] = useState<PipelineState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load available provider profiles.
  useEffect(() => {
    Promise.all([listProfiles(), loadSelectedModelId()]).then(([profiles, savedModelId]) => {
      setAvailableProfiles(profiles);
      setSelectedModelId(MODEL_CATALOG.some((model) => model.id === savedModelId) ? savedModelId : DEFAULT_MODEL_ID);
    }).catch(() => {
      setAvailableProfiles([]);
      setSelectedModelId(DEFAULT_MODEL_ID);
    });
  }, []);

  // Auto-load context docs from the active project.
  const [contextDocs, setContextDocs] = useState<Array<{ relPath: string; content: string }>>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [projectMemory, setProjectMemory] = useState<Awaited<ReturnType<typeof getMemory>> | null>(null);
  const [projectGuidance, setProjectGuidance] = useState<Array<{ relPath: string; content: string }>>([]);

  useEffect(() => {
    if (!activeProjectId) { setContextDocs([]); return; }
    setContextLoading(true);
    listContextDocs(activeProjectId)
      .then(async (docs) => {
        const loaded: Array<{ relPath: string; content: string }> = [];
        for (const d of docs) {
          try {
            const content = await readContextContent(activeProjectId, d.relPath);
            loaded.push({ relPath: d.relPath, content });
          } catch { /* skip unreadable */ }
        }
        setContextDocs(loaded);
      })
      .catch(() => setContextDocs([]))
      .finally(() => setContextLoading(false));
  }, [activeProjectId]);

  // Reuse bounded project facts and existing rule files when compiling. These
  // are inputs only; the repository remains the execution source of truth.
  useEffect(() => {
    if (!activeProjectId) {
      setProjectMemory(null);
      setProjectGuidance([]);
      return;
    }
    let cancelled = false;
    Promise.all([getMemory(activeProjectId), inspectProjectGuidance(activeProjectId)])
      .then(async ([memory, entries]) => {
        if (memory.currentTaskId) {
          try {
            const compilation = await getCompilationForProject(activeProjectId, memory.currentTaskId);
            if (compilation?.taskspecJson) {
              const savedRuntime = (JSON.parse(compilation.taskspecJson) as { agent_runtime?: string }).agent_runtime;
              if (savedRuntime === 'claude-code' || savedRuntime === 'qwen-code' || savedRuntime === 'codex') setTargetRuntime(savedRuntime);
            }
          } catch {
            // A missing historical task should not block a new compilation.
          }
        }
        const rules = entries.filter((entry) => entry.kind === 'rule').slice(0, 8);
        const loaded = await Promise.all(rules.map(async (entry) => {
          try {
            return { relPath: entry.path, content: (await readTextFile(activeProjectId, entry.path)).slice(0, 8_000) };
          } catch {
            return null;
          }
        }));
        if (!cancelled) {
          setProjectMemory(memory);
          setProjectGuidance(loaded.filter((item): item is { relPath: string; content: string } => item !== null));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjectMemory(null);
          setProjectGuidance([]);
        }
      });
    return () => { cancelled = true; };
  }, [activeProjectId]);

  const [intelligence, setIntelligence] = useState<ProjectIntelligence | null>(null);
  const [recommendation, setRecommendation] = useState<NextTaskRecommendation | null>(null);

  useEffect(() => { if (initialRequest !== undefined) setRawRequest(initialRequest); }, [initialRequest]);

  // Project intelligence lets a short intent compile without the user
  // restating architecture, constraints or roadmap position.
  useEffect(() => {
    if (!activeProjectId) {
      setIntelligence(null);
      setRecommendation(null);
      return;
    }
    let cancelled = false;
    recommendNextTask(activeProjectId)
      .then((result) => {
        if (cancelled) return;
        setIntelligence(result.intelligence);
        setRecommendation(result.recommendation);
      })
      .catch(() => {
        if (cancelled) return;
        setIntelligence(null);
        setRecommendation(null);
      });
    return () => { cancelled = true; };
  }, [activeProjectId]);

  const [answers, setAnswers] = useState<string[]>([]);

  const handleCompile = useCallback(async () => {
    if (!activeProjectId) {
      setError('Select a project first.');
      return;
    }
    if (rawRequest.trim().length === 0) {
      setError('Enter a task description.');
      return;
    }

    const selected = resolveCatalogModel(selectedModelId, availableProfiles);
    if (!selected.ok) { setError(selected.error); return; }
    const selectedProfile = selected.value.profile;
    if (!(await hasApiKey(selectedProfile.id))) {
      setError(`CONFIGURATION REQUIRED: save an API key for ${selected.value.model.displayName} in Settings.`);
      return;
    }

    // Validate runtime + provider + model combination.
    const resolved = resolveExecutionProfile(targetRuntime, `${selectedProfile.providerId ?? ''} ${selectedProfile.label}`, selectedProfile.modelId);
    if (!resolved.ok) { setError(resolved.error); return; }

    setError(null);
    setBusy(true);
    setState(null);

    try {
      const resolvedMode =
        depth === 'auto'
          ? taskType === 'review'
            ? 'review'
            : taskType === 'planning'
              ? 'plan'
              : 'standard'
          : (depth as CompileRequest['executionMode']);

      const request: CompileRequest = {
        profile: selectedProfile,
        projectId: activeProjectId,
        rawRequest: rawRequest.trim(),
        executionMode: resolvedMode,
        contextDocs,
        projectMemory: projectMemory
          ? {
              stack: projectMemory.stack,
              currentPhase: projectMemory.currentPhase,
              decisions: projectMemory.decisions,
              blockers: projectMemory.blockers,
              relevantFiles: projectMemory.relevantFiles,
            }
          : undefined,
        projectGuidance,
        projectIntelligence: intelligence === null ? undefined : compilerIntelligenceSummary(intelligence),
        answers: answers.length > 0 ? answers : undefined,
        previousState: state ?? undefined,
      };

      const result = await runPipeline(request);
      setState(result);

      if (result.status === 'awaiting_answers') {
        // Don't clear answers — accumulate for re-run.
      } else if (result.status === 'done' && result.taskSpec && activeProjectId) {
        setAnswers([]);
        // Persist task as active project work.
        try {
          const compilation = await recordCompilation({
            projectId: activeProjectId,
            rawRequest: rawRequest.trim(),
            taskType: result.taskSpec.task_type,
            executionMode: result.taskSpec.execution_mode,
            targetModel: result.taskSpec.target_model,
            agentRuntime: result.taskSpec.agent_runtime,
            executionProfile: result.taskSpec.execution_profile,
            providerLabel: selectedProfile.label,
            modelId: selectedProfile.modelId,
            contextDocIds: [],
            contextSent: result.contextSent,
            status: 'done',
            taskspecJson: JSON.stringify(result.taskSpec),
          });
          // project_memory.current_task_id references compilations.id. The
          // TaskSpec's TASK-* id is preserved inside taskspec_json.
          await recordCompileSuccess(activeProjectId, compilation.id);
          await ensureExecutionSession({
            projectId: activeProjectId,
            runtime: result.taskSpec.agent_runtime,
            task: result.taskSpec,
            compilation,
            binding: {
              providerId: selectedProfile.providerId ?? selected.value.model.providerId,
              modelId: selectedProfile.modelId,
              modelRef: runtimeModelRef(selectedProfile),
              variant: null,
              runtimeSessionId: null,
              detectedVersion: null,
              capabilities: [],
            },
          });
        } catch (err) {
          setError(`Compilation succeeded but could not be persisted: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      setError(`Compilation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, rawRequest, taskType, depth, targetRuntime, selectedModelId, availableProfiles, contextDocs, projectMemory, projectGuidance, intelligence, state, answers]);

  const handleAnswersSubmit = useCallback(
    (newAnswers: string[]) => {
      setAnswers(newAnswers);
      // Re-trigger compilation with answers.
      setTimeout(() => handleCompile(), 0);
    },
    [handleCompile],
  );

  const inputClass =
    'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none';
  const selectClass =
    'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Compiler</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Say what you want in your own words. PromptForge derives the technical
          task from this project&apos;s intelligence — you do not need to know the
          files, the plan or the next step.
        </p>
        {activeProjectId && (
          <p className="mt-1 text-xs text-zinc-400">
            {contextLoading
              ? 'Loading context documents…'
              : contextDocs.length > 0
                ? `${contextDocs.length} context document${contextDocs.length > 1 ? 's' : ''} available`
                : 'No context documents found for this project.'}
          </p>
        )}
      </div>

      {/* Recommended next task from project intelligence */}
      {recommendation !== null && (
        <div className="border-y border-zinc-200 py-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Recommended next task</p>
          <p className="mt-1 text-zinc-800">{recommendation.intent}</p>
          <p className="mt-1 text-xs text-zinc-500">{recommendation.rationale}</p>
          <button
            type="button"
            onClick={() => setRawRequest(recommendation.intent)}
            disabled={busy}
            className="mt-2 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            Use this
          </button>
        </div>
      )}

      {/* Request input */}
      <label className="grid gap-1 text-sm">
        <span className="font-medium">What do you want?</span>
        <textarea
          className={inputClass}
          rows={4}
          value={rawRequest}
          onChange={(e) => setRawRequest(e.target.value)}
          placeholder={recommendation === null
            ? 'Short intent is enough — "continue", "make onboarding simpler", "fix the failing import".'
            : 'Short intent is enough. Anything you type here overrides the recommendation.'}
          disabled={busy}
        />
      </label>

      {/* Selectors */}
      <div className="grid grid-cols-3 gap-4">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Task type</span>
          <select className={selectClass} value={taskType} onChange={(e) => setTaskType(e.target.value)} disabled={busy}>
            <option value="auto">Auto</option>
            <option value="feature">Feature</option>
            <option value="bugfix">Bugfix</option>
            <option value="ui">UI</option>
            <option value="backend">Backend</option>
            <option value="database">Database</option>
            <option value="integration">Integration</option>
            <option value="refactor">Refactor</option>
            <option value="review">Review</option>
            <option value="security">Security</option>
            <option value="testing">Testing</option>
            <option value="planning">Planning</option>
            <option value="deployment">Deployment</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-medium">Depth</span>
          <select className={selectClass} value={depth} onChange={(e) => setDepth(e.target.value)} disabled={busy}>
            <option value="auto">Auto</option>
            <option value="quick">Quick</option>
            <option value="standard">Standard</option>
            <option value="deep">Deep</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-medium">Target runtime</span>
          <select className={selectClass} value={targetRuntime} onChange={(e) => setTargetRuntime(e.target.value)} disabled={busy}>
            <option value="claude-code">Claude Code</option>
            <option value="qwen-code">Qwen Code</option>
            <option value="codex">Codex CLI</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-medium">Model</span>
          <select
            className={selectClass}
            value={selectedModelId}
            onChange={(e) => { setSelectedModelId(e.target.value); void saveSelectedModelId(e.target.value); }}
            disabled={busy}
          >
            {MODEL_CATALOG.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
          </select>
          <span className="text-xs text-zinc-400">Used for this task compilation.</span>
        </label>
      </div>

      {/* Compile button */}
      {!activeProjectId && (
        <p className="text-sm text-amber-600">Select an active project in Projects first.</p>
      )}
      <button
        type="button"
        onClick={handleCompile}
        disabled={busy || !activeProjectId}
        className="rounded-md bg-zinc-900 px-6 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {busy ? 'Compiling…' : !activeProjectId ? 'No active project' : 'Compile'}
      </button>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* State display */}
      {state && state.status === 'awaiting_answers' && (
        <BlockingQuestionsDialog
          questions={state.blockingQuestions}
          round={state.blockingRounds}
          onSubmit={handleAnswersSubmit}
          onCancel={() => setState(null)}
        />
      )}

      {state && state.status === 'done' && state.taskSpec && (
        <div className="space-y-4">
          <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm">
            <p className="font-medium text-green-800">Task compiled</p>
            <p className="mt-1 text-green-700">
              <strong>{state.taskSpec.task_id}</strong> — {state.taskSpec.objective}
            </p>
            <p className="mt-1 text-xs text-green-600">
              Mode: {state.taskSpec.execution_mode} · Runtime:{' '}
              {state.taskSpec.agent_runtime} · Risk: {state.taskSpec.risk_level}
              · Calls: {state.callCount}
            </p>
          </div>

          {state.contextSent && (
            <details className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs">
              <summary className="cursor-pointer font-medium text-zinc-500">
                Context sent ({state.contextSent.length} chars)
              </summary>
              <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-zinc-600 font-mono">
                {state.contextSent}
              </pre>
            </details>
          )}
        </div>
      )}

      {state && state.status === 'failed' && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </div>
      )}
    </div>
  );
}
