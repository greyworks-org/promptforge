import { describe, it, expect, beforeEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { createBetterSqliteRunner } from './betterSqliteRunner';
import { runMigrations, MIGRATIONS } from './migrate';
import type { QueryRunner } from './runner';

/**
 * Regression test: migration runner tolerates partially-applied DDL
 * from a previous (failed) migration run.
 *
 * Scenario: migration 0003's DROP COLUMN succeeded but ADD COLUMNs
 * never ran. Re-running 0003 must not fail on the already-dropped
 * column or on columns that were partially added.
 */
describe('migration regression — partially applied DDL', () => {
  let runner: QueryRunner;
  let sqlite: BetterSqlite3.Database;

  beforeEach(() => {
    sqlite = new BetterSqlite3(':memory:');
    runner = createBetterSqliteRunner(sqlite);
  });

  it('handles duplicate ADD COLUMN gracefully', async () => {
    // Apply migration 0001 first.
    const v1 = MIGRATIONS.find((m) => m.version === 1)!;
    await runMigrations(runner, [v1]);

    // Simulate a partially-applied 0003: add one column but don't record it.
    sqlite.exec('ALTER TABLE compilations ADD COLUMN target_model TEXT NOT NULL DEFAULT \'\';');

    // Now run the full migration set. 0003's ADD COLUMN target_model
    // should be skipped (duplicate), the rest applied normally.
    const report = await runMigrations(runner);
    expect(report.currentVersion).toBe(4);

    // Verify all 0003 columns exist.
    const cols = sqlite.prepare('PRAGMA table_info(compilations)').all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('target_model');
    expect(names).toContain('agent_runtime');
    expect(names).toContain('execution_profile');
    expect(names).toContain('profile_version');

    // Verify target_provider was dropped.
    expect(names).not.toContain('target_provider');

    // Verify used_provider was renamed.
    const oc = sqlite.prepare('PRAGMA table_info(task_outcomes)').all() as Array<{ name: string }>;
    const outcomeNames = oc.map((c) => c.name);
    expect(outcomeNames).toContain('used_runtime');
    expect(outcomeNames).not.toContain('used_provider');

    // Verify project_memory table exists.
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain('project_memory');
  });

  it('handles already-dropped column gracefully', async () => {
    const v1 = MIGRATIONS.find((m) => m.version === 1)!;
    await runMigrations(runner, [v1]);

    // Pre-drop the column like a previous partial run did.
    sqlite.exec('ALTER TABLE compilations DROP COLUMN target_provider;');

    // Full run should succeed.
    const report = await runMigrations(runner);
    expect(report.currentVersion).toBe(4);
  });

  it('handles already-created table gracefully', async () => {
    const v1 = MIGRATIONS.find((m) => m.version === 1)!;
    const v3 = MIGRATIONS.find((m) => m.version === 3)!;
    await runMigrations(runner, [v1, v3]);

    // Pre-create the project_memory table like a manual intervention.
    sqlite.exec(`CREATE TABLE project_memory (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      stack_json TEXT NOT NULL DEFAULT '[]',
      current_phase TEXT,
      last_validated_task_id TEXT REFERENCES compilations(id),
      current_task_id TEXT REFERENCES compilations(id),
      next_task_json TEXT,
      decisions_json TEXT NOT NULL DEFAULT '[]',
      blockers_json TEXT NOT NULL DEFAULT '[]',
      relevant_files_json TEXT NOT NULL DEFAULT '[]',
      last_test_json TEXT,
      base_commit TEXT,
      updated_at TEXT NOT NULL
    )`);

    // 0004 should skip CREATE TABLE and still record the migration.
    const report = await runMigrations(runner);
    expect(report.currentVersion).toBe(4);
  });
});
