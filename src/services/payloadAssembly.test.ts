import { describe, it, expect } from 'vitest';
import { assemblePayload } from './payloadAssembly';

const cleanDoc = {
  relPath: '.promptforge/context/PRODUCT.md',
  content: '# Product\nThis is a test product.',
};

const secretDoc = {
  relPath: '.promptforge/context/CONFIG.md',
  content: 'API_KEY=sk_live_1234567890abcdefghij\nnormal text',
};

const blockedDoc = {
  relPath: '.env',
  content: 'SECRET=value',
};

const blockedNestedDoc = {
  relPath: 'node_modules/evil/config.js',
  content: 'hacked',
};

describe('assemblePayload', () => {
  it('assembles clean content without redactions', () => {
    const result = assemblePayload({
      rawRequest: 'Add a login page',
      contextDocs: [cleanDoc],
    });
    expect(result.hasContent).toBe(true);
    expect(result.text).toContain('Add a login page');
    expect(result.text).toContain('# Product');
    expect(result.report.totalRedacted).toBe(0);
    expect(result.blockedFiles).toHaveLength(0);
  });

  it('redacts secrets in context docs', () => {
    const result = assemblePayload({
      rawRequest: 'Fix auth',
      contextDocs: [cleanDoc, secretDoc],
    });
    expect(result.report.totalRedacted).toBeGreaterThanOrEqual(1);
    expect(result.text).not.toContain('sk_live_');
    expect(result.text).toContain('[REDACTED:');
    expect(result.text).toContain('normal text');
  });

  it('redacts secrets in raw request', () => {
    const result = assemblePayload({
      rawRequest: 'My key is sk_live_1234567890abcdefghij — fix login',
      contextDocs: [cleanDoc],
    });
    expect(result.report.totalRedacted).toBeGreaterThanOrEqual(1);
    expect(result.text).not.toContain('sk_live_');
    expect(result.text).toContain('fix login');
  });

  it('blocks .env files from payload', () => {
    const result = assemblePayload({
      rawRequest: 'Test',
      contextDocs: [cleanDoc, blockedDoc],
    });
    expect(result.blockedFiles).toContain('.env');
    expect(result.text).not.toContain('SECRET=value');
    expect(result.text).toContain('# Product');
  });

  it('blocks node_modules files from payload', () => {
    const result = assemblePayload({
      rawRequest: 'Test',
      contextDocs: [blockedNestedDoc],
    });
    expect(result.blockedFiles).toContain('node_modules/evil/config.js');
    expect(result.hasContent).toBe(true); // raw request still present
  });

  it('blocks secret file patterns', () => {
    const result = assemblePayload({
      rawRequest: 'Test',
      contextDocs: [
        { relPath: 'server.key', content: 'PRIVATE KEY DATA' },
        { relPath: 'cert.pem', content: 'CERT DATA' },
        { relPath: 'credentials.json', content: '{"password":"x"}' },
        { relPath: 'secrets.yml', content: 'key: value' },
      ],
    });
    expect(result.blockedFiles).toContain('server.key');
    expect(result.blockedFiles).toContain('cert.pem');
    expect(result.blockedFiles).toContain('credentials.json');
    expect(result.blockedFiles).toContain('secrets.yml');
    expect(result.text).toContain('Test');
  });

  it('hasContent is false when everything is blocked', () => {
    const result = assemblePayload({
      rawRequest: '',
      contextDocs: [blockedDoc],
    });
    expect(result.hasContent).toBe(false);
    expect(result.text.trim()).toBe('');
  });

  it('includes attachment descriptions that are clean', () => {
    const result = assemblePayload({
      rawRequest: 'Check this design',
      contextDocs: [],
      attachments: [{ relPath: 'mockup.png', description: 'Dashboard mockup with sidebar' }],
    });
    expect(result.text).toContain('Dashboard mockup');
    expect(result.blockedFiles).toHaveLength(0);
  });

  it('blocks attachment descriptions from blocked paths', () => {
    const result = assemblePayload({
      rawRequest: 'Test',
      contextDocs: [],
      attachments: [{ relPath: '.env', description: 'secret stuff' }],
    });
    expect(result.blockedFiles).toContain('.env');
    expect(result.text).not.toContain('secret stuff');
  });

  it('report never contains secrets', () => {
    const result = assemblePayload({
      rawRequest: 'api_key = "abcdefghijklmnopqrstuvwxyz123456"',
      contextDocs: [secretDoc],
    });
    const json = JSON.stringify(result.report);
    expect(json).not.toContain('sk_live_');
    expect(json).not.toContain('abcdefghijklmnopqrstuvwxyz');
    // Entries should have classes and locations.
    for (const e of result.report.entries) {
      expect(e.class).toBeTruthy();
      expect(e.file).toBeTruthy();
      expect(e.line).toBeGreaterThan(0);
    }
  });

  it('detects entropy warnings without blocking', () => {
    const longToken = 'aB3dEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghij==';
    const result = assemblePayload({
      rawRequest: `Here is a token: ${longToken}`,
      contextDocs: [],
    });
    // Token should still be in payload (flagged, not blocked).
    expect(result.text).toContain(longToken);
    // Should have an entropy warning.
    expect(result.report.entropyWarnings.length).toBeGreaterThanOrEqual(1);
  });

  it('estimates tokens for assembled payload', () => {
    const result = assemblePayload({
      rawRequest: 'Fix the login page',
      contextDocs: [cleanDoc],
    });
    expect(result.estTokens).toBeGreaterThan(0);
  });
});
