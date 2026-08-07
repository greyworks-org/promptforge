import { describe, it, expect } from 'vitest';
import {
  suggestDocs,
  suggestExistingDocs,
  ALL_CONTEXT_DOCS,
  type TaskType,
} from './contextSelector';

describe('suggestDocs', () => {
  it('includes CURRENT_STATE.md for every task type', () => {
    const types: TaskType[] = [
      'planning', 'feature', 'ui', 'backend', 'database',
      'integration', 'bugfix', 'refactor', 'review',
      'security', 'testing', 'deployment',
    ];
    for (const t of types) {
      const docs = suggestDocs(t);
      expect(docs).toContain('CURRENT_STATE.md');
    }
  });

  it('design task suggests PRODUCT, DESIGN, CURRENT_STATE', () => {
    const docs = suggestDocs('ui');
    expect(docs).toContain('PRODUCT.md');
    expect(docs).toContain('DESIGN.md');
    expect(docs).toContain('CURRENT_STATE.md');
  });

  it('integration bugfix suggests INTEGRATIONS, DATA_MODEL, SECURITY, CURRENT_STATE', () => {
    const docs = suggestDocs('integration');
    expect(docs).toContain('INTEGRATIONS.md');
    expect(docs).toContain('DATA_MODEL.md');
    expect(docs).toContain('SECURITY.md');
    expect(docs).toContain('CURRENT_STATE.md');
  });

  it('is deterministic — same input, same output', () => {
    const a = suggestDocs('feature');
    const b = suggestDocs('feature');
    expect(a).toEqual(b);
  });

  it('returns CURRENT_STATE only for unknown task type', () => {
    const docs = suggestDocs('nonexistent' as TaskType);
    expect(docs).toEqual(['CURRENT_STATE.md']);
  });
});

describe('suggestExistingDocs', () => {
  it('filters to only registered filenames', () => {
    const registered = ['CURRENT_STATE.md', 'PRODUCT.md'];
    const docs = suggestExistingDocs('ui', registered);
    expect(docs).toContain('PRODUCT.md');
    expect(docs).toContain('CURRENT_STATE.md');
    expect(docs).not.toContain('DESIGN.md');
  });

  it('returns empty when nothing matches', () => {
    const docs = suggestExistingDocs('ui', ['BACKLOG.md']);
    expect(docs).toEqual([]);
  });
});

describe('ALL_CONTEXT_DOCS', () => {
  it('has exactly 10 canonical docs', () => {
    expect(ALL_CONTEXT_DOCS).toHaveLength(10);
  });

  it('includes all expected filenames', () => {
    expect(ALL_CONTEXT_DOCS).toContain('PRODUCT.md');
    expect(ALL_CONTEXT_DOCS).toContain('DATA_MODEL.md');
    expect(ALL_CONTEXT_DOCS).toContain('CURRENT_STATE.md');
    expect(ALL_CONTEXT_DOCS).toContain('BACKLOG.md');
  });
});
