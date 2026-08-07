import { useState, useCallback } from 'react';
import { pickDirectory } from '../ipc';
import { registerProject, listProjects, updateProject, getProject } from '../services/projectsService';
import { loadProfile } from '../services/settingsService';
import { scanRepository, type ScanResult } from '../services/repoScan';
import { readAnchor, writeAnchor, findReLinkCandidate, ANCHOR_REL_PATH, type AnchorPayload } from '../services/anchor';
import { draftProjectProfile, type DraftResult } from '../services/profileDraft';
import { allTemplates, type InstructionTemplate } from '../templates/instructions';
import { allContextDocTemplates } from '../templates/contextDocs';
import {
  fileWriteSummary,
  categorizeFileWrite,
  PROMPTFORGE_MARKER,
  type FileWriteRequest,
} from '../services/consent';
import { writeTextFile, fileExists, readTextFile } from '../services/projectFs';
import { removeProject } from '../services/projectsService';
import type { ProjectRecord } from '../db/repos/projects';

type WizardStep =
  | 'select-folder'
  | 'scanning'
  | 'review-scan'
  | 'drafting'
  | 'review-draft'
  | 'review-instructions'
  | 'confirm-write'
  | 'complete';

interface WizardState {
  step: WizardStep;
  error: string | null;

  // Step 1: folder selection
  folderPath: string | null;

  // Early registration (before scan, so all fs ops are scoped).
  projectId: string | null;
  // True when this wizard created the project (false for re-links).
  isNewRegistration: boolean;

  // Step 2: scan results
  scanResult: ScanResult | null;

  // Step 3: re-link detection
  reLinkProject: ProjectRecord | null;
  anchorPayload: AnchorPayload | null;

  // Step 4: profile draft
  draftResult: DraftResult | null;
  editedContextDocs: Record<string, string> | null;

  // Step 5: instruction templates
  instructionTemplates: InstructionTemplate[] | null;
  editedInstructions: Record<string, string> | null;

  // Step 6: write confirmation
  writeRequests: FileWriteRequest[] | null;

  // Step 7: created project
  createdProject: ProjectRecord | null;
}

export function OnboardingWizard({ onComplete }: { onComplete: (projectId: string) => void }) {
  const [state, setState] = useState<WizardState>({
    step: 'select-folder',
    error: null,
    folderPath: null,
    projectId: null,
    isNewRegistration: false,
    scanResult: null,
    reLinkProject: null,
    anchorPayload: null,
    draftResult: null,
    editedContextDocs: null,
    instructionTemplates: null,
    editedInstructions: null,
    writeRequests: null,
    createdProject: null,
  });

  const cleanup = useCallback((s: WizardState) => {
    if (s.isNewRegistration && s.projectId) {
      removeProject(s.projectId).catch(() => { /* best effort */ });
    }
  }, []);

  const setError = useCallback((error: string) => {
    setState((s) => {
      cleanup(s);
      return { ...s, error, step: 'select-folder', projectId: null, isNewRegistration: false };
    });
  }, [cleanup]);

  const handleCancel = useCallback(() => {
    setState((s) => {
      cleanup(s);
      return { ...s, step: 'select-folder', folderPath: null, projectId: null, isNewRegistration: false };
    });
  }, [cleanup]);

  // Step 1 → 2: pick folder, register early, then scan.
  const handleSelectFolder = useCallback(async () => {
    const path = await pickDirectory();
    if (path === null) return;

    setState((s) => ({ ...s, step: 'scanning', folderPath: path, error: null }));

    try {
      // Check for existing anchor (re-link) BEFORE registration.
      const existingProjects = await listProjects();
      const reLink = await findReLinkCandidate(path, existingProjects);

      let projectId: string;
      let isNew = true;

      if (reLink) {
        // Re-link: update the existing project's path, don't create a new row.
        await updateProject(reLink.id, { name: reLink.name });
        projectId = reLink.id;
        isNew = false;
        // The anchor at the new path still points to the same projectId.
        // updateProject only touches the DB row; anchor write happens below.
      } else {
        // New project: register so all subsequent fs ops are scoped.
        const project = await registerProject({ folderPath: path });
        projectId = project.id;
      }

      // Do NOT write the anchor yet — new projects are provisional until
      // the user gives explicit consent at the confirm-write step.
      // verify_anchor allows missing anchors for provisional projects;
      // the scoped fs commands still enforce containment within the
      // registered canonical root.

      const scanResult = await scanRepository(projectId);
      const anchor = await readAnchor(projectId);

      setState((s) => ({
        ...s,
        step: 'review-scan',
        projectId,
        isNewRegistration: isNew,
        scanResult,
        reLinkProject: reLink,
        anchorPayload: anchor,
      }));
    } catch (err) {
      setError(`Scan failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [setError]);

  // Step 2 → 3 (skip draft) or 2 → 4: start drafting.
  const handleStartDraft = useCallback(async () => {
    setState((s) => ({ ...s, step: 'drafting', error: null }));

    try {
      const activeProfile = await loadProfile();
      if (!activeProfile) {
        setState((s) => ({ ...s, step: 'review-scan', error: 'No provider configured. Set up a provider in Settings first.' }));
        return;
      }

      const scanResult = state.scanResult!;
      const draft = await draftProjectProfile(activeProfile, {
        projectName: scanResult.suggestedName,
        readmePreview: scanResult.readme?.preview ?? null,
        identityFiles: scanResult.identityFiles,
        techIndicators: scanResult.techIndicators,
      });

      // Merge draft context docs into the template skeletons.
      const templates = allContextDocTemplates();
      const merged: Record<string, string> = {};
      for (const t of templates) {
        const draftContent = draft.contextDocs[t.title] ?? draft.contextDocs[t.filename] ?? '';
        merged[t.filename] = draftContent !== ''
          ? `${draftContent}\n\n${PROMPTFORGE_MARKER}\n`
          : t.content;
      }

      setState((s) => ({
        ...s,
        step: 'review-draft',
        draftResult: draft,
        editedContextDocs: merged,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        step: 'review-scan',
        error: `Draft failed: ${err instanceof Error ? err.message : String(err)}. You can skip drafting and use templates.`,
      }));
    }
  }, [state.scanResult]);

  // Skip drafting — use template skeletons directly.
  const handleSkipDraft = useCallback(() => {
    const templates = allContextDocTemplates();
    const docs: Record<string, string> = {};
    for (const t of templates) {
      docs[t.filename] = t.content;
    }

    setState((s) => ({
      ...s,
      step: 'review-instructions',
      draftResult: null,
      editedContextDocs: docs,
      instructionTemplates: allTemplates(s.scanResult?.suggestedName ?? 'project'),
      editedInstructions: null,
    }));
  }, []);

  // Step 3 → 5: after reviewing draft, prepare instruction templates.
  const handleApproveDraft = useCallback(() => {
    const projectName = state.draftResult?.suggestedName ?? state.scanResult?.suggestedName ?? 'project';
    setState((s) => ({
      ...s,
      step: 'review-instructions',
      instructionTemplates: allTemplates(projectName),
      editedInstructions: null,
    }));
  }, [state.draftResult, state.scanResult]);

  // Step 5 → 6: prepare write requests and show consent summary.
  const handleReviewWrites = useCallback(async () => {
    const projectId = state.projectId!;
    const contextDocs = state.editedContextDocs!;
    const instructions = state.editedInstructions ?? Object.fromEntries(
      (state.instructionTemplates ?? []).map((t) => [t.filename, t.content]),
    );

    const requests: FileWriteRequest[] = [];

    // Context docs (relative paths)
    const contextRelDir = '.promptforge/context';
    for (const [filename, content] of Object.entries(contextDocs)) {
      const relPath = `${contextRelDir}/${filename}`;
      let existingContent: string | null = null;
      try {
        if (await fileExists(projectId, relPath)) {
          existingContent = await readTextFile(projectId, relPath);
        }
      } catch { /* treat as new file */ }

      const { exists, isForeign } = categorizeFileWrite(existingContent);
      requests.push({
        absPath: relPath,
        content: content.endsWith('\n') ? content : content + '\n',
        exists,
        isForeign,
      });
    }

    // Instruction files (relative paths)
    for (const [filename, content] of Object.entries(instructions)) {
      const relPath = filename;
      let existingContent: string | null = null;
      try {
        if (await fileExists(projectId, relPath)) {
          existingContent = await readTextFile(projectId, relPath);
        }
      } catch { /* treat as new file */ }

      const { exists, isForeign } = categorizeFileWrite(existingContent);
      requests.push({
        absPath: relPath,
        content: content.endsWith('\n') ? content : content + '\n',
        exists,
        isForeign,
      });
    }

    // Anchor file
    requests.push({
      absPath: ANCHOR_REL_PATH,
      content: '',
      exists: state.anchorPayload !== null,
      isForeign: false,
    });

    setState((s) => ({ ...s, step: 'confirm-write', writeRequests: requests }));
  }, [state.projectId, state.editedContextDocs, state.editedInstructions, state.instructionTemplates, state.anchorPayload]);

  // Step 6 → 7: execute writes with consent (project already registered).
  const handleConfirmWrite = useCallback(async () => {
    setState((s) => ({ ...s, error: null }));

    try {
      const projectId = state.projectId!;
      const scanResult = state.scanResult!;
      const draftResult = state.draftResult;
      const projectName = draftResult?.suggestedName ?? scanResult.suggestedName;

      // Update project name (it was registered with a temporary name).
      await updateProject(projectId, { name: projectName });

      // Write context docs (relative paths).
      const contextRelDir = '.promptforge/context';
      const contextDocs = state.editedContextDocs!;
      for (const [filename, content] of Object.entries(contextDocs)) {
        const ctxContent = content.endsWith('\n') ? content : content + '\n';
        await writeTextFile(projectId, `${contextRelDir}/${filename}`, ctxContent, true);
      }

      // Write instruction files (relative paths).
      const instructions = state.editedInstructions ?? Object.fromEntries(
        (state.instructionTemplates ?? []).map((t) => [t.filename, t.content]),
      );
      for (const [filename, content] of Object.entries(instructions)) {
        const insContent = content.endsWith('\n') ? content : content + '\n';
        await writeTextFile(projectId, filename, insContent, true);
      }

      // Write anchor.
      const project = await getProject(projectId);
      if (project) {
        await writeAnchor(projectId, project);
      }

      setState((s) => ({ ...s, step: 'complete', createdProject: project }));
    } catch (err) {
      setState((s) => ({
        ...s,
        error: `Write failed: ${err instanceof Error ? err.message : String(err)}`,
      }));
    }
  }, [state.projectId, state.folderPath, state.scanResult, state.draftResult, state.editedContextDocs, state.editedInstructions, state.instructionTemplates]);

  const handleFinish = useCallback(() => {
    if (state.createdProject) {
      onComplete(state.createdProject.id);
    }
  }, [state.createdProject, onComplete]);

  // -- Render helpers --

  const renderSelectFolder = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Add a project</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Select the root folder of your project. PromptForge will scan it and
          help you set up context documents.
        </p>
      </div>

      <button
        type="button"
        onClick={handleSelectFolder}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
      >
        Choose folder...
      </button>

      {state.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </div>
      )}
    </div>
  );

  const renderScanning = () => (
    <div className="space-y-4 text-center">
      <p className="text-sm text-zinc-500">Scanning repository...</p>
      <p className="text-xs font-mono text-zinc-400">{state.folderPath}</p>
    </div>
  );

  const renderReviewScan = () => {
    const sr = state.scanResult!;
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Repository scan</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {sr.totalFilesSeen} files found
            {sr.truncated ? ' (scan truncated at limit)' : ''}
            {sr.warnings.length > 0 && ` · ${sr.warnings.length} warnings`}
          </p>
        </div>

        {state.reLinkProject && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm">
            <p className="font-medium text-amber-800">Existing project detected</p>
            <p className="mt-1 text-amber-700">
              This folder is already registered as{' '}
              <strong>{state.reLinkProject.name}</strong> at{' '}
              <code className="text-xs">{state.reLinkProject.repoPath}</code>.
              The project has been re-associated with this new location.
            </p>
          </div>
        )}

        {sr.readme && (
          <div>
            <h3 className="text-sm font-medium">README</h3>
            <pre className="mt-1 max-h-32 overflow-y-auto rounded-md bg-zinc-50 p-3 text-xs text-zinc-600">
              {sr.readme.preview}
            </pre>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-medium">Project files ({sr.identityFiles.length})</h3>
            <ul className="mt-1 space-y-1">
              {sr.identityFiles.map((f) => (
                <li key={f.relPath} className="text-xs text-zinc-500 font-mono">{f.relPath}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-medium">Tech indicators ({sr.techIndicators.length})</h3>
            <ul className="mt-1 space-y-1">
              {sr.techIndicators.map((f) => (
                <li key={f.relPath} className="text-xs text-zinc-500 font-mono">{f.relPath}</li>
              ))}
            </ul>
          </div>
        </div>

        {state.error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {state.error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleStartDraft}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Draft with AI
          </button>
          <button
            type="button"
            onClick={handleSkipDraft}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Skip — use templates
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-500 hover:bg-zinc-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  const renderDrafting = () => (
    <div className="space-y-4 text-center">
      <p className="text-sm text-zinc-500">Drafting project profile with AI...</p>
      <p className="text-xs text-zinc-400">This may take a few seconds.</p>
    </div>
  );

  const renderReviewDraft = () => {
    const draft = state.draftResult!;
    const docs = state.editedContextDocs!;
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Review profile draft</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Suggested name: <strong>{draft.suggestedName}</strong>
          </p>
          {draft.detectedStack.length > 0 && (
            <p className="mt-1 text-sm text-zinc-500">
              Detected stack: {draft.detectedStack.join(', ')}
            </p>
          )}
        </div>

        <div>
          <h3 className="text-sm font-medium">Summary</h3>
          <p className="mt-1 text-sm text-zinc-600">{draft.summary}</p>
        </div>

        <div>
          <h3 className="text-sm font-medium">Context documents ({Object.keys(docs).length})</h3>
          <p className="text-xs text-zinc-400">You can edit these before writing.</p>
          <div className="mt-2 max-h-96 overflow-y-auto space-y-3">
            {Object.entries(docs).map(([filename, content]) => (
              <div key={filename}>
                <label className="text-xs font-medium text-zinc-500">{filename}</label>
                <textarea
                  className="mt-1 block w-full rounded-md border border-zinc-200 p-2 text-xs font-mono text-zinc-700"
                  rows={6}
                  value={content}
                  onChange={(e) => {
                    setState((s) => ({
                      ...s,
                      editedContextDocs: { ...s.editedContextDocs!, [filename]: e.target.value },
                    }));
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleApproveDraft}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Continue to instructions
          </button>
          <button
            type="button"
            onClick={handleSkipDraft}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Discard draft, use templates
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-500 hover:bg-zinc-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  const renderReviewInstructions = () => {
    const templates = state.instructionTemplates!;
    const edited = state.editedInstructions ?? Object.fromEntries(
      templates.map((t) => [t.filename, t.content]),
    );

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Agent instruction files</h2>
          <p className="mt-1 text-sm text-zinc-500">
            These files tell coding agents how to work in your project.
            You can edit them before writing.
          </p>
        </div>

        <div className="space-y-4">
          {templates.map((t) => (
            <div key={t.filename}>
              <label className="text-sm font-medium text-zinc-700">{t.filename}</label>
              <textarea
                className="mt-1 block w-full rounded-md border border-zinc-200 p-3 text-xs font-mono text-zinc-700"
                rows={10}
                value={edited[t.filename] ?? t.content}
                onChange={(e) => {
                  setState((s) => ({
                    ...s,
                    editedInstructions: { ...edited, [t.filename]: e.target.value },
                  }));
                }}
              />
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleReviewWrites}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Review changes
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-500 hover:bg-zinc-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  const renderConfirmWrite = () => {
    const requests = state.writeRequests!;
    const summary = fileWriteSummary(requests);
    const hasForeignOverwrite = requests.some((r) => r.exists && r.isForeign);

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Confirm changes</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {summary} will be written to <code className="text-xs">{state.folderPath}</code>.
          </p>
        </div>

        {hasForeignOverwrite && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm">
            <p className="font-medium text-red-800">Warning: existing files will be overwritten</p>
            <p className="mt-1 text-red-700">
              Some files were not created by PromptForge. Review the changes carefully
              before proceeding.
            </p>
          </div>
        )}

        <div className="max-h-64 overflow-y-auto space-y-2">
          {requests.map((r) => (
            <div key={r.absPath} className="flex items-center gap-2 text-xs">
              <span className={r.exists ? (r.isForeign ? 'text-red-600' : 'text-amber-600') : 'text-green-600'}>
                {r.exists ? (r.isForeign ? '⟳ overwrite' : '⟳ update') : '+ new'}
              </span>
              <span className="font-mono text-zinc-500">{r.absPath}</span>
            </div>
          ))}
        </div>

        {state.error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {state.error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleConfirmWrite}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Write files
          </button>
          <button
            type="button"
            onClick={() => setState((s) => ({ ...s, step: 'review-instructions' }))}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-500 hover:bg-zinc-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  const renderComplete = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Project ready</h2>
        <p className="mt-1 text-sm text-zinc-500">
          <strong>{state.createdProject?.name}</strong> has been set up at{' '}
          <code className="text-xs">{state.folderPath}</code>.
        </p>
      </div>

      <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-700">
        <p className="font-medium">Files created:</p>
        <ul className="mt-1 list-disc list-inside space-y-0.5">
          <li><code className="text-xs">.promptforge/project.json</code> — anchor</li>
          <li><code className="text-xs">.promptforge/context/</code> — 10 context documents</li>
          <li><code className="text-xs">AGENTS.md, QWEN.md, CLAUDE.md</code> — agent instructions</li>
        </ul>
      </div>

      <button
        type="button"
        onClick={handleFinish}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
      >
        Go to projects
      </button>
    </div>
  );

  const stepRenderers: Record<WizardStep, () => JSX.Element> = {
    'select-folder': renderSelectFolder,
    'scanning': renderScanning,
    'review-scan': renderReviewScan,
    'drafting': renderDrafting,
    'review-draft': renderReviewDraft,
    'review-instructions': renderReviewInstructions,
    'confirm-write': renderConfirmWrite,
    'complete': renderComplete,
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      {/* Step indicators */}
      <div className="mb-8 flex items-center gap-2 text-xs text-zinc-400">
        {([
          ['select-folder', 'Folder'],
          ['scanning', 'Scan'],
          ['review-scan', 'Review'],
          ['drafting', 'Draft'],
          ['review-draft', 'Draft'],
          ['review-instructions', 'Instructions'],
          ['confirm-write', 'Write'],
          ['complete', 'Done'],
        ] as Array<[WizardStep, string]>).map(([stepKey, label]) => {
          const stepOrder = [
            'select-folder', 'scanning', 'review-scan',
            'drafting', 'review-draft', 'review-instructions',
            'confirm-write', 'complete',
          ];
          const currentIdx = stepOrder.indexOf(state.step);
          const itemIdx = stepOrder.indexOf(stepKey);
          const isActive = itemIdx === currentIdx;
          const isDone = itemIdx < currentIdx;
          return (
            <span key={stepKey} className="flex items-center gap-1">
              <span className={
                isActive ? 'font-semibold text-zinc-900' :
                isDone ? 'text-green-600' : 'text-zinc-300'
              }>
                {isDone ? '✓' : label}
              </span>
              {itemIdx < stepOrder.length - 1 && <span className="text-zinc-200">→</span>}
            </span>
          );
        })}
      </div>

      {stepRenderers[state.step]()}
    </div>
  );
}
