import { isBlockedFilePath, isBinaryByExtension } from '../redaction/blocklist';
import { listDirectory, readTextFile, resolveProjectRoot } from './projectFs';

/**
 * Repository scanner (Phase 3, trust-boundary hardened).
 *
 * Accepts a registered `projectId`; resolves the canonical root from the
 * project registry in Rust. All fs operations are scoped to that root.
 */

const MAX_SCAN_DEPTH = 5;
const MAX_SCAN_FILES = 2000;

const ROOT_IDENTITY_FILES = [
  'README.md', 'README', 'README.txt',
  'package.json', 'Cargo.toml', 'go.mod',
  'pyproject.toml', 'setup.py', 'Makefile',
  'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile',
  'Package.swift',
];

/** Directory names that signal project identity at root level. */
const ROOT_IDENTITY_DIRS = [
  '.xcodeproj',
];

const TECH_INDICATOR_FILES = [
  'tsconfig.json', 'vite.config.ts', 'vite.config.js',
  'tailwind.config.ts', 'tailwind.config.js',
  'next.config.js', 'next.config.ts',
  'svelte.config.js', 'astro.config.mjs',
  'Gemfile', 'requirements.txt', 'Cargo.lock',
  'pnpm-lock.yaml', 'yarn.lock',
  'eslint.config.js', 'eslint.config.ts',
  '.eslintrc.js', '.eslintrc.json',
  'prettier.config.js', 'prettier.config.ts', '.prettierrc',
  'firebase.json', 'vercel.json', 'netlify.toml', 'wrangler.toml',
  // Xcode / Swift
  'Info.plist', 'project.pbxproj',
];

/** File extensions that indicate technology choices. */
const TECH_INDICATOR_EXTENSIONS = [
  '.swift',
  '.xcconfig',
  '.entitlements',
];

export interface DiscoveredFile {
  relPath: string;
  sizeBytes: number;
  preview: string | null;
}

export interface ScanResult {
  rootPath: string;
  suggestedName: string;
  readme: DiscoveredFile | null;
  identityFiles: DiscoveredFile[];
  techIndicators: DiscoveredFile[];
  allFiles: DiscoveredFile[];
  truncated: boolean;
  totalFilesSeen: number;
  warnings: string[];
}

interface DirEntry {
  name: string;
  isDir: boolean;
  sizeBytes: number;
}

function basename(absPath: string): string {
  const segments = absPath.replace(/\/+$/, '').split('/');
  return segments[segments.length - 1] || absPath;
}

interface QueueItem {
  relDir: string;
  depth: number;
}

export async function scanRepository(projectId: string): Promise<ScanResult> {
  const rootPath = await resolveProjectRoot(projectId);

  const warnings: string[] = [];
  const allFiles: DiscoveredFile[] = [];
  let totalFilesSeen = 0;
  let truncated = false;

  const identityFiles: DiscoveredFile[] = [];
  const techIndicators: DiscoveredFile[] = [];

  const queue: QueueItem[] = [{ relDir: '', depth: 0 }];

  while (queue.length > 0 && allFiles.length < MAX_SCAN_FILES) {
    const item = queue.shift()!;

    let entries: DirEntry[];
    try {
      entries = await listDirectory(projectId, item.relDir);
    } catch {
      warnings.push(`Could not read directory: ${item.relDir || '(root)'}`);
      continue;
    }

    for (const entry of entries) {
      const relPath = item.relDir ? `${item.relDir}/${entry.name}` : entry.name;

      // Prune blocked paths BEFORE counting, before queueing, before everything.
      if (isBlockedFilePath(relPath)) continue;

      totalFilesSeen += 1;
      if (allFiles.length >= MAX_SCAN_FILES) {
        truncated = true;
        break;
      }

      if (entry.isDir) {
        // Recognise Xcode projects and other identity directories at root.
        if (item.depth === 0 && ROOT_IDENTITY_DIRS.some((d) => entry.name.endsWith(d))) {
          identityFiles.push({ relPath, sizeBytes: entry.sizeBytes, preview: null });
        }
        if (item.depth < MAX_SCAN_DEPTH) {
          queue.push({ relDir: relPath, depth: item.depth + 1 });
        }
        continue;
      }

      if (isBinaryByExtension(relPath)) continue;

      if (entry.sizeBytes > 1_048_576) {
        warnings.push(`Skipped large file: ${relPath}`);
        continue;
      }

      let preview: string | null = null;
      try {
        const content = await readTextFile(projectId, relPath);
        preview = content.slice(0, 500);
      } catch {
        warnings.push(`Could not read: ${relPath}`);
        continue;
      }

      const discovered: DiscoveredFile = { relPath, sizeBytes: entry.sizeBytes, preview };
      allFiles.push(discovered);

      if (item.depth === 0 && ROOT_IDENTITY_FILES.includes(entry.name)) {
        identityFiles.push(discovered);
      }

      if (item.depth <= 2 && (
        TECH_INDICATOR_FILES.some(
          (t) => entry.name === t || entry.name.startsWith(`${t}/`),
        ) ||
        TECH_INDICATOR_EXTENSIONS.some((ext) => entry.name.endsWith(ext))
      )) {
        techIndicators.push(discovered);
      }
    }
  }

  if (allFiles.length >= MAX_SCAN_FILES) truncated = true;

  const foundReadme = identityFiles.find(
    (f) => { const n = f.relPath.split('/').pop(); return n ? n.startsWith('README') : false; },
  ) ?? null;

  return {
    rootPath,
    suggestedName: basename(rootPath),
    readme: foundReadme,
    identityFiles,
    techIndicators,
    allFiles,
    truncated,
    totalFilesSeen,
    warnings,
  };
}
