-- Why: skills could only be attached per member (workspace_agent_skills), so a workspace could not give
-- every member's agent the same house conventions (e.g. a design kit). A workspace admin attaches a
-- Library skill here; it is injected into every member's agent turn scoped to THIS workspace only.
-- Pinned to skill_version_no like the per-member attach. Additive: a new table, nothing altered.

CREATE TABLE IF NOT EXISTS workspace_default_skills (
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  skill_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  skill_version_no  INTEGER NOT NULL,
  position          INTEGER NOT NULL DEFAULT 0,
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, skill_artifact_id)
);
