-- Persistent, provider-neutral execution sessions and append-only continuity events.
CREATE TABLE execution_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  compilation_id TEXT REFERENCES compilations(id) ON DELETE SET NULL,
  task_id TEXT,
  runtime TEXT NOT NULL,
  status TEXT NOT NULL,
  state_json TEXT NOT NULL DEFAULT '{}',
  base_commit TEXT,
  last_known_head TEXT,
  recovery_reason TEXT,
  started_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE INDEX execution_sessions_project_idx
  ON execution_sessions(project_id, last_active_at DESC);

CREATE TABLE session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES execution_sessions(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  runtime TEXT,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX session_events_session_idx
  ON session_events(session_id, created_at ASC);
