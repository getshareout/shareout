-- Certification used to be a frontmatter string any member could type into a catalog
-- file, and editing the file kept it. It is now a decision an owner or admin makes about
-- one exact version of an entry: append-only, so "who certified this number, and when"
-- has an answer that survives edits. `content_hash` pins the decision to the content it
-- was made on; an entry whose current hash differs reads "changed since certification".
--
-- `entry_id` is the catalog entry's frontmatter id, not a foreign key: entries are
-- `workspace_files` rows addressed by path, and the id is what lineage and agents use.
-- `decided_by` is attribution (no cascade): deleting a user must not erase the trail.
-- `decision` is certified | revoked | deprecated, enforced where it is written
-- (CERT_DECISIONS in src/catalog/types.ts), per CONVENTIONS.md.
CREATE TABLE IF NOT EXISTS catalog_certifications (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entry_id      TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  decision      TEXT NOT NULL,
  note          TEXT,
  decided_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- The overlay reads every decision of a workspace in order; history reads one entry's.
CREATE INDEX IF NOT EXISTS idx_catalog_certifications_workspace_entry_created
  ON catalog_certifications(workspace_id, entry_id, created_at);
