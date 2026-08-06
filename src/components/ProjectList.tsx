import type { ProjectRecord } from '../db/repos/projects';

export interface ProjectListProps {
  projects: ProjectRecord[];
  activeId: string | null;
  busyId: string | null;
  editingId: string | null;
  editName: string;
  editMilestone: string;
  confirmingRemoveId: string | null;
  onSetActive: (projectId: string) => void;
  onStartEdit: (project: ProjectRecord) => void;
  onEditNameChange: (value: string) => void;
  onEditMilestoneChange: (value: string) => void;
  onSaveEdit: (projectId: string) => void;
  onCancelEdit: () => void;
  onAskRemove: (projectId: string) => void;
  onConfirmRemove: (projectId: string) => void;
  onCancelRemove: () => void;
}

const secondaryButton =
  'rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium disabled:opacity-50';
const inputClass =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none';

/** Presentational list of registered projects; all actions come back as callbacks. */
export function ProjectList(props: ProjectListProps) {
  const {
    projects,
    activeId,
    busyId,
    editingId,
    editName,
    editMilestone,
    confirmingRemoveId,
  } = props;

  return (
    <ul className="grid gap-3">
      {projects.map((project) => {
        const busy = busyId === project.id;
        const isActive = activeId === project.id;
        const isEditing = editingId === project.id;
        const isConfirmingRemove = confirmingRemoveId === project.id;

        return (
          <li
            key={project.id}
            className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
            data-project-id={project.id}
          >
            {isConfirmingRemove ? (
              <div className="grid gap-3">
                <p className="text-sm text-zinc-800">
                  Remove <span className="font-semibold">{project.name}</span> from PromptForge?
                </p>
                <p className="text-xs text-zinc-500">
                  This only removes the project from PromptForge&apos;s library. The folder
                  {' '}{project.repoPath} and its files stay on disk.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
                    onClick={() => props.onConfirmRemove(project.id)}
                    disabled={busy}
                  >
                    Remove project
                  </button>
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={props.onCancelRemove}
                    disabled={busy}
                  >
                    Keep project
                  </button>
                </div>
              </div>
            ) : isEditing ? (
              <div className="grid gap-3">
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Project name</span>
                  <input
                    className={inputClass}
                    value={editName}
                    onChange={(e) => props.onEditNameChange(e.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Current milestone</span>
                  <input
                    className={inputClass}
                    value={editMilestone}
                    placeholder="e.g. Phase 2 — project registry"
                    onChange={(e) => props.onEditMilestoneChange(e.target.value)}
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    onClick={() => props.onSaveEdit(project.id)}
                    disabled={busy}
                  >
                    Save changes
                  </button>
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={props.onCancelEdit}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">{project.name}</h3>
                    {isActive && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">{project.repoPath}</p>
                  {project.currentMilestone !== null && project.currentMilestone !== '' && (
                    <p className="mt-1 text-xs text-zinc-600">Milestone: {project.currentMilestone}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {!isActive && (
                    <button
                      type="button"
                      className={secondaryButton}
                      onClick={() => props.onSetActive(project.id)}
                      disabled={busy}
                    >
                      Set active
                    </button>
                  )}
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={() => props.onStartEdit(project)}
                    disabled={busy}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
                    onClick={() => props.onAskRemove(project.id)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
