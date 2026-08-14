import { describe, expect, it } from 'vitest';
import { realpathSync } from 'node:fs';
import { findGitRoot } from '../vscode-extension/src/workspaceProject';

/**
 * The VS Code command resolves the canonical workspace Git root, which is what
 * PromptForge stored when the project was registered.
 */
describe('VS Code workspace Git root resolution', () => {
  const repoRoot = realpathSync(process.cwd());

  it('walks up from a nested workspace folder to the repository root', () => {
    expect(findGitRoot(`${repoRoot}/src/services`)).toBe(repoRoot);
    expect(findGitRoot(repoRoot)).toBe(repoRoot);
  });

  it('returns null outside any repository', () => {
    expect(findGitRoot('/')).toBeNull();
  });
});
