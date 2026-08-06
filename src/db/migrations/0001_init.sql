-- PromptForge Local — initial schema (docs/DATA_MODEL.md §1).
-- Migration 0001. Plain DDL only: must run identically under
-- tauri-plugin-sql (production) and better-sqlite3 (tests).
-- FTS5 (Phase 4) and project_memory (Phase 9) arrive in later migrations.

CREATE TABLE projects (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  repo_path         TEXT NOT NULL UNIQUE,
  current_milestone TEXT,
  settings_json     TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE context_docs (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rel_path        TEXT NOT NULL,
  title           TEXT NOT NULL,
  summary         TEXT,
  tags_json       TEXT NOT NULL DEFAULT '[]',
  task_types_json TEXT NOT NULL DEFAULT '[]',
  content_hash    TEXT NOT NULL,
  est_tokens      INTEGER NOT NULL,
  last_scanned_at TEXT NOT NULL,
  UNIQUE (project_id, rel_path)
);

CREATE TABLE compilations (
  id                          TEXT PRIMARY KEY,
  project_id                  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at                  TEXT NOT NULL,
  raw_request                 TEXT NOT NULL,
  task_type                   TEXT NOT NULL,
  execution_mode              TEXT NOT NULL,
  target_provider             TEXT NOT NULL,
  provider_label              TEXT NOT NULL,
  model_id                    TEXT NOT NULL,
  context_doc_ids_json        TEXT NOT NULL DEFAULT '[]',
  context_sent                TEXT NOT NULL,
  blocking_rounds             INTEGER NOT NULL DEFAULT 0,
  taskspec_json               TEXT,
  prompt_qwen                 TEXT,
  prompt_codex                TEXT,
  prompt_claude               TEXT,
  compiler_prompt_tokens      INTEGER,
  compiler_completion_tokens  INTEGER,
  compiler_tokens_estimated   INTEGER NOT NULL DEFAULT 0,
  final_prompt_tokens_est     INTEGER,
  duration_ms                 INTEGER,
  status                      TEXT NOT NULL,
  error                       TEXT,
  recompile_of                TEXT REFERENCES compilations(id)
);

CREATE TABLE task_outcomes (
  compilation_id      TEXT PRIMARY KEY REFERENCES compilations(id) ON DELETE CASCADE,
  completion_result   TEXT NOT NULL,
  revision_count      INTEGER NOT NULL DEFAULT 0,
  scope_violation     INTEGER,
  tests_passed        INTEGER,
  completion_time_min INTEGER,
  used_provider       TEXT,
  user_note           TEXT,
  recorded_at         TEXT NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_context_docs_project ON context_docs(project_id);
CREATE INDEX idx_compilations_project ON compilations(project_id);
