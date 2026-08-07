/**
 * Blocked file and directory patterns (SECURITY.md §3.1, spec §13).
 *
 * These patterns are applied during repo scanning and context selection.
 * Blocked files cannot be selected in the UI and are dropped defensively
 * if they appear in any selection list.
 *
 * Additionally, any file under `.promptforge/tasks/` (previous TaskSpecs)
 * and any binary file are blocked — those checks happen at the scan layer,
 * not via glob patterns.
 */

/** Glob patterns for files that must never be included as context. */
export const BLOCKED_FILE_PATTERNS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  'credentials.json',
  'secrets.*',
] as const;

/** Directory names whose contents are entirely excluded from scanning. */
export const BLOCKED_DIR_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.turbo',
  '.cache',
  'target',
  'debug',
  'release',
] as const;

/** Paths relative to project root that are never included. */
export const BLOCKED_PATH_PREFIXES = [
  '.promptforge/tasks/',
  '.promptforge/assets/',
  '.promptforge/templates/',
] as const;

/** File extensions considered binary (never read as text context). */
export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.pdf', '.zip', '.gz', '.tar', '.tgz',
  '.exe', '.dll', '.so', '.dylib', '.wasm',
  '.mp3', '.mp4', '.mov', '.avi', '.webm',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.db', '.sqlite', '.sqlite3',
  '.bin', '.dat', '.pkl',
  '.lockb',
]);

/**
 * Returns true when `relPath` matches any blocked pattern.
 * Matching is case-sensitive and uses simple glob semantics
 * (`*` matches within a single path segment).
 */
export function isBlockedFilePath(relPath: string): boolean {
  const segments = relPath.split('/');
  const filename = segments[segments.length - 1];

  // Check directory blocks — any segment matching a blocked dir.
  for (const segment of segments) {
    for (const blocked of BLOCKED_DIR_PATTERNS) {
      if (segment === blocked) return true;
    }
  }

  // Check path prefix blocks.
  for (const prefix of BLOCKED_PATH_PREFIXES) {
    if (relPath.startsWith(prefix)) return true;
  }

  // Check file-pattern blocks against the filename.
  for (const pattern of BLOCKED_FILE_PATTERNS) {
    if (matchSimpleGlob(filename, pattern)) return true;
  }

  return false;
}

/**
 * Returns true when `relPath` has a binary extension.
 */
export function isBinaryByExtension(relPath: string): boolean {
  const lastDot = relPath.lastIndexOf('.');
  if (lastDot === -1) return false;
  const ext = relPath.slice(lastDot).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Simple glob match: `*` matches any sequence of non-separator characters.
 * Only supports a single `*` wildcard.
 */
function matchSimpleGlob(value: string, pattern: string): boolean {
  if (!pattern.includes('*')) return value === pattern;

  const parts = pattern.split('*');
  if (parts.length !== 2) return value === pattern;

  const [prefix, suffix] = parts;
  if (prefix !== '' && !value.startsWith(prefix)) return false;
  if (suffix !== '' && !value.endsWith(suffix)) return false;
  const middle = value.slice(prefix.length, value.length - suffix.length);
  return !middle.includes('/');
}
