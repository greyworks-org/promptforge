-- Phase 9: central per-project memory record (DATA_MODEL.md §1.6).
-- One row per registered project. Provider-neutral: all agent
-- handoffs read this same record.

CREATE TABLE project_memory (
  project_id             TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  stack_json             TEXT NOT NULL DEFAULT '[]',
  current_phase          TEXT,
  last_validated_task_id TEXT REFERENCES compilations(id),
  current_task_id        TEXT REFERENCES compilations(id),
  next_task_json         TEXT,
  decisions_json         TEXT NOT NULL DEFAULT '[]',
  blockers_json          TEXT NOT NULL DEFAULT '[]',
  relevant_files_json    TEXT NOT NULL DEFAULT '[]',
  last_test_json         TEXT,
  base_commit            TEXT,
  updated_at             TEXT NOT NULL
);
