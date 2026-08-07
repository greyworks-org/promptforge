import { describe, it, expect } from 'vitest';
import { allTemplates, agentsMdTemplate, qwenMdTemplate, claudeMdTemplate } from '../templates/instructions';
import { allContextDocTemplates, productDoc, backlogDoc } from '../templates/contextDocs';

describe('instruction templates', () => {
  it('agentsMdTemplate includes project name', () => {
    const t = agentsMdTemplate('My App');
    expect(t).toContain('AGENTS.md — My App');
    expect(t).toContain('Architecture rules');
    expect(t).toContain('Hard security rules');
    expect(t).toContain('Test & validation commands');
  });

  it('qwenMdTemplate includes project name', () => {
    const t = qwenMdTemplate('My App');
    expect(t).toContain('Qwen-specific instructions');
    expect(t).toContain('My App');
  });

  it('claudeMdTemplate references AGENTS.md and includes project name', () => {
    const t = claudeMdTemplate('My App');
    expect(t).toContain('@AGENTS.md');
    expect(t).toContain('Claude-specific instructions');
    expect(t).toContain('My App');
  });

  it('allTemplates returns all three files', () => {
    const templates = allTemplates('test');
    expect(templates).toHaveLength(3);
    expect(templates.map((t) => t.filename).sort()).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      'QWEN.md',
    ]);
  });
});

describe('context doc templates', () => {
  it('allContextDocTemplates returns exactly 10 docs', () => {
    const docs = allContextDocTemplates();
    expect(docs).toHaveLength(10);
  });

  it('each template has filename, title and content', () => {
    for (const doc of allContextDocTemplates()) {
      expect(doc.filename).toBeTruthy();
      expect(doc.title).toBeTruthy();
      expect(doc.content).toBeTruthy();
      expect(doc.content.length).toBeGreaterThan(50);
    }
  });

  it('filenames match the canonical set', () => {
    const filenames = allContextDocTemplates().map((d) => d.filename);
    expect(filenames).toEqual([
      'PRODUCT.md',
      'ARCHITECTURE.md',
      'DESIGN.md',
      'DATA_MODEL.md',
      'INTEGRATIONS.md',
      'SECURITY.md',
      'TESTING.md',
      'DECISIONS.md',
      'CURRENT_STATE.md',
      'BACKLOG.md',
    ]);
  });

  it('productDoc has the right structure', () => {
    const doc = productDoc();
    expect(doc.filename).toBe('PRODUCT.md');
    expect(doc.content).toContain('Purpose');
    expect(doc.content).toContain('Value proposition');
    expect(doc.content).toContain('Target users');
  });

  it('backlogDoc has the right structure', () => {
    const doc = backlogDoc();
    expect(doc.filename).toBe('BACKLOG.md');
    expect(doc.content).toContain('Current milestone');
    expect(doc.content).toContain('Planned tasks');
  });
});
