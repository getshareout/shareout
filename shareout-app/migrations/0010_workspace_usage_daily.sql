-- What each workspace cost the instance, one row per UTC day per metric, so an operator
-- can see (and, on a hosted instance, invoice) daily and monthly usage. The live
-- "Cost by workspace" view only estimates the current window and storage is
-- point-in-time; this keeps the history. Email sends and browser seconds are counted as
-- they happen; everything else is rolled up nightly by src/workspaces/usage-ledger.ts.
CREATE TABLE IF NOT EXISTS workspace_usage_daily (
  day            TEXT NOT NULL,                                                   -- YYYY-MM-DD UTC
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  metric         TEXT NOT NULL,                                                   -- USAGE_METRICS in usage-ledger.ts
  quantity       INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (day, workspace_id, metric)
);
