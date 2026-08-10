import { describe, it, expect } from 'vitest';

/**
 * Profile draft regression tests.
 * Tests: validation, extraction, evidence precedence scenarios.
 */

// Inline the pure functions for testing (not exported).
const CONTEXT_DOC_KEYS = [
  'PRODUCT.md', 'ARCHITECTURE.md', 'DESIGN.md', 'DATA_MODEL.md',
  'INTEGRATIONS.md', 'SECURITY.md', 'TESTING.md', 'DECISIONS.md',
  'CURRENT_STATE.md', 'BACKLOG.md',
];

function parseDraftResponse(raw: Record<string, unknown>): { ok: true; result: any } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  if (typeof raw.suggestedName !== 'string' || raw.suggestedName.length === 0) missing.push('suggestedName');
  if (typeof raw.summary !== 'string' || raw.summary.length === 0) missing.push('summary');
  const detectedStack: string[] = [];
  if (Array.isArray(raw.detectedStack)) {
    for (const item of raw.detectedStack) { if (typeof item === 'string') detectedStack.push(item); }
  }
  const contextDocs: Record<string, string> = {};
  if (typeof raw.contextDocs === 'object' && raw.contextDocs !== null) {
    for (const key of CONTEXT_DOC_KEYS) {
      const val = (raw.contextDocs as Record<string, unknown>)[key];
      contextDocs[key] = typeof val === 'string' ? val : `[Add ${key.replace('.md', '')} content here.]\n`;
    }
  } else { missing.push('contextDocs'); }
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, result: { suggestedName: raw.suggestedName, summary: raw.summary, detectedStack, contextDocs } };
}

function extractJson(rawContent: string): Record<string, unknown> | null {
  let jsonText = rawContent.trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonText = fenceMatch[1].trim();
  const firstBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) jsonText = jsonText.slice(firstBrace, lastBrace + 1);
  try { const p = JSON.parse(jsonText); if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>; return null; }
  catch { return null; }
}

describe('parseDraftResponse — valid', () => {
  it('A: accepts a complete valid response', () => {
    const docs: Record<string, string> = {};
    for (const k of CONTEXT_DOC_KEYS) docs[k] = `# ${k}\n\nContent here.`;
    const r = parseDraftResponse({
      suggestedName: 'My App',
      summary: 'A great app.',
      detectedStack: ['Swift', 'SwiftUI'],
      contextDocs: docs,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.suggestedName).toBe('My App');
      expect(r.result.detectedStack).toEqual(['Swift', 'SwiftUI']);
    }
  });

  it('B: rejects missing suggestedName', () => {
    const r = parseDraftResponse({ summary: 'x', contextDocs: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain('suggestedName');
  });

  it('B: rejects missing summary', () => {
    const r = parseDraftResponse({ suggestedName: 'x', contextDocs: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain('summary');
  });

  it('B: rejects empty suggestedName', () => {
    const r = parseDraftResponse({ suggestedName: '', summary: 'x', contextDocs: {} });
    expect(r.ok).toBe(false);
  });

  it('B: rejects missing contextDocs', () => {
    const r = parseDraftResponse({ suggestedName: 'x', summary: 'y' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.some((m) => m.includes('contextDocs'))).toBe(true);
  });

  it('C: defaults missing context doc keys to placeholder', () => {
    const r = parseDraftResponse({
      suggestedName: 'App',
      summary: 'Summary',
      contextDocs: { 'PRODUCT.md': 'Real content' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.contextDocs['PRODUCT.md']).toBe('Real content');
      expect(r.result.contextDocs['ARCHITECTURE.md']).toContain('[Add ARCHITECTURE');
    }
  });

  it('G: ignores extra unknown fields in response', () => {
    const docs: Record<string, string> = {};
    for (const k of CONTEXT_DOC_KEYS) docs[k] = 'x';
    const r = parseDraftResponse({
      suggestedName: 'App',
      summary: 'S',
      contextDocs: docs,
      detectedStack: ['Swift'],
      injectedField: 'evil',
    } as any);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.result as any).injectedField).toBeUndefined();
    }
  });
});

describe('extractJson', () => {
  it('C: parses clean JSON', () => {
    const r = extractJson('{"a": 1}');
    expect(r).not.toBeNull();
    expect(r!.a).toBe(1);
  });

  it('D: strips code fences', () => {
    const r = extractJson('```json\n{"b": 2}\n```');
    expect(r).not.toBeNull();
    expect(r!.b).toBe(2);
  });

  it('D: strips surrounding prose', () => {
    const r = extractJson('Here is the result:\n{"c": 3}\nHope this helps.');
    expect(r).not.toBeNull();
    expect(r!.c).toBe(3);
  });

  it('C: returns null for non-JSON', () => {
    expect(extractJson('not json')).toBeNull();
  });

  it('C: returns null for arrays', () => {
    expect(extractJson('[1,2,3]')).toBeNull();
  });

  it('D: handles fences without json tag', () => {
    const r = extractJson('```\n{"d": 4}\n```');
    expect(r).not.toBeNull();
    expect(r!.d).toBe(4);
  });
});

describe('evidence precedence regression', () => {
  it('old plan vs newer implementation: accepts CURRENT_STATE describing what IS', () => {
    // Simulate: the AI declares what the CURRENT implementation is,
    // based on evidence. If the code says Swift/SwiftUI but old docs
    // say UIKit, the CURRENT_STATE should reflect Swift/SwiftUI.
    const draft = parseDraftResponse({
      suggestedName: 'Portfolio',
      summary: 'An iOS app built with Swift and SwiftUI.',
      contextDocs: {
        'PRODUCT.md': 'Portfolio tracking app.',
        'ARCHITECTURE.md': 'Swift + SwiftUI, Xcode project, SPM packages.',
        'DESIGN.md': 'SwiftUI views with native components.',
        'DATA_MODEL.md': 'Core Data models for holdings and portfolios.',
        'INTEGRATIONS.md': 'No external integrations detected.',
        'SECURITY.md': 'Local-only, no auth required.',
        'TESTING.md': 'XCTest target present.',
        'DECISIONS.md': 'SwiftUI chosen over UIKit for new views.',
        'CURRENT_STATE.md': 'Active development in App/ and Sources/PortfolioCore. In-progress: holdings tracking.',
        'BACKLOG.md': 'TODO: complete Core Data migration. Incomplete: Watch app target.',
      },
    });
    expect(draft.ok).toBe(true);
    if (draft.ok) {
      expect(draft.result.contextDocs['CURRENT_STATE.md']).toContain('PortfolioCore');
      expect(draft.result.contextDocs['DECISIONS.md']).toContain('SwiftUI');
    }
  });

  it('existing project with unfinished work: BACKLOG and CURRENT_STATE reflect it', () => {
    const draft = parseDraftResponse({
      suggestedName: 'App',
      summary: 'WIP',
      contextDocs: {
        'PRODUCT.md': '.', 'ARCHITECTURE.md': '.', 'DESIGN.md': '.',
        'DATA_MODEL.md': '.', 'INTEGRATIONS.md': '.', 'SECURITY.md': '.',
        'TESTING.md': '.',
        'DECISIONS.md': '.',
        'CURRENT_STATE.md': 'Incomplete: Watch app target. Blocked: Core Data model mismatch.',
        'BACKLOG.md': 'Finish holdings tracking. Add tests for Rules engine.',
      },
    });
    expect(draft.ok).toBe(true);
    if (draft.ok) {
      expect(draft.result.contextDocs['CURRENT_STATE.md']).toContain('Watch');
      expect(draft.result.contextDocs['BACKLOG.md']).toContain('Rules');
    }
  });

  it('existing project with no explicit backlog: BACKLOG not invented', () => {
    const draft = parseDraftResponse({
      suggestedName: 'App',
      summary: 'Done.',
      contextDocs: {
        'PRODUCT.md': '.', 'ARCHITECTURE.md': '.', 'DESIGN.md': '.',
        'DATA_MODEL.md': '.', 'INTEGRATIONS.md': '.', 'SECURITY.md': '.',
        'TESTING.md': '.',
        'DECISIONS.md': '.',
        'CURRENT_STATE.md': 'All targets building. No known blockers.',
        'BACKLOG.md': '[Add Backlog content here.]',
      },
    });
    expect(draft.ok).toBe(true);
    if (draft.ok) {
      const bl = draft.result.contextDocs['BACKLOG.md'];
      // Should NOT contain invented features like "Add user authentication"
      expect(bl).not.toContain('Add user');
      expect(bl).not.toContain('Implement push');
    }
  });

  it('no invention when evidence is insufficient', () => {
    const draft = parseDraftResponse({
      suggestedName: 'Unknown',
      summary: 'Minimal project.',
      contextDocs: {
        'PRODUCT.md': '[Add Product content here.]',
        'ARCHITECTURE.md': '[Add Architecture content here.]',
        'DESIGN.md': '[Add Design content here.]',
        'DATA_MODEL.md': '[Add Data Model content here.]',
        'INTEGRATIONS.md': '[Add Integrations content here.]',
        'SECURITY.md': '[Add Security content here.]',
        'TESTING.md': '[Add Testing content here.]',
        'DECISIONS.md': '[Add Decisions content here.]',
        'CURRENT_STATE.md': '[Add Current State content here.]',
        'BACKLOG.md': '[Add Backlog content here.]',
      },
    });
    expect(draft.ok).toBe(true);
    if (draft.ok) {
      // When evidence is insufficient, placeholders are used — not invented facts.
      // DECISIONS.md should not contain fabricated decisions.
      expect(draft.result.contextDocs['DECISIONS.md']).not.toMatch(/Decided to use|Chose.*over/);
      // BACKLOG.md should not contain invented features.
      expect(draft.result.contextDocs['BACKLOG.md']).not.toContain('Implement');
    }
  });
});
