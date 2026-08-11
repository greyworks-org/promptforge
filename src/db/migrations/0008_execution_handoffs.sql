-- Canonical cross-model handoff lineage and bounded continuation packages.
CREATE TABLE execution_handoffs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  source_execution_session_id TEXT NOT NULL REFERENCES execution_sessions(id) ON DELETE CASCADE,
  target_execution_session_id TEXT NOT NULL REFERENCES execution_sessions(id) ON DELETE CASCADE,
  source_runtime TEXT NOT NULL,
  source_provider_id TEXT,
  source_model_id TEXT,
  source_model_ref TEXT,
  target_runtime TEXT NOT NULL,
  target_provider_id TEXT NOT NULL,
  target_model_id TEXT NOT NULL,
  target_model_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  continuation_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  activated_at TEXT
);

CREATE INDEX execution_handoffs_project_idx
  ON execution_handoffs(project_id, created_at DESC);

CREATE UNIQUE INDEX execution_handoffs_active_source_idx
  ON execution_handoffs(source_execution_session_id)
  WHERE status = 'prepared';
