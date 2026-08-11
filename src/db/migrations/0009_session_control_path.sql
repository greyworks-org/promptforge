-- Session control-path state: selected repository references and the latest user instruction.
CREATE TABLE project_context_documents (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rel_path    TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  PRIMARY KEY (project_id, rel_path)
);

CREATE INDEX project_context_documents_project_idx
  ON project_context_documents(project_id, rel_path COLLATE NOCASE);

ALTER TABLE execution_sessions ADD COLUMN user_instruction TEXT NOT NULL DEFAULT '';
