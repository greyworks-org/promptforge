import { useState, useCallback } from 'react';
import type { ProviderProfile } from '../schemas/providerProfile';
import { runPipeline, type PipelineState, type CompileRequest } from '../compiler/pipeline';
import { BlockingQuestionsDialog } from '../components/BlockingQuestionsDialog';

/**
 * Compiler screen (Phase 6).
 *
 * Raw request input, task type/depth/target selectors with defaults
 * Qwen/Auto/Auto. Orchestrates the full compilation pipeline and
 * displays results or blocking questions.
 */

export interface CompilerScreenProps {
  activeProfile: ProviderProfile | null;
  activeProjectId: string | null;
  contextDocs: Array<{ relPath: string; content: string }>;
}

export function CompilerScreen({
  activeProfile,
  activeProjectId,
  contextDocs,
}: CompilerScreenProps) {
  const [rawRequest, setRawRequest] = useState('');
  const [taskType, setTaskType] = useState('auto');
  const [depth, setDepth] = useState('auto');
  const [targetRuntime, setTargetRuntime] = useState('qwen-code');

  const [state, setState] = useState<PipelineState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [answers, setAnswers] = useState<string[]>([]);

  const handleCompile = useCallback(async () => {
    if (!activeProfile || !activeProjectId) {
      setError('Configure a provider and select a project first.');
      return;
    }
    if (rawRequest.trim().length === 0) {
      setError('Enter a task description.');
      return;
    }

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
        profile: activeProfile,
        projectId: activeProjectId,
        rawRequest: rawRequest.trim(),
        executionMode: resolvedMode,
        contextDocs,
        answers: answers.length > 0 ? answers : undefined,
        previousState: state ?? undefined,
      };

      const result = await runPipeline(request);
      setState(result);

      if (result.status === 'awaiting_answers') {
        // Don't clear answers — accumulate for re-run.
      } else if (result.status === 'done') {
        setAnswers([]);
      }
    } catch (err) {
      setError(`Compilation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProfile, activeProjectId, rawRequest, taskType, depth, targetRuntime, contextDocs, state, answers]);

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
          Describe what you need and PromptForge will compile it into an
          executable task for your coding agent.
        </p>
      </div>

      {/* Request input */}
      <label className="grid gap-1 text-sm">
        <span className="font-medium">What do you need done?</span>
        <textarea
          className={inputClass}
          rows={5}
          value={rawRequest}
          onChange={(e) => setRawRequest(e.target.value)}
          placeholder="Describe the task in your own words. The compiler will clarify, scope and structure it."
          disabled={busy}
        />
      </label>

      {/* Selectors */}
      <div className="grid grid-cols-3 gap-4">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Task type</span>
          <select
            className={selectClass}
            value={taskType}
            onChange={(e) => setTaskType(e.target.value)}
            disabled={busy}
          >
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
          <select
            className={selectClass}
            value={depth}
            onChange={(e) => setDepth(e.target.value)}
            disabled={busy}
          >
            <option value="auto">Auto</option>
            <option value="quick">Quick</option>
            <option value="standard">Standard</option>
            <option value="deep">Deep</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-medium">Target runtime</span>
          <select
            className={selectClass}
            value={targetRuntime}
            onChange={(e) => setTargetRuntime(e.target.value)}
            disabled={busy}
          >
            <option value="qwen-code">Qwen Code</option>
            <option value="claude-code">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
        </label>
      </div>

      {/* Compile button */}
      <button
        type="button"
        onClick={handleCompile}
        disabled={busy || !activeProfile || !activeProjectId}
        className="rounded-md bg-zinc-900 px-6 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {busy ? 'Compiling…' : 'Compile'}
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
      )}

      {state && state.status === 'failed' && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </div>
      )}
    </div>
  );
}
