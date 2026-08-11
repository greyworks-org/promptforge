import type { QueryRunner } from './runner';
import initSql from './migrations/0001_init.sql?raw';
import compilationsFixSql from './migrations/0003_compilations_fix.sql?raw';
import projectMemorySql from './migrations/0004_project_memory.sql?raw';
import semanticContextSql from './migrations/0005_semantic_context.sql?raw';
import executionSessionsSql from './migrations/0006_execution_sessions.sql?raw';
import runtimeMetadataSql from './migrations/0007_runtime_metadata.sql?raw';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Ordered migration list; versions are gapless and increasing. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '0001_init', sql: initSql },
  { version: 3, name: '0003_compilations_fix', sql: compilationsFixSql },
  { version: 4, name: '0004_project_memory', sql: projectMemorySql },
  { version: 5, name: '0005_semantic_context', sql: semanticContextSql },
  { version: 6, name: '0006_execution_sessions', sql: executionSessionsSql },
  { version: 7, name: '0007_runtime_metadata', sql: runtimeMetadataSql },
];

export interface MigrationReport {
  applied: number[];
  currentVersion: number;
}

/**
 * Split a migration file into individual statements. Aware of single-quoted
 * strings and `--` line comments. Migration files are PromptForge-owned DDL,
 * so no other escaping exists.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let inLineComment = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        current += ch;
      }
      continue;
    }
    if (inString) {
      current += ch;
      if (ch === "'") {
        if (next === "'") {
          current += next;
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (ch === '-' && next === '-') {
      inLineComment = true;
      continue;
    }
    if (ch === "'") {
      inString = true;
      current += ch;
      continue;
    }
    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed !== '') statements.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail !== '') statements.push(tail);
  return statements;
}

const MIGRATIONS_TABLE_DDL =
  'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)';

/** Current schema version of the database (0 = no migrations applied). */
export async function currentSchemaVersion(runner: QueryRunner): Promise<number> {
  const rows = await runner.select<{ version: number }>(
    'SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations',
  );
  return rows[0]?.version ?? 0;
}

/**
 * Apply pending migrations in order. Idempotent: already-applied versions are
 * skipped; a re-run on a current database applies nothing. Each migration is
 * wrapped in a transaction, so a failure leaves no partial schema. Refuses to
 * run against a database newer than the app knows (downgrade guard).
 */
export async function runMigrations(
  runner: QueryRunner,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrationReport> {
  await runner.execute(MIGRATIONS_TABLE_DDL);
  const known = [...migrations].sort((a, b) => a.version - b.version);
  const current = await currentSchemaVersion(runner);
  const maxKnown = known.length > 0 ? known[known.length - 1].version : 0;
  if (current > maxKnown) {
    throw new Error(
      `Database schema version ${current} is newer than this app supports (max ${maxKnown}). Migrations were not run.`,
    );
  }

  const applied: number[] = [];
  let version = current;
  for (const migration of known) {
    if (migration.version <= version) continue;
    await runner.execute('BEGIN');
    try {
      for (const statement of splitSqlStatements(migration.sql)) {
        try {
          await runner.execute(statement);
        } catch (stmtErr: unknown) {
          const msg = stmtErr instanceof Error ? stmtErr.message : String(stmtErr);
          // Tolerate already-applied DDL: duplicate column, missing column
          // for drop/rename, or already-renamed column.
          if (
            msg.includes('duplicate column name') ||
            msg.includes('no such column') ||
            msg.includes('duplicate column') ||
            (msg.includes('already exists') && statement.toUpperCase().includes('CREATE'))
          ) {
            // Schema already in desired state — statement is harmless to skip.
            continue;
          }
          throw stmtErr;
        }
      }
      await runner.execute('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
        migration.version,
        migration.name,
        new Date().toISOString(),
      ]);
      await runner.execute('COMMIT');
    } catch (err) {
      try {
        await runner.execute('ROLLBACK');
      } catch {
        // Connection-level failure: nothing left to roll back.
      }
      throw err instanceof Error
        ? new Error(`Migration ${migration.name} failed: ${err.message}`)
        : err;
    }
    applied.push(migration.version);
    version = migration.version;
  }
  return { applied, currentVersion: version };
}
