import { describe, it, expect } from 'vitest';
import {
  classifyAction,
  verifyScope,
  authorizeOperation,
  FIGMA_WORKSPACE,
} from './figmaAuth';

describe('classifyAction', () => {
  it('auto-runs known non-chargeable reads', () => {
    expect(classifyAction('read-file-metadata')).toEqual({ allowed: true, requiresApproval: false });
    expect(classifyAction('read-file-content')).toEqual({ allowed: true, requiresApproval: false });
    expect(classifyAction('read-comments')).toEqual({ allowed: true, requiresApproval: false });
  });

  it('approval-gates sensitive mutations', () => {
    expect(classifyAction('create-file')).toEqual({ allowed: true, requiresApproval: true });
    expect(classifyAction('update-file-content')).toEqual({ allowed: true, requiresApproval: true });
    expect(classifyAction('add-comment')).toEqual({ allowed: true, requiresApproval: true });
  });

  it('blocks AI/credit operations', () => {
    expect(classifyAction('figma-make').allowed).toBe(false);
    expect(classifyAction('ai-generation').allowed).toBe(false);
    expect(classifyAction('ai-image-generation').allowed).toBe(false);
  });

  it('blocks billing/permission operations', () => {
    expect(classifyAction('purchase-credits').allowed).toBe(false);
    expect(classifyAction('change-billing').allowed).toBe(false);
    expect(classifyAction('share-file').allowed).toBe(false);
  });

  it('blocks destructive operations', () => {
    expect(classifyAction('delete-file').allowed).toBe(false);
    expect(classifyAction('delete-folder').allowed).toBe(false);
    expect(classifyAction('move-file').allowed).toBe(false);
  });

  it('blocks unclassified actions (fail closed)', () => {
    const r = classifyAction('some-unknown-figma-feature');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toContain('unclassified');
  });
});

describe('verifyScope', () => {
  it('accepts when team_id and folder_id match', () => {
    const r = verifyScope('1156142985904303378', '636134446');
    expect(r.inScope).toBe(true);
  });

  it('rejects mismatched team_id', () => {
    const r = verifyScope('9999999999999999999', '636134446');
    expect(r.inScope).toBe(false);
    if (!r.inScope) expect(r.reason).toContain('team');
  });

  it('rejects mismatched folder_id', () => {
    const r = verifyScope('1156142985904303378', '999999999');
    expect(r.inScope).toBe(false);
    if (!r.inScope) expect(r.reason).toContain('folder');
  });

  it('rejects null metadata', () => {
    expect(verifyScope(null, '636134446').inScope).toBe(false);
    expect(verifyScope('1156142985904303378', null).inScope).toBe(false);
    expect(verifyScope(null, null).inScope).toBe(false);
  });
});

describe('authorizeOperation', () => {
  it('allows auto-run in-scope action', () => {
    const r = authorizeOperation('read-file-metadata', '1156142985904303378', '636134446', false);
    expect(r.allowed).toBe(true);
  });

  it('blocks approval-gated action without user approval', () => {
    const r = authorizeOperation('create-file', '1156142985904303378', '636134446', false);
    expect(r.allowed).toBe(false);
    expect(r.requiresApproval).toBe(true);
  });

  it('allows approval-gated action with user approval', () => {
    const r = authorizeOperation('create-file', '1156142985904303378', '636134446', true);
    expect(r.allowed).toBe(true);
  });

  it('blocks out-of-scope action even with approval', () => {
    const r = authorizeOperation('read-file-metadata', '9999999999999999999', '636134446', true);
    expect(r.allowed).toBe(false);
  });

  it('blocks AI action even with approval (hard boundary)', () => {
    const r = authorizeOperation('figma-make', '1156142985904303378', '636134446', true);
    expect(r.allowed).toBe(false);
  });

  it('blocks unclassified action even with approval', () => {
    const r = authorizeOperation('unknown-op', '1156142985904303378', '636134446', true);
    expect(r.allowed).toBe(false);
  });
});

describe('FIGMA_WORKSPACE', () => {
  it('has the configured team_id and folder_id', () => {
    expect(FIGMA_WORKSPACE.security.teamId).toBe('1156142985904303378');
    expect(FIGMA_WORKSPACE.security.folderId).toBe('636134446');
  });

  it('has the correct workspace ID', () => {
    expect(FIGMA_WORKSPACE.workspaceId).toBe('figma-wask-default');
    expect(FIGMA_WORKSPACE.provider).toBe('figma');
  });
});
