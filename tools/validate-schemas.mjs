#!/usr/bin/env node
// Validates every fixture under schemas/fixtures/ against its schema with AJV.
// Convention: files named `valid-*.json` MUST validate; `invalid-*.json` MUST fail.
// Runs once frontend dependencies exist (Phase 1): `pnpm add -D ajv`, then `node tools/validate-schemas.mjs`.
// Phase 0 verification used the equivalent `npx ajv-cli` commands instead (see docs/PROJECT_STATE.md).

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const suites = [
  { schema: 'schemas/compiler-output.schema.json', fixtures: 'schemas/fixtures/compiler-output' },
  { schema: 'schemas/taskspec.schema.json', fixtures: 'schemas/fixtures/taskspec' },
];

let failures = 0;

for (const suite of suites) {
  const schema = JSON.parse(readFileSync(join(root, suite.schema), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  for (const file of readdirSync(join(root, suite.fixtures)).sort()) {
    if (!file.endsWith('.json')) continue;
    const expectValid = file.startsWith('valid-');
    const doc = JSON.parse(readFileSync(join(root, suite.fixtures, file), 'utf8'));
    const ok = validate(doc);
    const pass = ok === expectValid;
    if (!pass) failures++;
    console.log(
      `${pass ? 'PASS' : 'FAIL'}  ${suite.fixtures}/${file}  (expected ${expectValid ? 'valid' : 'invalid'}, got ${ok ? 'valid' : 'invalid'})`,
    );
  }
}

process.exit(failures === 0 ? 0 : 1);
