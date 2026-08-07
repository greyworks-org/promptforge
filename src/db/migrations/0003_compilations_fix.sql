-- Phase 8: update compilations + task_outcomes to 1.1.0 schema.
-- Adds columns introduced in the execution-profile contract update.
-- SQLite 3.25.0+ supports RENAME COLUMN (bundled rusqlite qualifies).

-- Add 1.1.0 execution-profile columns.
ALTER TABLE compilations ADD COLUMN target_model TEXT NOT NULL DEFAULT '';
ALTER TABLE compilations ADD COLUMN agent_runtime TEXT NOT NULL DEFAULT '';
ALTER TABLE compilations ADD COLUMN execution_profile TEXT NOT NULL DEFAULT '';
ALTER TABLE compilations ADD COLUMN profile_version TEXT NOT NULL DEFAULT '1.0.0';

-- Remove the legacy target_provider column (replaced by target_model + agent_runtime).
-- SQLite 3.35.0+ supports DROP COLUMN (bundled rusqlite qualifies).
ALTER TABLE compilations DROP COLUMN target_provider;

ALTER TABLE task_outcomes RENAME COLUMN used_provider TO used_runtime;
