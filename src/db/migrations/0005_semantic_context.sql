-- V1 live semantic context refresh state.
-- One JSON state per project: attempted fingerprint, status, and snapshot.

ALTER TABLE project_memory ADD COLUMN semantic_context_json TEXT;
