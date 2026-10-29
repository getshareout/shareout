-- One row per AI page build, from both builders (the tool-using agent and the one-shot
-- streamBuild). ai_usage_events says what each model call cost; this says what the build
-- did and how it ended, so a failed build can be explained after the fact. Read only by
-- the admin Health view. Pruned after 90 days by the daily cleanup. Cost is not stored: it
-- is reconciled hourly in ai_usage_events, so the view sums that table over
-- [started_at, finished_at] for the same user and workspace.
CREATE TABLE IF NOT EXISTS page_build_traces (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT REFERENCES workspaces(id) ON DELETE SET NULL,   -- null: personal scope
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,        -- null: anonymous preview
  source        TEXT,                                                -- what asked: 'create' | 'assistant'
  path          TEXT NOT NULL,                                       -- 'agent' | 'one_shot'
  model         TEXT,
  effort        TEXT,                                                -- reasoning effort we asked for, when we set one
  outcome       TEXT NOT NULL,                                       -- 'published' | 'previewed' | 'gave_up' | 'failed' | 'truncated'
  artifact_id   TEXT,                                                -- no FK: a trace outlives its page, and a missing page must never lose the trace
  version_no    INTEGER,
  turns         INTEGER NOT NULL DEFAULT 0,
  tool_calls    INTEGER NOT NULL DEFAULT 0,
  tool_errors   INTEGER NOT NULL DEFAULT 0,
  check_rounds  INTEGER NOT NULL DEFAULT 0,                          -- static checks that found errors
  verify_status TEXT,                                                -- result of testing the published page, when it was tested
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  error_code    TEXT,
  error_message TEXT,
  steps_json    TEXT NOT NULL DEFAULT '[]',                          -- capped; tool names and counts only, never file contents
  started_at    TEXT NOT NULL,
  finished_at   TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_page_build_traces_created ON page_build_traces(created_at DESC);
