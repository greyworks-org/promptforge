import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compilerOutputSchema } from './compilerOutput';

/**
 * Zod fixture suite: every compiler-output fixture must behave identically
 * to the JSON Schema.  Valid fixtures must parse; invalid fixtures must fail.
 */

const FIXTURE_DIR = join(import.meta.dirname, '..', '..', 'schemas', 'fixtures', 'compiler-output');

function loadFixture(name: string): unknown {
  const raw = readFileSync(join(FIXTURE_DIR, name), 'utf-8');
  return JSON.parse(raw);
}

describe('compilerOutputSchema — valid fixtures', () => {
  it('accepts valid-full.json', () => {
    const data = loadFixture('valid-full.json');
    const result = compilerOutputSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('accepts valid-minimal.json', () => {
    const data = loadFixture('valid-minimal.json');
    const result = compilerOutputSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe('compilerOutputSchema — invalid fixtures', () => {
  it('rejects invalid-bad-enum.json (bad risk_level)', () => {
    const data = loadFixture('invalid-bad-enum.json');
    const result = compilerOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects invalid-client-owned-id.json (task_id present)', () => {
    const data = loadFixture('invalid-client-owned-id.json');
    const result = compilerOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects invalid-empty-acceptance.json (empty acceptance_criteria)', () => {
    const data = loadFixture('invalid-empty-acceptance.json');
    const result = compilerOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects invalid-missing-objective.json (missing objective)', () => {
    const data = loadFixture('invalid-missing-objective.json');
    const result = compilerOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects invalid-too-many-blocking-questions.json (4 questions)', () => {
    const data = loadFixture('invalid-too-many-blocking-questions.json');
    const result = compilerOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects invalid-unknown-field.json (unknown field "notes")', () => {
    const data = loadFixture('invalid-unknown-field.json');
    const result = compilerOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});
