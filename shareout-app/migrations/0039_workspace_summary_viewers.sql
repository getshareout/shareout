-- Admin → Summary is the workspace's month-by-month usage report: visits, pages, knowledge, AI and
-- what each member did. It is for the people who run the workspace, not every admin, so besides
-- the owner only the admins listed here may open it. No rows = the owner alone. The owner keeps
-- the list; a viewer who stops being an admin loses access without the row being touched.
CREATE TABLE IF NOT EXISTS workspace_summary_viewers (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, user_id)
);
