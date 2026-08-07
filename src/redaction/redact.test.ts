import { describe, it, expect } from 'vitest';
import { redactSingle, redactAll } from './redact';
import { SECRET_PATTERNS, isHighEntropy } from './patterns';
import { emptyReport, finaliseReport } from './report';

describe('SECRET_PATTERNS', () => {
  it('has at least one pattern per category in SECURITY.md §3.2', () => {
    const classes = SECRET_PATTERNS.map((p) => p.class);
    expect(classes).toContain('aws-access-key');
    expect(classes).toContain('aws-secret-key');
    expect(classes).toContain('stripe-secret-key');
    expect(classes).toContain('supabase-key');
    expect(classes).toContain('jwt');
    expect(classes).toContain('bearer-token');
    expect(classes).toContain('db-connection-string');
    expect(classes).toContain('oauth-client-secret');
    expect(classes).toContain('api-key');
    expect(classes).toContain('openai-key');
    expect(classes).toContain('private-key');
  });
});

describe('redactSingle', () => {
  it('redacts AWS access key IDs', () => {
    const { redacted, report } = redactSingle({
      source: 'test.env',
      content: 'AWS_KEY=AKIAIOSFODNN7EXAMPLE',
    });
    expect(redacted).toContain('[REDACTED:aws-access-key]');
    expect(redacted).not.toContain('AKIA');
    expect(report.totalRedacted).toBeGreaterThanOrEqual(1);
    expect(report.entries[0].class).toBe('aws-access-key');
    // Report must never contain the secret.
    expect(JSON.stringify(report)).not.toContain('AKIA');
  });

  it('also catches ASIA-prefixed keys', () => {
    const { redacted } = redactSingle({
      source: 'test',
      content: 'ASIA1234567890ABCDEF',
    });
    expect(redacted).toContain('[REDACTED:aws-access-key]');
  });

  it('redacts AWS secret key assignments (whole line)', () => {
    const { redacted, report } = redactSingle({
      source: 'test.env',
      content: 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
    expect(redacted).toContain('[REDACTED:aws-secret-key]');
    expect(redacted).not.toContain('wJalr');
    expect(report.entries[0].class).toBe('aws-secret-key');
    expect(JSON.stringify(report)).not.toContain('wJalr');
  });

  it('redacts Stripe live secret keys', () => {
    const { redacted } = redactSingle({
      source: 'config.ts',
      content: "const key = 'sk_live_1234567890abcdefghij'",
    });
    expect(redacted).toContain('[REDACTED:stripe-secret-key]');
    expect(redacted).not.toContain('sk_live_');
  });

  it('redacts Stripe test secret keys', () => {
    const { redacted } = redactSingle({
      source: 'config.ts',
      content: "const key = 'sk_test_abcdefghij1234567890'",
    });
    expect(redacted).toContain('[REDACTED:stripe-secret-key]');
  });

  it('does NOT redact Stripe publishable keys', () => {
    const { redacted, report } = redactSingle({
      source: 'config.ts',
      content: "const pk = 'pk_test_abc123'",
    });
    expect(redacted).not.toContain('REDACTED');
    expect(report.totalRedacted).toBe(0);
  });

  it('redacts JWTs', () => {
    const { redacted } = redactSingle({
      source: 'auth.ts',
      content: 'token = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456ghi789jkl',
    });
    expect(redacted).toContain('[REDACTED:jwt]');
    expect(redacted).not.toContain('eyJ');
  });

  it('redacts Bearer tokens', () => {
    const { redacted } = redactSingle({
      source: 'request.txt',
      content: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    });
    expect(redacted).toContain('[REDACTED:bearer-token]');
    expect(redacted).not.toContain('Bearer abc');
  });

  it('redacts DB connection strings', () => {
    const { redacted } = redactSingle({
      source: 'config.yaml',
      content: 'url: postgresql://admin:secret123@db.internal:5432/db',
    });
    expect(redacted).toContain('[REDACTED:db-connection-string]');
    expect(redacted).not.toContain('postgresql://');
  });

  it('redacts MySQL and Redis connection strings', () => {
    const { redacted } = redactSingle({
      source: 'config',
      content: 'mysql://user:pass@host/db\nredis://default:key@cache:6379',
    });
    expect(redacted).toContain('[REDACTED:db-connection-string]');
    expect(redacted).not.toContain('mysql://');
    expect(redacted).not.toContain('redis://');
  });

  it('redacts OAuth client secrets (whole line)', () => {
    const { redacted } = redactSingle({
      source: 'auth.env',
      content: 'client_secret=abc123def456ghi789jkl012mno345pqr',
    });
    expect(redacted).toContain('[REDACTED:oauth-client-secret]');
    expect(redacted).not.toContain('abc123');
  });

  it('redacts generic API key assignments (whole line)', () => {
    const { redacted } = redactSingle({
      source: '.env',
      content: 'api_key = "abcdefghijklmnopqrstuvwxyz123456"',
    });
    expect(redacted).toContain('[REDACTED:api-key]');
    expect(redacted).not.toContain('abcdef');
  });

  it('redacts OpenAI-style keys', () => {
    const { redacted } = redactSingle({
      source: 'config.json',
      content: '"apiKey": "sk-proj-1234567890abcdefghijklmnop"',
    });
    expect(redacted).toContain('[REDACTED:openai-key]');
    expect(redacted).not.toContain('sk-proj-');
  });

  it('redacts Supabase service role keys (whole line)', () => {
    const { redacted } = redactSingle({
      source: 'supabase.toml',
      content: 'supabase_service_role_key = "eyJhbGciOiJIUzI1NiJ9.abc.def"',
    });
    expect(redacted).toContain('[REDACTED:supabase-key]');
    expect(redacted).not.toContain('eyJhbGciOi');
  });

  it('redacts private key blocks (entire block)', () => {
    const { redacted } = redactSingle({
      source: 'key.pem',
      content: 'some text\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\nmore text',
    });
    expect(redacted).toContain('[REDACTED:private-key]');
    expect(redacted).not.toContain('BEGIN RSA');
    expect(redacted).not.toContain('MIIEp');
  });

  it('preserves non-secret content', () => {
    const { redacted } = redactSingle({
      source: 'normal.md',
      content: '# Architecture\n\nThe app uses React and TypeScript.\nRunning on port 3000.',
    });
    expect(redacted).toContain('# Architecture');
    expect(redacted).toContain('React and TypeScript');
    expect(redacted).not.toContain('REDACTED');
  });

  it('report never contains secrets', () => {
    const secret = 'sk_live_1234567890abcdefghij';
    const { report } = redactSingle({
      source: 'test',
      content: `key=${secret}`,
    });
    const json = JSON.stringify(report);
    expect(json).not.toContain('sk_live_');
    expect(json).not.toContain('1234567890abcdefghij');
    // Report should contain class and location.
    expect(report.entries[0].class).toBe('stripe-secret-key');
    expect(report.entries[0].file).toBe('test');
    expect(report.entries[0].line).toBe(1);
  });

  it('handles multiple secrets in one input', () => {
    const { redacted, report } = redactSingle({
      source: 'mixed.env',
      content: [
        'AWS_KEY=AKIAIOSFODNN7EXAMPLE',
        'stripe=sk_live_1234567890abcdefghij',
        'token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      ].join('\n'),
    });
    expect(report.totalRedacted).toBeGreaterThanOrEqual(3);
    expect(redacted).not.toContain('AKIA');
    expect(redacted).not.toContain('sk_live_');
    expect(redacted).not.toContain('eyJ');
  });
});

describe('redactAll', () => {
  it('processes multiple inputs independently', () => {
    const results = redactAll([
      { source: 'a.env', content: 'key=sk_live_1234567890abcdefghij' },
      { source: 'b.env', content: 'token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuv' },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].report.totalRedacted).toBeGreaterThanOrEqual(1);
    expect(results[1].report.totalRedacted).toBeGreaterThanOrEqual(1);
  });
});

describe('isHighEntropy', () => {
  it('flags long mixed strings', () => {
    expect(isHighEntropy('aB3dEfGhIjKlMnOpQrStUvWxYz0123456789-_+/=')).toBe(true);
  });

  it('does not flag short strings', () => {
    expect(isHighEntropy('abc123')).toBe(false);
  });

  it('does not flag low-unique strings', () => {
    expect(isHighEntropy('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('does not flag strings under minimum length', () => {
    expect(isHighEntropy('aB3dEfGhIjKlMnOpQrStUvWxYz012345678')).toBe(false); // 39 chars
  });
});

describe('entropy warnings', () => {
  it('flags high-entropy strings in redacted output', () => {
    const longToken = 'aB3dEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghij';
    expect(longToken.length).toBeGreaterThanOrEqual(40);
    const { report } = redactSingle({
      source: 'test',
      content: `normal text\n${longToken}\nmore text`,
    });
    // Should have an entropy warning for the long token.
    const entropy = report.entropyWarnings;
    expect(entropy.length).toBeGreaterThanOrEqual(1);
    expect(entropy[0].file).toBe('test');
    // Snippet should be truncated.
    expect(entropy[0].snippet.length).toBeLessThanOrEqual(61); // 30 + ... + 30 max
  });
});

describe('report integrity', () => {
  it('emptyReport has zero redacted', () => {
    const r = emptyReport();
    expect(r.totalRedacted).toBe(0);
    expect(r.entries).toEqual([]);
  });

  it('finaliseReport adds summary', () => {
    const r = emptyReport();
    r.totalRedacted = 3;
    r.entries = [
      { file: 'a', line: 1, class: 'jwt' },
      { file: 'a', line: 2, class: 'api-key' },
      { file: 'b', line: 5, class: 'aws-access-key' },
    ];
    const f = finaliseReport(r);
    expect(f.summary).toContain('3 secrets redacted');
    expect(JSON.stringify(f)).not.toContain('eyJ');
  });

  it('finaliseReport with entropy warnings includes count', () => {
    const r = emptyReport();
    r.entropyWarnings = [
      { file: 'a', line: 1, snippet: 'abc...xyz' },
      { file: 'b', line: 3, snippet: 'def...uvw' },
    ];
    const f = finaliseReport(r);
    expect(f.summary).toContain('2 high-entropy warning');
  });

  it('summary when nothing found', () => {
    const f = finaliseReport(emptyReport());
    expect(f.summary).toContain('No secrets');
  });
});
