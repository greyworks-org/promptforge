import { useCallback, useEffect, useState } from 'react';
import type { ProjectRecord } from '../db/repos/projects';
import { ProjectList } from '../components/ProjectList';
import {
  DuplicateRepoPathError,
  InvalidFolderError,
  ProjectNotFoundError,
  getActiveProjectId,
  listProjects,
  registerProject,
  removeProject,
  setActiveProject,
  updateProject,
} from '../services/projectsService';
import { pickDirectory } from '../ipc';

export interface ProjectsScreenProps {
  /** Injectable for tests; default to the real services. */
  deps?: {
    listProjects?: typeof listProjects;
    registerProject?: typeof registerProject;
    updateProject?: typeof updateProject;
    removeProject?: typeof removeProject;
    setActiveProject?: typeof setActiveProject;
    getActiveProjectId?: typeof getActiveProjectId;
    pickDirectory?: typeof pickDirectory;
  };
  /** Callback to launch the onboarding wizard (Phase 3). */
  onStartOnboarding?: (projectId?: string) => void;
  /** Callback to generate a handoff for an existing project. */
  onContinue?: (projectId: string, projectName: string) => void;
  onActiveChanged?: (projectId: string) => void;
}

type LoadState = 'loading' | 'ready' | 'error';

function friendlyError(err: unknown): string {
  if (
    err instanceof DuplicateRepoPathError ||
    err instanceof InvalidFolderError ||
    err instanceof ProjectNotFoundError
  ) {
    return err.message;
  }
  if (err instanceof Error && err.message !== '') return err.message;
  return 'Something went wrong. Please try again.';
}

export function ProjectsScreen({ deps, onStartOnboarding, onContinue, onActiveChanged }: ProjectsScreenProps) {
  const list = deps?.listProjects ?? listProjects;
  const register = deps?.registerProject ?? registerProject;
  const update = deps?.updateProject ?? updateProject;
  const remove = deps?.removeProject ?? removeProject;
  const setActive = deps?.setActiveProject ?? setActiveProject;
  const activeIdOf = deps?.getActiveProjectId ?? getActiveProjectId;
  const pickFolder = deps?.pickDirectory ?? pickDirectory;

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [folderPath, setFolderPath] = useState('');
  const [projectName, setProjectName] = useState('');
  const [busy, setBusy] = useState<'idle' | 'adding' | 'browsing'>('idle');

  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editMilestone, setEditMilestone] = useState('');
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextProjects, nextActiveId] = await Promise.all([list(), activeIdOf()]);
    setProjects(nextProjects);
    setActiveId(nextActiveId);
  }, [list, activeIdOf]);

  const loadAll = useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);
    try {
      await refresh();
      setLoadState('ready');
    } catch (err) {
      setLoadError(friendlyError(err));
      setLoadState('error');
    }
  }, [refresh]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const clearMessages = () => {
    setNotice(null);
    setActionError(null);
  };

  const onBrowse = async () => {
    clearMessages();
    setBusy('browsing');
    try {
      const picked = await pickFolder();
      if (picked !== null) setFolderPath(picked);
    } catch {
      setActionError('Folder picker could not be opened.');
    } finally {
      setBusy('idle');
    }
  };

  const onAdd = async () => {
    clearMessages();
    setBusy('adding');
    try {
      const created = await register({ folderPath, name: projectName.trim() === '' ? undefined : projectName.trim() });
      setNotice(`Project "${created.name}" added.`);
      setFolderPath('');
      setProjectName('');
      setAdding(false);
      await refresh();
    } catch (err) {
      setActionError(friendlyError(err));
    } finally {
      setBusy('idle');
    }
  };

  const onSetActive = async (projectId: string) => {
    clearMessages();
    setBusyId(projectId);
    try {
      await setActive(projectId);
      await refresh();
      onActiveChanged?.(projectId);
    } catch (err) {
      setActionError(friendlyError(err));
    } finally {
      setBusyId(null);
    }
  };

  const onStartEdit = (project: ProjectRecord) => {
    clearMessages();
    setConfirmingRemoveId(null);
    setEditingId(project.id);
    setEditName(project.name);
    setEditMilestone(project.currentMilestone ?? '');
  };

  const onSaveEdit = async (projectId: string) => {
    clearMessages();
    setBusyId(projectId);
    try {
      await update(projectId, { name: editName, currentMilestone: editMilestone });
      setEditingId(null);
      setNotice('Project updated.');
      await refresh();
    } catch (err) {
      setActionError(friendlyError(err));
    } finally {
      setBusyId(null);
    }
  };

  const onConfirmRemove = async (projectId: string) => {
    clearMessages();
    setBusyId(projectId);
    try {
      await remove(projectId);
      setConfirmingRemoveId(null);
      setEditingId(null);
      setNotice('Project removed from PromptForge. Files on disk were not touched.');
      await refresh();
    } catch (err) {
      setActionError(friendlyError(err));
    } finally {
      setBusyId(null);
    }
  };

  const inputClass =
    'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none';

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Projects</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Register the local folders you develop in. PromptForge never modifies or
            deletes your files — removing a project only removes it from this library.
          </p>
        </div>
        {loadState === 'ready' && projects.length > 0 && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                clearMessages();
                setAdding((v) => !v);
              }}
              className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Add project
            </button>
            {onStartOnboarding && (
              <button
                type="button"
                onClick={() => onStartOnboarding(activeId ?? undefined)}
                className="shrink-0 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Guided setup
              </button>
            )}
          </div>
        )}
      </div>

      {notice !== null && (
        <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
          {notice}
        </p>
      )}
      {actionError !== null && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {actionError}
        </p>
      )}

      {adding && (
        <div className="mt-5 grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-4">
          <div className="grid gap-1 text-sm">
            <label className="grid gap-1" htmlFor="project-folder-path">
              <span className="font-medium">Project folder</span>
              <input
                id="project-folder-path"
                className={inputClass}
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder="/Users/you/code/my-project"
              />
            </label>
            <span className="text-xs text-zinc-400">
              Absolute path to the project root. The folder is registered, not copied.
            </span>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Project name (optional)</span>
            <input
              className={inputClass}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Defaults to the folder name"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void onBrowse()}
              disabled={busy !== 'idle'}
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Browse…
            </button>
            <button
              type="button"
              onClick={() => void onAdd()}
              disabled={busy !== 'idle' || folderPath.trim() === ''}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {busy === 'adding' ? 'Adding…' : 'Register project'}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              disabled={busy !== 'idle'}
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-5">
        {loadState === 'loading' && (
          <p className="text-sm text-zinc-500" role="status">
            Opening project library…
          </p>
        )}

        {loadState === 'error' && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
            <p>The project library could not be opened.</p>
            <p className="mt-1 text-xs">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadAll()}
              className="mt-3 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700"
            >
              Retry
            </button>
          </div>
        )}

        {loadState === 'ready' && projects.length === 0 && (
          <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center">
            <p className="text-sm font-medium text-zinc-700">No projects yet</p>
            <p className="mt-1 text-sm text-zinc-500">
              Register a local project folder to start compiling prompts for it.
            </p>
            {!adding && (
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  Add your first project
                </button>
                {onStartOnboarding && (
                  <button
                    type="button"
                    onClick={() => onStartOnboarding()}
                    className="mt-4 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    Guided setup
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {loadState === 'ready' && projects.length > 0 && (
          <ProjectList
            projects={projects}
            activeId={activeId}
            busyId={busyId}
            editingId={editingId}
            editName={editName}
            editMilestone={editMilestone}
            confirmingRemoveId={confirmingRemoveId}
            onSetActive={(id) => void onSetActive(id)}
            onContinue={onContinue}
            onStartEdit={onStartEdit}
            onEditNameChange={setEditName}
            onEditMilestoneChange={setEditMilestone}
            onSaveEdit={(id) => void onSaveEdit(id)}
            onCancelEdit={() => setEditingId(null)}
            onAskRemove={(id) => {
              clearMessages();
              setEditingId(null);
              setConfirmingRemoveId(id);
            }}
            onConfirmRemove={(id) => void onConfirmRemove(id)}
            onCancelRemove={() => setConfirmingRemoveId(null)}
          />
        )}
      </div>
    </section>
  );
}
