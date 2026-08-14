-- Persistent per-project intelligence: the evidence-derived product/state
-- record the Compiler and continuation surfaces read from. One row per
-- registered project. The document is validated by Zod on every read, so
-- unsupported claims can never enter the record as facts.

CREATE TABLE project_intelligence (
  project_id      TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  schema_version  TEXT NOT NULL,
  document_json   TEXT NOT NULL,
  source_head     TEXT,
  bootstrapped_at TEXT NOT NULL,
  reconciled_at   TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
