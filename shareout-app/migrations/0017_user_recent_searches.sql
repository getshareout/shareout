-- Why: the search palette shows the last queries a person ran when it opens empty, and
-- those should follow them to another device. One row per (user, scope, query); a scope
-- is the workspace id the search ran in, or '' for personal / all pages, so a query run
-- in one workspace never shows up in another. The app keeps at most 20 per user and scope.
CREATE TABLE IF NOT EXISTS user_recent_searches (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_key   TEXT NOT NULL DEFAULT '',
  query_key   TEXT NOT NULL,
  query       TEXT NOT NULL,
  searched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, scope_key, query_key)
);
CREATE INDEX IF NOT EXISTS idx_user_recent_searches_user_scope ON user_recent_searches(user_id, scope_key, searched_at DESC);
