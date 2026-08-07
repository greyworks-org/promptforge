import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactSingle } from '../../src/redaction/redact';

/**
 * Secret corpus integration test (Phase 5).
 * Every fixture file in tests/fixtures/secrets/ must produce ≥ 1
 * redaction when processed.  This gates the 100%-detection requirement.
 */

const FIXTURE_DIR = join(import.meta.dirname, '..', 'fixtures', 'secrets');

const SECRET_FILES = [
  'aws-keys.env',
  'stripe-config.ts',
  'jwt-tokens.txt',
  'db-connection.yaml',
  'openai-config.json',
  'supabase.toml',
  'private-key-block.txt',
];

describe('secret corpus — 100% detection', () => {
  for (const filename of SECRET_FILES) {
    it(`detects secrets in ${filename}`, () => {
      const content = readFileSync(join(FIXTURE_DIR, filename), 'utf-8');
      const { redacted, report } = redactSingle({
        source: filename,
        content,
      });

      // Every fixture file must produce at least one redaction.
      expect(
        report.totalRedacted,
        `${filename}: expected ≥1 redaction, got ${report.totalRedacted}`,
      ).toBeGreaterThanOrEqual(1);

      // Redacted output must not contain the original secret patterns.
      // Generic check: no raw AWS keys, Stripe keys, or JWTs in output.
      expect(redacted).not.toMatch(/\bAKIA[0-9A-Z]{16}\b/);
      expect(redacted).not.toMatch(/\bsk_live_[0-9A-Za-z]{10,}\b/);
      expect(redacted).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/);

      // Report must not leak secrets.
      const json = JSON.stringify(report);
      expect(json).not.toMatch(/\bAKIA[0-9A-Z]{16}\b/);
      expect(json).not.toMatch(/\bsk_live_[0-9A-Za-z]{10,}\b/);
    });
  }
});

describe('clean content — no false positives', () => {
  it('does not redact normal markdown', () => {
    const content = [
      '# Architecture',
      '',
      'The app uses React, TypeScript, and SQLite.',
      'Configuration is in .env files (not committed).',
      'API endpoints: https://api.example.com/v1',
      '',
      '## Testing',
      'Run `pnpm test` to execute the suite.',
    ].join('\n');

    const { report } = redactSingle({ source: 'ARCHITECTURE.md', content });
    expect(report.totalRedacted).toBe(0);
  });

  it('does not redact publishable keys', () => {
    const content = "publishableKey: 'pk_test_abc123xyz'";
    const { report } = redactSingle({ source: 'config.ts', content });
    expect(report.totalRedacted).toBe(0);
  });

  it('does not redact short sk- prefixed strings', () => {
    const content = "model: 'sk-small'";
    const { report } = redactSingle({ source: 'config', content });
    expect(report.totalRedacted).toBe(0);
  });
});
