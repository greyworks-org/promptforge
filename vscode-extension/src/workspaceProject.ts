import { existsSync, realpathSync } from 'fs';
import { dirname, join, resolve } from 'path';

/**
 * Canonical Git root of the current workspace.
 *
 * Walks up from the workspace folder to the first directory containing `.git`
 * and resolves symlinks, so the path matches the canonicalized root PromptForge
 * stored when the project was registered. No Git process is spawned.
 */
export function findGitRoot(startPath: string): string | null {
  let current = resolve(startPath);
  for (let depth = 0; depth < 64; depth += 1) {
    if (existsSync(join(current, '.git'))) {
      try {
        return realpathSync(current);
      } catch {
        return current;
      }
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}
