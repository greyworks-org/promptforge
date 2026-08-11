-- Persist the exact registered project root used by a runtime session.
ALTER TABLE execution_sessions ADD COLUMN runtime_cwd TEXT;
