import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProjectsScreen, type ProjectsScreenProps } from './ProjectsScreen';
import type { ProjectRecord } from '../db/repos/projects';
import { DuplicateRepoPathError } from '../services/projectsService';

const alpha: ProjectRecord = {
  id: 'project-alpha',
  name: 'Alpha',
  repoPath: '/tmp/alpha',
  currentMilestone: 'Phase 2',
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

const beta: ProjectRecord = {
  id: 'project-beta',
  name: 'Beta',
  repoPath: '/tmp/beta',
  currentMilestone: null,
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

function makeDeps(overrides: Partial<NonNullable<ProjectsScreenProps['deps']>> = {}) {
  return {
    listProjects: vi.fn(async () => [alpha, beta]),
    registerProject: vi.fn(async (input: { folderPath: string; name?: string }) => ({
      ...alpha,
      id: 'project-gamma',
      name: input.name ?? 'gamma',
      repoPath: input.folderPath,
    })),
    updateProject: vi.fn(async () => alpha),
    removeProject: vi.fn(async () => undefined),
    setActiveProject: vi.fn(async () => undefined),
    getActiveProjectId: vi.fn(async () => 'project-alpha'),
    pickDirectory: vi.fn(async () => null),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProjectsScreen', () => {
  it('shows a loading state, then the project list with the active badge', async () => {
    render(<ProjectsScreen deps={makeDeps()} />);
    expect(screen.getByText('Opening project library…')).toBeTruthy();

    const alphaRow = (await screen.findByText('/tmp/alpha')).closest('li') as HTMLElement;
    expect(within(alphaRow).getByText('Active')).toBeTruthy();
    const betaRow = screen.getByText('/tmp/beta').closest('li') as HTMLElement;
    expect(within(betaRow).queryByText('Active')).toBeNull();
    expect(within(betaRow).getByRole('button', { name: 'Set active' })).toBeTruthy();
    expect(screen.getByText('Milestone: Phase 2')).toBeTruthy();
  });

  it('shows the empty state when no projects are registered', async () => {
    render(<ProjectsScreen deps={makeDeps({ listProjects: vi.fn(async () => []) })} />);
    expect(await screen.findByText('No projects yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add your first project' })).toBeTruthy();
  });

  it('shows an error state with retry when the library cannot be opened', async () => {
    const listProjects = vi
      .fn()
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValue([alpha]);
    render(<ProjectsScreen deps={makeDeps({ listProjects })} />);

    expect(await screen.findByText('The project library could not be opened.')).toBeTruthy();
    expect(screen.getByText('database is locked')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('/tmp/alpha')).toBeTruthy();
  });

  it('registers a project from a typed path and shows a success notice', async () => {
    const deps = makeDeps();
    render(<ProjectsScreen deps={deps} />);
    await screen.findByText('/tmp/alpha');

    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    fireEvent.change(screen.getByLabelText('Project folder'), {
      target: { value: '  /tmp/gamma  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register project' }));

    await waitFor(() =>
      expect(deps.registerProject).toHaveBeenCalledWith({ folderPath: '  /tmp/gamma  ', name: undefined }),
    );
    expect(await screen.findByText('Project "gamma" added.')).toBeTruthy();
    await waitFor(() => expect(deps.listProjects).toHaveBeenCalledTimes(2));
  });

  it('shows a duplicate-folder error without crashing', async () => {
    const deps = makeDeps({
      registerProject: vi.fn(async () => {
        throw new DuplicateRepoPathError('/tmp/alpha', 'Alpha');
      }),
    });
    render(<ProjectsScreen deps={deps} />);
    await screen.findByText('/tmp/alpha');

    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    fireEvent.change(screen.getByLabelText('Project folder'), { target: { value: '/tmp/alpha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register project' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('already registered as "Alpha"');
  });

  it('fills the folder path from the native picker', async () => {
    const deps = makeDeps({ pickDirectory: vi.fn(async () => '/picked/folder') });
    render(<ProjectsScreen deps={deps} />);
    await screen.findByText('/tmp/alpha');

    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Project folder') as HTMLInputElement).value).toBe('/picked/folder'),
    );
  });

  it('sets the active project', async () => {
    const onActiveChanged = vi.fn();
    const deps = makeDeps();
    render(<ProjectsScreen deps={deps} onActiveChanged={onActiveChanged} />);
    const betaRow = (await screen.findByText('/tmp/beta')).closest('li') as HTMLElement;
    fireEvent.click(within(betaRow).getByRole('button', { name: 'Set active' }));
    await waitFor(() => expect(deps.setActiveProject).toHaveBeenCalledWith('project-beta'));
    await waitFor(() => expect(onActiveChanged).toHaveBeenCalledWith('project-beta'));
  });

  it('edits project metadata through the inline edit form', async () => {
    const deps = makeDeps();
    render(<ProjectsScreen deps={deps} />);
    const alphaRow = (await screen.findByText('/tmp/alpha')).closest('li') as HTMLElement;
    fireEvent.click(within(alphaRow).getByRole('button', { name: 'Edit' }));

    const nameInput = within(alphaRow).getByLabelText('Project name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Alpha Prime' } });
    fireEvent.click(within(alphaRow).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(deps.updateProject).toHaveBeenCalledWith('project-alpha', {
        name: 'Alpha Prime',
        currentMilestone: 'Phase 2',
      }),
    );
    expect(await screen.findByText('Project updated.')).toBeTruthy();
  });

  it('removes a project only after explicit confirmation', async () => {
    const deps = makeDeps();
    render(<ProjectsScreen deps={deps} />);
    const betaRow = (await screen.findByText('/tmp/beta')).closest('li') as HTMLElement;

    fireEvent.click(within(betaRow).getByRole('button', { name: 'Remove' }));
    expect(
      within(betaRow).getByText((_content, el) => el?.textContent === 'Remove Beta from PromptForge?'),
    ).toBeTruthy();
    expect(within(betaRow).getByText(/stay on disk/)).toBeTruthy();

    // Cancel first: nothing is removed.
    fireEvent.click(within(betaRow).getByRole('button', { name: 'Keep project' }));
    expect(deps.removeProject).not.toHaveBeenCalled();

    fireEvent.click(within(betaRow).getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(betaRow).getByRole('button', { name: 'Remove project' }));
    await waitFor(() => expect(deps.removeProject).toHaveBeenCalledWith('project-beta'));
    expect(
      await screen.findByText('Project removed from PromptForge. Files on disk were not touched.'),
    ).toBeTruthy();
  });
});
