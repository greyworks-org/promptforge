import { describe, expect, it } from 'vitest';
import { normalizeProjectContextPath } from './projectContextService';

describe('project context path boundary', () => {
  it('normalizes a safe relative path', () => {
    expect(normalizeProjectContextPath('./docs/offerpath-v2/../offerpath-v2/source.md')).toBe('docs/offerpath-v2/source.md');
  });

  it('rejects absolute and escaping paths', () => {
    expect(() => normalizeProjectContextPath('/tmp/source.md')).toThrow('relative');
    expect(() => normalizeProjectContextPath('../../source.md')).toThrow('inside the project');
  });
});
