/**
 * Regression test for the Phase 2 startup failure: the Projects screen
 * rendered "The project library could not be opened." because
 * tauri-plugin-sql's `sql:default` permission set only grants
 * allow-close, allow-load and allow-select — NOT allow-execute. Every
 * migration `execute` call was rejected by the ACL after `load` had created
 * the database file, leaving an empty DB. If this effective permission set
 * ever loses a command again, the app DB cannot be initialized.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CAPABILITY_PATH = resolve(__dirname, '../../src-tauri/capabilities/default.json');

/** Constituents of `sql:default` in tauri-plugin-sql (permissions/default.toml). */
const SQL_DEFAULT_SET = ['sql:allow-close', 'sql:allow-load', 'sql:allow-select'];

const REQUIRED_SQL_COMMANDS = [
  'sql:allow-load',
  'sql:allow-select',
  'sql:allow-execute',
  'sql:allow-close',
];

function effectiveSqlPermissions(): string[] {
  const capability = JSON.parse(readFileSync(CAPABILITY_PATH, 'utf8')) as {
    permissions: string[];
  };
  const granted = new Set<string>();
  for (const permission of capability.permissions) {
    if (permission === 'sql:default') {
      for (const p of SQL_DEFAULT_SET) granted.add(p);
    } else if (permission.startsWith('sql:')) {
      granted.add(permission);
    }
  }
  return [...granted];
}

describe('main-window capability: sql plugin', () => {
  it('grants every command the app DB layer needs (load, select, execute, close)', () => {
    const effective = effectiveSqlPermissions();
    for (const command of REQUIRED_SQL_COMMANDS) {
      expect(effective, `missing ${command} — app DB initialization would fail at runtime`).toContain(
        command,
      );
    }
  });

  it('targets the main window', () => {
    const capability = JSON.parse(readFileSync(CAPABILITY_PATH, 'utf8')) as { windows: string[] };
    expect(capability.windows).toContain('main');
  });
});
