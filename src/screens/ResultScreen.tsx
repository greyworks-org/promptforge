import { useState } from 'react';
import type { TaskSpec } from '../schemas/taskspec';
import type { ExecutionProfile } from '../profiles/registry';
import { renderClaudeCode } from '../renderers/renderClaudeCode';
import { renderQwenCode } from '../renderers/renderQwenCode';
import { renderCodex } from '../renderers/renderCodex';
import { deriveChecklist } from '../services/checklist';

/**
 * Result screen (Phase 7).
 *
 * Tabs: Claude Code / Qwen Code / Codex / TaskSpec / Raw vs Compiled / Context sent.
 * Action bar: Copy Prompt, Save Task, Write Task File, Edit, Recompile.
 * No numeric quality score — only the factual verification checklist.
 */

export interface ResultScreenProps {
  taskSpec: TaskSpec;
  profile: ExecutionProfile;
  contextSent: string;
  rawRequest: string;
  onCopyPrompt?: (text: string) => void;
  onSaveTask?: () => void;
  onWriteTaskFile?: () => void;
  onEdit?: () => void;
  onRecompile?: () => void;
}

type TabId = 'claude' | 'qwen' | 'codex' | 'taskspec' | 'raw' | 'context';

export function ResultScreen({
  taskSpec,
  profile,
  contextSent,
  rawRequest,
  onCopyPrompt,
  onSaveTask,
  onWriteTaskFile,
  onEdit,
  onRecompile,
}: ResultScreenProps) {
  const [activeTab, setActiveTab] = useState<TabId>('claude');

  const rendered = {
    claude: renderClaudeCode(taskSpec, profile),
    qwen: renderQwenCode(taskSpec, profile),
    codex: renderCodex(taskSpec, profile),
  };

  const checklist = deriveChecklist(taskSpec);

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'claude', label: 'Claude Code' },
    { id: 'qwen', label: 'Qwen Code' },
    { id: 'codex', label: 'Codex' },
    { id: 'taskspec', label: 'TaskSpec' },
    { id: 'raw', label: 'Raw vs Compiled' },
    { id: 'context', label: 'Context sent' },
  ];

  const tabClass = (id: TabId) =>
    `rounded-t-md px-4 py-2 text-sm font-medium ${
      activeTab === id
        ? 'border-x border-t border-zinc-200 bg-white text-zinc-900'
        : 'text-zinc-500 hover:text-zinc-700'
    }`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold">Result</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {taskSpec.task_id} — {taskSpec.objective}
        </p>
      </div>

      {/* Checklist — no numeric score */}
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
        <h3 className="text-sm font-medium">Verification checklist</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {checklist.map((item, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className={item.ok ? 'text-green-600' : 'text-amber-600'}>
                {item.ok ? '✓' : '⚠'}
              </span>
              <span className={item.ok ? 'text-zinc-700' : 'text-amber-700'}>
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Tabs */}
      <div>
        <div className="flex border-b border-zinc-200">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={tabClass(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="rounded-b-md border-x border-b border-zinc-200 bg-white p-4">
          {activeTab === 'claude' && (
            <pre className="whitespace-pre-wrap text-xs text-zinc-700 font-mono max-h-96 overflow-y-auto">
              {rendered.claude}
            </pre>
          )}
          {activeTab === 'qwen' && (
            <pre className="whitespace-pre-wrap text-xs text-zinc-700 font-mono max-h-96 overflow-y-auto">
              {rendered.qwen}
            </pre>
          )}
          {activeTab === 'codex' && (
            <pre className="whitespace-pre-wrap text-xs text-zinc-700 font-mono max-h-96 overflow-y-auto">
              {rendered.codex}
            </pre>
          )}
          {activeTab === 'taskspec' && (
            <pre className="whitespace-pre-wrap text-xs text-zinc-700 font-mono max-h-96 overflow-y-auto">
              {JSON.stringify(taskSpec, null, 2)}
            </pre>
          )}
          {activeTab === 'raw' && (
            <div className="space-y-4 text-xs">
              <div>
                <h4 className="font-medium text-zinc-500">Raw request</h4>
                <pre className="mt-1 whitespace-pre-wrap text-zinc-700">{rawRequest}</pre>
              </div>
              <div>
                <h4 className="font-medium text-zinc-500">Compiled TaskSpec</h4>
                <pre className="mt-1 whitespace-pre-wrap text-zinc-700">
                  {JSON.stringify(taskSpec, null, 2)}
                </pre>
              </div>
            </div>
          )}
          {activeTab === 'context' && (
            <div>
              <h4 className="text-xs font-medium text-zinc-500">Context sent</h4>
              <pre className="mt-1 whitespace-pre-wrap text-xs text-zinc-700 font-mono max-h-96 overflow-y-auto">
                {contextSent || '(no context sent)'}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2">
        {onCopyPrompt && (
          <button
            type="button"
            onClick={() => {
              const text =
                activeTab === 'taskspec' ? JSON.stringify(taskSpec, null, 2) :
                activeTab === 'context' ? contextSent :
                activeTab === 'raw' ? rawRequest :
                rendered[activeTab as 'claude' | 'qwen' | 'codex'] ?? '';
              onCopyPrompt(text);
            }}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Copy Prompt
          </button>
        )}
        {onSaveTask && (
          <button
            type="button"
            onClick={onSaveTask}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Save Task
          </button>
        )}
        {onWriteTaskFile && (
          <button
            type="button"
            onClick={onWriteTaskFile}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Write Task File
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Edit
          </button>
        )}
        {onRecompile && (
          <button
            type="button"
            onClick={onRecompile}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Recompile
          </button>
        )}
      </div>
    </div>
  );
}
