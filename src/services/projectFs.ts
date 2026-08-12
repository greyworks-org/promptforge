import { invokeIpc } from '../ipc';

/**
 * Project-scoped filesystem operations (Phase 3, trust-boundary hardened).
 *
 * Every operation is scoped to a registered project. Commands accept
 * `projectId` and Rust resolves the canonical root from the project
 * registry (SQLite). The frontend cannot supply an arbitrary root.
 *
 * All existing protections remain enforced in Rust:
 * - relative-path requirement (absolute paths rejected)
 * - `..` traversal blocked
 * - symlink escape blocked
 * - writes require `allowOverwrite: true` after user consent
 */

interface DirEntry {
  name: string;
  isDir: boolean;
  sizeBytes: number;
}

interface ScopedFsMetadata {
  exists: boolean;
  isDir: boolean;
  isFile: boolean;
  readable: boolean;
}

/** Resolve a projectId to its canonical root path. */
export async function resolveProjectRoot(projectId: string): Promise<string> {
  return invokeIpc<string>('fs_resolve_project_root', { projectId });
}

/** Read a text file scoped to a registered project. */
export async function readTextFile(projectId: string, relPath: string): Promise<string> {
  return invokeIpc<string>('fs_read_text', { projectId, path: relPath });
}

/**
 * Write text content to a file scoped to a registered project.
 * Pass `allowOverwrite: true` only after user consent for an existing file.
 */
export async function writeTextFile(
  projectId: string,
  relPath: string,
  content: string,
  allowOverwrite?: boolean,
): Promise<void> {
  await invokeIpc('fs_write_text', {
    projectId,
    path: relPath,
    content,
    allowOverwrite: allowOverwrite ?? false,
  });
}

/** List directory contents scoped to a registered project. Non-recursive. */
export async function listDirectory(projectId: string, relPath: string): Promise<DirEntry[]> {
  return invokeIpc<DirEntry[]>('fs_list_dir', { projectId, path: relPath });
}

/** Check whether a path exists, scoped to a registered project. */
export async function fileExists(projectId: string, relPath: string): Promise<boolean> {
  return invokeIpc<boolean>('fs_exists', { projectId, path: relPath });
}

/** Inspect an existing path without reading or modifying its contents. */
export async function metadata(projectId: string, relPath: string): Promise<ScopedFsMetadata> {
  return invokeIpc<ScopedFsMetadata>('fs_metadata_scoped', { projectId, path: relPath });
}
