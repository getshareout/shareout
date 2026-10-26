-- A `kind: metric` catalog entry can now be executed: its frontmatter is a spec (source,
-- measure or numerator/denominator, time grains, dimensions, filters, format) that
-- ShareOut compiles to SQL. This is the index of those specs, kept in sync with the
-- catalog files on every write and delete, so a metric resolves by id without parsing
-- the whole catalog. The file stays the source of truth; this row is derived from it.
--
-- `spec_hash` is the certification hash of the spec (catalog_certifications pins
-- decisions to it). `compile_error` says why a metric cannot run (unknown connection,
-- a provider that cannot run SQL, a missing shared table, no spec yet). The connection
-- is a real reference: deleting it leaves the metric unrunnable, not orphaned.
-- `updated_by` is attribution (no cascade), and the author a draft may be run by.
CREATE TABLE IF NOT EXISTS catalog_metrics (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entry_id       TEXT NOT NULL,
  path           TEXT NOT NULL,
  connection_id  TEXT REFERENCES connections(id) ON DELETE SET NULL,
  spec_json      TEXT NOT NULL,
  spec_hash      TEXT NOT NULL,
  compile_error  TEXT,
  updated_by     TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id, entry_id)
);

-- Deleting a connection sets connection_id to NULL here; without an index that is a
-- scan of every workspace's metrics.
CREATE INDEX IF NOT EXISTS idx_catalog_metrics_connection ON catalog_metrics(connection_id);
