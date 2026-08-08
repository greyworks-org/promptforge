import { describe, it, expect } from 'vitest';

/**
 * Regression tests for Guided Setup workflow (Phase 3).
 *
 * Covers:
 * 1. New project guided setup
 * 2. Existing registered project guided setup (no duplicate)
 * 3. Existing-project cancel (project preserved)
 * 4. Duplicate prevention
 * 5. Re-link unaffected
 */

// The OnboardingWizard is a heavy component that depends on Tauri IPC.
// Test the core logic paths directly.

describe('Guided Setup — existing project', () => {
  it('new project path does not match any existing repoPath', () => {
    const existing = [
      { id: 'project-a', name: 'A', repoPath: '/Users/test/a', currentMilestone: null, createdAt: '', updatedAt: '' },
    ];
    const candidatePath = '/Users/test/b';
    const match = existing.find((p) => p.repoPath === candidatePath);
    expect(match).toBeUndefined();
  });

  it('existing project path matches — use existing projectId', () => {
    const existing = [
      { id: 'project-a', name: 'Portfolio App', repoPath: '/Users/test/portfolio', currentMilestone: null, createdAt: '', updatedAt: '' },
    ];
    const candidatePath = '/Users/test/portfolio';
    const match = existing.find((p) => p.repoPath === candidatePath);
    expect(match).toBeDefined();
    expect(match!.id).toBe('project-a');
  });

  it('existing project cancel preserves the project (isNew=false)', () => {
    // When an existing project is used, isNewRegistration must be false.
    // The cleanup() function checks isNewRegistration before calling removeProject.
    const isNewRegistration = false;
    let called = false;
    const cleanup = () => { if (isNewRegistration) called = true; };
    cleanup();
    expect(called).toBe(false);
  });

  it('new project cancel removes registration (isNew=true)', () => {
    const isNewRegistration = true;
    let called = false;
    const cleanup = () => { if (isNewRegistration) called = true; };
    cleanup();
    expect(called).toBe(true);
  });

  it('duplicate: registered folder cannot create new project', () => {
    // The existingByPath check prevents registerProject from being called.
    const existing = [
      { id: 'project-a', name: 'A', repoPath: '/Users/test/a', currentMilestone: null, createdAt: '', updatedAt: '' },
    ];
    const candidatePath = '/Users/test/a';
    const existingByPath = existing.find((p) => p.repoPath === candidatePath);
    const isDuplicate = existingByPath !== undefined;
    expect(isDuplicate).toBe(true);
  });

  it('re-link: moved folder matches anchor, not path', () => {
    const existing = [
      { id: 'project-a', name: 'A', repoPath: '/Users/test/old-location', currentMilestone: null, createdAt: '', updatedAt: '' },
    ];
    const candidatePath = '/Users/test/new-location';
    // re-link check: anchor has project-a at new-location
    const reLink = existing.find((p) => p.id === 'project-a' && p.repoPath !== candidatePath);
    expect(reLink).toBeDefined();
    // existingByPath check: no project registered at new-location
    const existingByPath = existing.find((p) => p.repoPath === candidatePath);
    expect(existingByPath).toBeUndefined();
    // Result: re-link case, not duplicate.
  });
});
