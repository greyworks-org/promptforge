import { describe, it, expect } from 'vitest';
import {
  diffPreview,
  fileWriteSummary,
  categorizeFileWrite,
  PROMPTFORGE_MARKER,
  type FileWriteRequest,
} from '../services/consent';

describe('diffPreview', () => {
  it('shows identical lines unchanged', () => {
    const existing = 'line1\nline2\nline3';
    const proposed = 'line1\nline2\nline3';
    const diff = diffPreview(existing, proposed);
    expect(diff).toContain('  line1');
    expect(diff).toContain('  line2');
    expect(diff).toContain('  line3');
    expect(diff).not.toContain('-');
    expect(diff).not.toContain('+');
  });

  it('shows added lines with +', () => {
    const existing = 'line1';
    const proposed = 'line1\nline2';
    const diff = diffPreview(existing, proposed);
    expect(diff).toContain('+ line2');
  });

  it('shows removed lines with -', () => {
    const existing = 'line1\nline2';
    const proposed = 'line1';
    const diff = diffPreview(existing, proposed);
    expect(diff).toContain('- line2');
  });

  it('shows modified lines as remove + add', () => {
    const existing = 'line1';
    const proposed = 'modified line1';
    const diff = diffPreview(existing, proposed);
    expect(diff).toContain('- line1');
    expect(diff).toContain('+ modified line1');
  });

  it('handles one side being empty', () => {
    const diff = diffPreview('', 'new content');
    expect(diff).toContain('+ new content');
  });

  it('handles both sides empty', () => {
    expect(diffPreview('', '')).toBe('');
  });
});

describe('fileWriteSummary', () => {
  it('reports new files', () => {
    const requests: FileWriteRequest[] = [
      { absPath: '/test/new.md', content: 'x', exists: false, isForeign: false },
    ];
    expect(fileWriteSummary(requests)).toBe('1 new file');
  });

  it('reports overwrites', () => {
    const requests: FileWriteRequest[] = [
      { absPath: '/test/old.md', content: 'x', exists: true, isForeign: false },
    ];
    expect(fileWriteSummary(requests)).toBe('1 overwrite');
  });

  it('combines new and overwrite counts', () => {
    const requests: FileWriteRequest[] = [
      { absPath: '/test/a.md', content: 'x', exists: false, isForeign: false },
      { absPath: '/test/b.md', content: 'x', exists: false, isForeign: false },
      { absPath: '/test/c.md', content: 'x', exists: true, isForeign: false },
    ];
    expect(fileWriteSummary(requests)).toBe('2 new files, 1 overwrite');
  });

  it('uses plural only when count > 1', () => {
    const requests: FileWriteRequest[] = [
      { absPath: '/test/a.md', content: 'x', exists: false, isForeign: false },
      { absPath: '/test/b.md', content: 'x', exists: true, isForeign: false },
    ];
    expect(fileWriteSummary(requests)).toBe('1 new file, 1 overwrite');
  });

  it('returns empty string for no requests', () => {
    expect(fileWriteSummary([])).toBe('');
  });
});

describe('categorizeFileWrite', () => {
  it('returns exists:false for null content', () => {
    const result = categorizeFileWrite(null);
    expect(result.exists).toBe(false);
    expect(result.isForeign).toBe(false);
  });

  it('detects PromptForge-owned AGENTS.md', () => {
    const result = categorizeFileWrite('# AGENTS.md — My Project\n\nSome content');
    expect(result.exists).toBe(true);
    expect(result.isForeign).toBe(false);
  });

  it('detects PromptForge-owned QWEN.md', () => {
    const result = categorizeFileWrite('# Qwen-specific instructions\n\nContent');
    expect(result.exists).toBe(true);
    expect(result.isForeign).toBe(false);
  });

  it('detects PromptForge-owned CLAUDE.md', () => {
    const result = categorizeFileWrite('@AGENTS.md\n\n# Claude-specific instructions');
    expect(result.exists).toBe(true);
    expect(result.isForeign).toBe(false);
  });

  it('detects PromptForge-owned context docs', () => {
    for (const heading of [
      '# Product', '# Architecture', '# Design', '# Data Model',
      '# Integrations', '# Security', '# Testing', '# Decisions',
      '# Current State', '# Backlog',
    ]) {
      const result = categorizeFileWrite(`${heading}\n\nContent`);
      expect(result.exists).toBe(true);
      expect(result.isForeign).toBe(false);
    }
  });

  it('marks user-created files as foreign', () => {
    const result = categorizeFileWrite('// My custom config\nconst x = 1;');
    expect(result.exists).toBe(true);
    expect(result.isForeign).toBe(true);
  });

  it('marks custom markdown as foreign', () => {
    const result = categorizeFileWrite('# My Notes\n\nThese are my personal notes.');
    expect(result.exists).toBe(true);
    expect(result.isForeign).toBe(true);
  });
});

describe('PROMPTFORGE_MARKER', () => {
  it('is a non-empty string', () => {
    expect(PROMPTFORGE_MARKER).toBeTruthy();
    expect(typeof PROMPTFORGE_MARKER).toBe('string');
  });
});
