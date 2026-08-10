import { useState, useCallback, useEffect } from 'react';
import { pickDirectory, invokeIpc } from '../ipc';
import { registerProject, listProjects, updateProject, getProject } from '../services/projectsService';
import { resolveProjectRoot } from '../services/projectFs';
import { loadProfile } from '../services/settingsService';
import { scanRepository, type ScanResult } from '../services/repoScan';
import { readAnchor, writeAnchor, findReLinkCandidate, ANCHOR_REL_PATH, type AnchorPayload } from '../services/anchor';
import { draftProjectProfile, type DraftRequest, type DraftResult } from '../services/profileDraft';
import { getGitSnapshot } from '../services/gitState';
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
import { syncContextRegistry } from '../services/contextService';
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

export function OnboardingWizard({ onComplete, existingProjectId }: {
  onComplete: (projectId: string) => void;
  /** When set, skip folder selection and start directly for this registered project. */
  existingProjectId?: string | null;
}) {
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

  // Auto-start for existing registered projects: resolve root, scan directly.
  useEffect(() => {
    if (!existingProjectId) return;
    let cancelled = false;
    (async () => {
      try {
        const root = await resolveProjectRoot(existingProjectId);
        if (cancelled) return;
        const scanResult = await scanRepository(existingProjectId);
        if (cancelled) return;
        const anchor = await readAnchor(existingProjectId);
        if (cancelled) return;
        setState((s) => ({
          ...s,
          step: 'review-scan',
          folderPath: root,
          projectId: existingProjectId,
          isNewRegistration: false,
          scanResult,
          anchorPayload: anchor,
        }));
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            error: `Could not start onboarding: ${err instanceof Error ? err.message : String(err)}`,
            step: 'select-folder',
          }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [existingProjectId]);

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
      // Canonicalize the selected path for comparison.
      let canonicalPath = path;
      try {
        const meta = await invokeIpc<{ canonicalPath: string | null }>('fs_metadata', { path });
        if (meta.canonicalPath) canonicalPath = meta.canonicalPath;
      } catch { /* use raw path */ }

      // Check for existing anchor (re-link) BEFORE registration.
      const existingProjects = await listProjects();
      const reLink = await findReLinkCandidate(path, existingProjects);

      // Check if this folder is already registered at its current location.
      const existingByPath = existingProjects.find((p) => p.repoPath === canonicalPath);

      let projectId: string;
      let isNew = true;

      if (reLink) {
        // Re-link: update the existing project's path, don't create a new row.
        await updateProject(reLink.id, { name: reLink.name });
        projectId = reLink.id;
        isNew = false;
      } else if (existingByPath) {
        // Already registered at this path — use the existing projectId.
        projectId = existingByPath.id;
        isNew = false;
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
      const isExisting = !state.isNewRegistration;

      // Gather richer evidence for existing projects.
      let existingProject: DraftRequest['existingProject'] = undefined;

      if (isExisting && state.folderPath) {
        // Git state — live from Phase 9, resolved via registry.
        let recentHistory: string[] = [];
        let uncommittedDetail = '';
        try {
          const git = await getGitSnapshot(state.projectId!);
          if (git.isRepo) {
            if (git.head) recentHistory.push(git.head.subject);
            if (git.uncommitted.diffStat) {
              uncommittedDetail = git.uncommitted.diffStat;
              const changed = [
                ...git.uncommitted.staged,
                ...git.uncommitted.unstaged,
              ].slice(0, 10);
              if (changed.length > 0) {
                uncommittedDetail += ` (${changed.join(', ')})`;
              }
            }
          }
        } catch { /* non-git or unavailable — continue without */ }

        // Select existing docs: .promptforge/context/ first, then root .md files.
        const contextDocs = scanResult.allFiles
          .filter((f) => f.relPath.includes('.promptforge/context/') && f.preview)
          .slice(0, 8);
        const rootDocs = scanResult.allFiles
          .filter((f) => !f.relPath.includes('.promptforge/') && f.relPath.endsWith('.md') && f.preview)
          .filter((f) => !contextDocs.some((c) => c.relPath === f.relPath))
          .slice(0, 4);
        const existingDocs = [...contextDocs, ...rootDocs]
          .map((f) => ({ relPath: f.relPath, preview: f.preview! }));

        existingProject = {
          existingDocs,
          recentHistory,
          hasUncommitted: uncommittedDetail.length > 0,
          uncommittedDetail: uncommittedDetail || undefined,
        };
      }

      const draft = await draftProjectProfile(activeProfile, {
        projectName: scanResult.suggestedName,
        readmePreview: scanResult.readme?.preview ?? null,
        identityFiles: scanResult.identityFiles,
        techIndicators: scanResult.techIndicators,
        existingProject,
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
        error: `Draft failed: ${err instanceof Error ? err.message : (typeof err === 'string' ? err : 'Provider request failed.')}. You can skip drafting and use templates.`,
      }));
    }
  }, [state.scanResult]);

  // Skip drafting — derive project-specific templates from scan data.
  const handleSkipDraft = useCallback(() => {
    const scan = state.scanResult!;
    const projectName = scan.suggestedName;
    const stack = scan.techIndicators.map((f) => f.relPath.replace(/^App\//, '').replace(/\.swift$|\.xcodeproj\/.*/, ''));
    const uniqueStack = [...new Set(stack)].slice(0, 8);

    // Derive docs from scan data — deterministic, no AI.
    const docs = deriveContextDocsFromScan(scan);
    const instructions = deriveInstructionsFromScan(projectName, uniqueStack);

    setState((s) => ({
      ...s,
      step: 'review-instructions',
      draftResult: null,
      editedContextDocs: docs,
      instructionTemplates: instructions,
      editedInstructions: null,
    }));

    function deriveContextDocsFromScan(sr: typeof scan): Record<string, string> {
      const name = sr.suggestedName;
      const readmePreview = sr.readme?.preview ?? '';
      const indicators = sr.techIndicators.map((f) => f.relPath);
      const fileList = indicators.slice(0, 15).map((f) => `- ${f}`).join('\n');

      return {
        'PRODUCT.md': `# Product — ${name}\n\n${readmePreview ? `From README:\n\n${readmePreview.slice(0, 500)}\n\n` : ''}## Purpose\n\n[Derived from repository: ${sr.totalFilesSeen} files scanned, ${sr.identityFiles.length} project files, ${indicators.length} tech indicators.]\n`,
        'ARCHITECTURE.md': `# Architecture — ${name}\n\n## Detected stack\n\n${fileList || '_(no technology indicators detected)_'}\n\n## Project structure\n\n[${sr.totalFilesSeen} non-blocked files at depth ≤ 5.]\n`,
        'DESIGN.md': `# Design — ${name}\n\n## Visual language\n\n[Review existing UI components and design patterns in the codebase.]\n`,
        'DATA_MODEL.md': `# Data Model — ${name}\n\n## Entities\n\n[Inspect the codebase for data models, schemas, and persistence layers.]\n`,
        'INTEGRATIONS.md': `# Integrations — ${name}\n\n## External services\n\n[Detected from scan: ${indicators.filter((f) => f.includes('Info.plist') || f.includes('Package')).join(', ') || 'none identified'}.]\n`,
        'SECURITY.md': `# Security — ${name}\n\n## Security rules\n\n[Review the codebase for authentication, authorization, and data protection patterns.]\n`,
        'TESTING.md': `# Testing — ${name}\n\n## Test commands\n\n[Add your project-specific test commands here.]\n\n## Environments\n\n[Add environment-specific notes.]\n`,
        'DECISIONS.md': `# Decisions — ${name}\n\n## Confirmed decisions\n\n[Record architectural decisions as they are made.]\n\n## Hard constraints\n\n[Document areas that must not be changed without explicit review.]\n`,
        'CURRENT_STATE.md': `# Current State — ${name}\n\n## Scan summary\n\n- ${sr.totalFilesSeen} files scanned\n- ${sr.identityFiles.length} project identity files: ${sr.identityFiles.map((f) => f.relPath).join(', ') || 'none'}\n- ${indicators.length} technology indicators detected\n${sr.truncated ? '- Scan was truncated (file limit reached)' : ''}\n${sr.warnings.length > 0 ? `- ${sr.warnings.length} warnings during scan` : ''}\n\n## What works\n\n[To be determined — review the codebase.]\n\n## What is missing\n\n[To be determined.]\n`,
        'BACKLOG.md': `# Backlog — ${name}\n\n## Current milestone\n\n[Define your current development milestone.]\n\n## Planned tasks\n\n- [Task 1]\n- [Task 2]\n`,
      };
    }

    function deriveInstructionsFromScan(
      name: string,
      stack: string[],
    ): Array<{ filename: string; content: string }> {
      const stackLine = stack.length > 0
        ? `- Stack (detected from scan): ${stack.join(', ')}`
        : '- [Describe your tech stack and architectural constraints here.]';

      return [
        {
          filename: 'AGENTS.md',
          content: `# AGENTS.md — ${name}\n\nShared, provider-neutral instructions for any coding agent.\n\n## Architecture rules\n\n${stackLine}\n\n## Coding standards\n\n- Names in English; comments only where "why" is not obvious.\n\n## Hard security rules\n\n- Never commit secrets.\n\n## Test & validation commands\n\n\`\`\`bash\n# Add your project test/lint/typecheck commands here.\n\`\`\`\n\n## Working discipline\n\n- Read relevant docs and existing code before changing anything.\n- Do not modify unrelated files.\n- Destructive or irreversible operations require explicit user confirmation.\n`,
        },
        {
          filename: 'QWEN.md',
          content: `# Qwen-specific instructions\n\n- Follow AGENTS.md as the shared repository instruction source.\n- Inspect relevant existing files before making changes.\n- Do not scan the full repository unless the task requires it.\n- Prefer targeted tests over the complete suite during iteration.\n- Do not create subagents unless the task is explicitly marked Deep.\n- Stop before destructive database or deployment operations.\n- At completion, report changed files, tests, assumptions and remaining risks.\n\n# Project context\n\nRead \`.promptforge/context/\` for ${name} documentation.\n`,
        },
        {
          filename: 'CLAUDE.md',
          content: `@AGENTS.md\n\n# Claude-specific instructions\n\n- Use planning mode before high-risk architectural, billing or database work.\n- Do not over-engineer beyond the task scope.\n- Explicitly inspect edge cases and failure states.\n- Explain material architectural trade-offs before applying them.\n\n# Project context\n\nRead \`.promptforge/context/\` for ${name} documentation.\n`,
        },
      ];
    }
  }, [state.scanResult]);

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

      // Sync the context registry so the new docs are searchable.
      try {
        await syncContextRegistry(projectId);
      } catch {
        // Non-fatal: registry sync can be retried later.
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
