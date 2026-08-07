import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { taskSpecSchema } from './taskspec';

const FIXTURE_DIR = join(import.meta.dirname, '..', '..', 'schemas', 'fixtures', 'taskspec');

function loadFixture(name: string): unknown {
  const raw = readFileSync(join(FIXTURE_DIR, name), 'utf-8');
  return JSON.parse(raw);
}

describe('taskSpecSchema — valid fixtures', () => {
  it('accepts valid-full.json', () => {
    const data = loadFixture('valid-full.json');
    const result = taskSpecSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('accepts valid-minimal.json', () => {
    const data = loadFixture('valid-minimal.json');
    const result = taskSpecSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe('taskSpecSchema — invalid fixtures', () => {
  it('rejects invalid-bad-task-id-format.json', () => {
    const data = loadFixture('invalid-bad-task-id-format.json');
    const result = taskSpecSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects invalid-missing-project-id.json', () => {
    const data = loadFixture('invalid-missing-project-id.json');
    const result = taskSpecSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects invalid-missing-schema-version.json', () => {
    const data = loadFixture('invalid-missing-schema-version.json');
    const result = taskSpecSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects invalid-missing-task-id.json', () => {
    const data = loadFixture('invalid-missing-task-id.json');
    const result = taskSpecSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects invalid-unknown-field.json', () => {
    const data = loadFixture('invalid-unknown-field.json');
    const result = taskSpecSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});
