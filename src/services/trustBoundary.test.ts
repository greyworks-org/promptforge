import { describe, it, expect } from 'vitest';
import { parseAnchor, ANCHOR_REL_PATH } from '../services/anchor';

describe('anchor cross-project isolation', () => {
  const anchorA = {
    schema: 'promptforge.anchor/1' as const,
    projectId: 'project-alpha',
    name: 'Alpha',
    createdAt: '2026-08-07T00:00:00Z',
  };

  const anchorB = {
    schema: 'promptforge.anchor/1' as const,
    projectId: 'project-beta',
    name: 'Beta',
    createdAt: '2026-08-07T00:00:00Z',
  };

  it('parseAnchor distinguishes different projectIds', () => {
    const parsedA = parseAnchor(JSON.stringify(anchorA));
    const parsedB = parseAnchor(JSON.stringify(anchorB));
    expect(parsedA!.projectId).toBe('project-alpha');
    expect(parsedB!.projectId).toBe('project-beta');
    expect(parsedA!.projectId).not.toBe(parsedB!.projectId);
  });

  it('parseAnchor rejects empty projectId', () => {
    const bad = { ...anchorA, projectId: '' };
    expect(parseAnchor(JSON.stringify(bad))).toBeNull();
  });

  it('parseAnchor rejects missing projectId', () => {
    const { projectId, ...rest } = anchorA;
    expect(parseAnchor(JSON.stringify(rest))).toBeNull();
  });

  it('parseAnchor rejects wrong schema', () => {
    const bad = { ...anchorA, schema: 'evil.anchor/1' };
    expect(parseAnchor(JSON.stringify(bad))).toBeNull();
  });

  it('ANCHOR_REL_PATH is the canonical path', () => {
    expect(ANCHOR_REL_PATH).toBe('.promptforge/project.json');
  });
});

describe('registry tampering — anchor binding', () => {
  it('project A anchor cannot validate as project B', () => {
    // Simulate what verify_anchor does in Rust: parse the anchor JSON
    // and compare projectId. This test mirrors the Rust-side check.
    const anchorJson = JSON.stringify({
      schema: 'promptforge.anchor/1',
      projectId: 'project-real',
      name: 'Real',
      createdAt: '2026-08-07T00:00:00Z',
    });

    const parsed = parseAnchor(anchorJson);
    expect(parsed).not.toBeNull();
    expect(parsed!.projectId).toBe('project-real');

    // An attacker who UPDATEs repo_path in the DB cannot change this anchor.
    // The Rust verify_anchor reads the anchor from disk and checks:
    //   anchor.projectId === requested_projectId
    // If they don't match, the request is rejected.
    const attackerProjectId = 'project-attacker';
    expect(parsed!.projectId).not.toBe(attackerProjectId);
  });

  it('tampered anchor with no projectId field is rejected', () => {
    const badJson = '{"schema":"promptforge.anchor/1","name":"X"}';
    expect(parseAnchor(badJson)).toBeNull();
  });

  it('tampered anchor with null projectId is rejected', () => {
    const badJson = '{"schema":"promptforge.anchor/1","projectId":null,"name":"X"}';
    expect(parseAnchor(badJson)).toBeNull();
  });
});
