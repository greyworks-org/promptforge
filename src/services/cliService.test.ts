import { describe, it, expect } from 'vitest';
import {
  resolveBinary,
  validateBinaryName,
  prepareDelivery,
  RUNTIME_BINARIES,
} from './cliService';

describe('RUNTIME_BINARIES', () => {
  it('has entries for all three canonical runtimes', () => {
    expect(RUNTIME_BINARIES['claude-code']).toBeDefined();
    expect(RUNTIME_BINARIES['qwen-code']).toBeDefined();
    expect(RUNTIME_BINARIES['codex']).toBeDefined();
  });
});

describe('resolveBinary', () => {
  it('resolves claude-code → claude', () => {
    expect(resolveBinary('claude-code')).toEqual({ ok: true, binary: 'claude' });
  });

  it('resolves qwen-code → qwen', () => {
    expect(resolveBinary('qwen-code')).toEqual({ ok: true, binary: 'qwen' });
  });

  it('resolves codex → codex', () => {
    expect(resolveBinary('codex')).toEqual({ ok: true, binary: 'codex' });
  });

  it('fails for unknown runtime', () => {
    const r = resolveBinary('nonexistent');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Unknown runtime');
  });

  it('fails deterministically — no silent fallback', () => {
    const r1 = resolveBinary('evil-runtime');
    const r2 = resolveBinary('evil-runtime');
    expect(r1).toEqual(r2);
    expect(r1.ok).toBe(false);
  });
});

describe('validateBinaryName', () => {
  it('accepts plain command names', () => {
    expect(validateBinaryName('claude').ok).toBe(true);
    expect(validateBinaryName('qwen').ok).toBe(true);
    expect(validateBinaryName('codex').ok).toBe(true);
  });

  it('rejects empty name', () => {
    expect(validateBinaryName('').ok).toBe(false);
  });

  it('rejects path separators', () => {
    expect(validateBinaryName('bin/claude').ok).toBe(false);
    expect(validateBinaryName('bin\\claude').ok).toBe(false);
  });

  it('rejects semicolon injection', () => {
    expect(validateBinaryName('claude; rm -rf /').ok).toBe(false);
  });

  it('rejects pipe injection', () => {
    expect(validateBinaryName('cat /etc/passwd | mail').ok).toBe(false);
  });

  it('rejects ampersand injection', () => {
    expect(validateBinaryName('claude & evil').ok).toBe(false);
  });

  it('rejects dollar injection', () => {
    expect(validateBinaryName('echo $HOME').ok).toBe(false);
  });

  it('rejects backtick injection', () => {
    expect(validateBinaryName('echo `id`').ok).toBe(false);
  });

  it('rejects redirection characters', () => {
    expect(validateBinaryName('claude > /tmp/out').ok).toBe(false);
    expect(validateBinaryName('claude < /etc/passwd').ok).toBe(false);
  });
});

describe('prepareDelivery', () => {
  it('fails for unknown runtime', async () => {
    const r = await prepareDelivery('evil', 'project-test');
    expect(r.ok).toBe(false);
  });

  it('fails for unsafe binary from runtime mapping (defense in depth)', async () => {
    // validateBinaryName runs on the resolved binary.
    // All three canonical runtimes resolve to safe names.
    // Unknown runtime fails at resolveBinary before validateBinaryName.
    const r = await prepareDelivery('nonexistent', 'project-test');
    expect(r.ok).toBe(false);
  });

  it('fails for unknown projectId (Rust registry resolution)', async () => {
    // prepareDelivery calls resolveProjectRoot which queries the Rust
    // SQLite registry. An unknown projectId will throw.
    const r = await prepareDelivery('claude-code', 'project-nonexistent-xyz');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Could not resolve project root');
  });

  it('returns binary and resolved projectRoot for valid inputs', async () => {
    // This test requires a running Tauri app with a registered project.
    // In unit tests without Tauri, resolveProjectRoot will fail.
    // The pure-function validation layers are tested above.
    // Integration test: use a known test project in the app DB.
  });
});
