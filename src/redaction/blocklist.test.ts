import { describe, it, expect } from 'vitest';
import { isBlockedFilePath, isBinaryByExtension } from '../redaction/blocklist';

describe('isBlockedFilePath', () => {
  it('blocks directory patterns anywhere in the path', () => {
    expect(isBlockedFilePath('node_modules/foo/bar.ts')).toBe(true);
    expect(isBlockedFilePath('src/node_modules/foo.ts')).toBe(true);
    expect(isBlockedFilePath('.git/HEAD')).toBe(true);
    expect(isBlockedFilePath('dist/bundle.js')).toBe(true);
    expect(isBlockedFilePath('build/output.js')).toBe(true);
    expect(isBlockedFilePath('.next/cache/data')).toBe(true);
    expect(isBlockedFilePath('coverage/lcov.info')).toBe(true);
    expect(isBlockedFilePath('__pycache__/module.pyc')).toBe(true);
    expect(isBlockedFilePath('.venv/lib/python')).toBe(true);
    expect(isBlockedFilePath('venv/lib/python')).toBe(true);
  });

  it('blocks file patterns by filename', () => {
    expect(isBlockedFilePath('.env')).toBe(true);
    expect(isBlockedFilePath('src/.env')).toBe(true);
    expect(isBlockedFilePath('.env.production')).toBe(true);
    expect(isBlockedFilePath('config/.env.local')).toBe(true);
    expect(isBlockedFilePath('certs/server.pem')).toBe(true);
    expect(isBlockedFilePath('certs/private.key')).toBe(true);
    expect(isBlockedFilePath('credentials.json')).toBe(true);
    expect(isBlockedFilePath('secrets.yml')).toBe(true);
    expect(isBlockedFilePath('config/secrets.yaml')).toBe(true);
  });

  it('blocks path prefixes', () => {
    expect(isBlockedFilePath('.promptforge/tasks/TASK-2026-0001.json')).toBe(true);
    expect(isBlockedFilePath('.promptforge/assets/screenshot.png')).toBe(true);
    expect(isBlockedFilePath('.promptforge/templates/thing.md')).toBe(true);
  });

  it('allows safe files', () => {
    expect(isBlockedFilePath('src/main.ts')).toBe(false);
    expect(isBlockedFilePath('README.md')).toBe(false);
    expect(isBlockedFilePath('package.json')).toBe(false);
    expect(isBlockedFilePath('.promptforge/context/PRODUCT.md')).toBe(false);
    expect(isBlockedFilePath('.promptforge/project.json')).toBe(false);
    expect(isBlockedFilePath('src/components/Button.tsx')).toBe(false);
    expect(isBlockedFilePath('docs/ARCHITECTURE.md')).toBe(false);
  });

  it('does not match partial directory names', () => {
    expect(isBlockedFilePath('my_node_modules_backup/file.txt')).toBe(false);
    expect(isBlockedFilePath('distributed/system.ts')).toBe(false);
    expect(isBlockedFilePath('building/blocks.ts')).toBe(false);
  });

  it('wildcard matches do not cross directory boundaries', () => {
    // .env.* should match .env.local but not dir/.env/sub
    expect(isBlockedFilePath('.env.production')).toBe(true);
    expect(isBlockedFilePath('.env.local')).toBe(true);
    expect(isBlockedFilePath('dir/.env/sub/file')).toBe(false); // .env is a directory, not a file
  });
});

describe('isBinaryByExtension', () => {
  it('detects common binary extensions', () => {
    expect(isBinaryByExtension('photo.png')).toBe(true);
    expect(isBinaryByExtension('doc.pdf')).toBe(true);
    expect(isBinaryByExtension('archive.zip')).toBe(true);
    expect(isBinaryByExtension('icon.ico')).toBe(true);
    expect(isBinaryByExtension('font.woff2')).toBe(true);
    expect(isBinaryByExtension('data.db')).toBe(true);
    expect(isBinaryByExtension('data.sqlite')).toBe(true);
    expect(isBinaryByExtension('app.exe')).toBe(true);
  });

  it('allows text extensions', () => {
    expect(isBinaryByExtension('main.ts')).toBe(false);
    expect(isBinaryByExtension('README.md')).toBe(false);
    expect(isBinaryByExtension('App.tsx')).toBe(false);
    expect(isBinaryByExtension('package.json')).toBe(false);
    expect(isBinaryByExtension('styles.css')).toBe(false);
    expect(isBinaryByExtension('config.toml')).toBe(false);
    expect(isBinaryByExtension('Dockerfile')).toBe(false);
    expect(isBinaryByExtension('Makefile')).toBe(false);
  });

  it('handles no extension', () => {
    expect(isBinaryByExtension('README')).toBe(false);
    expect(isBinaryByExtension('Makefile')).toBe(false);
    expect(isBinaryByExtension('LICENSE')).toBe(false);
  });

  it('is case-insensitive for extensions', () => {
    expect(isBinaryByExtension('image.PNG')).toBe(true);
    expect(isBinaryByExtension('image.Png')).toBe(true);
    expect(isBinaryByExtension('doc.PDF')).toBe(true);
  });
});
