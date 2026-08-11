import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBetterSqliteRunner } from './betterSqliteRunner';
import { MIGRATIONS, runMigrations, splitSqlStatements } from './migrate';
import type { QueryRunner } from './runner';

let sqlite: BetterSqlite3.Database;
let runner: QueryRunner;

beforeEach(() => {
  sqlite = new BetterSqlite3(':memory:');
  runner = createBetterSqliteRunner(sqlite);
});

afterEach(() => {
  sqlite.close();
});

function tableExists(name: string): boolean {
  return (
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  );
}

describe('runMigrations', () => {
  it('applies all migrations on a clean database', async () => {
    const report = await runMigrations(runner);
    expect(report.applied).toEqual([1, 3, 4, 5, 6, 7, 8]);
    expect(report.currentVersion).toBe(8);
    for (const table of ['projects', 'context_docs', 'compilations', 'task_outcomes', 'settings', 'execution_sessions', 'session_events', 'execution_handoffs']) {
      expect(tableExists(table), `table ${table} should exist`).toBe(true);
    }
    const rows = sqlite.prepare('SELECT version, name FROM schema_migrations').all() as Array<{
      version: number;
      name: string;
    }>;
    expect(rows).toEqual([
      { version: 1, name: '0001_init' },
      { version: 3, name: '0003_compilations_fix' },
      { version: 4, name: '0004_project_memory' },
      { version: 5, name: '0005_semantic_context' },
      { version: 6, name: '0006_execution_sessions' },
      { version: 7, name: '0007_runtime_metadata' },
      { version: 8, name: '0008_execution_handoffs' },
    ]);
  });

  it('is idempotent: a second run applies nothing and preserves data', async () => {
    await runMigrations(runner);
    await runner.execute(
      'INSERT INTO projects (id, name, repo_path, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['project-a', 'A', '/tmp/a', '{}', 'now', 'now'],
    );
    const second = await runMigrations(runner);
    expect(second.applied).toEqual([]);
    expect(second.currentVersion).toBe(8);
    const rows = sqlite.prepare('SELECT id FROM projects').all();
    expect(rows).toHaveLength(1);
  });

  it('rejects a database newer than the app supports (schema-version guard)', async () => {
    await runMigrations(runner);
    await runner.execute('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
      99,
      'future',
      'now',
    ]);
    await expect(runMigrations(runner)).rejects.toThrow(/newer than this app supports/);
  });

  it('applies pending migrations in version order', async () => {
    const withProbe = [
      ...MIGRATIONS,
      { version: 2, name: '0002_probe', sql: 'CREATE TABLE probe_table (id TEXT PRIMARY KEY);' },
    ];
    const report = await runMigrations(runner, withProbe);
    expect(report.applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(tableExists('probe_table')).toBe(true);

    const rerun = await runMigrations(runner, withProbe);
    expect(rerun.applied).toEqual([]);
    expect(rerun.currentVersion).toBe(8);
  });

  it('rolls back a failing migration completely', async () => {
    const broken = [
      ...MIGRATIONS,
      {
        version: 2,
        name: '0002_bad',
        sql: 'CREATE TABLE rollback_probe (id TEXT);\nTHIS IS NOT VALID SQL;',
      },
    ];
    await expect(runMigrations(runner, broken)).rejects.toThrow(/Migration 0002_bad failed/);
    expect(tableExists('rollback_probe')).toBe(false);
    const versions = sqlite.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {
      v: number;
    };
    expect(versions.v).toBe(1);
  });
});

describe('splitSqlStatements', () => {
  it('splits on semicolons and drops empty statements', () => {
    expect(splitSqlStatements('CREATE TABLE a (x TEXT);;;\nCREATE TABLE b (y TEXT);')).toEqual([
      'CREATE TABLE a (x TEXT)',
      'CREATE TABLE b (y TEXT)',
    ]);
  });

  it('keeps semicolons inside single-quoted strings', () => {
    const statements = splitSqlStatements("INSERT INTO t (a) VALUES ('a;b');");
    expect(statements).toEqual(["INSERT INTO t (a) VALUES ('a;b')"]);
  });

  it('ignores line comments', () => {
    const statements = splitSqlStatements('-- a comment; with a semicolon\nCREATE TABLE x (a TEXT);');
    expect(statements).toEqual(['CREATE TABLE x (a TEXT)']);
  });

  it('returns nothing for empty or comment-only input', () => {
    expect(splitSqlStatements('')).toEqual([]);
    expect(splitSqlStatements('-- only a comment')).toEqual([]);
  });
});
