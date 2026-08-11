-- Opaque runtime/model binding for future multi-model routing.
ALTER TABLE execution_sessions ADD COLUMN runtime_metadata_json TEXT NOT NULL DEFAULT '{}';
