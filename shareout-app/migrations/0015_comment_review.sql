-- Why: comments become a review workflow. Each new comment records the version that
-- was live when it was written, so History can count comments per version and a
-- thread can say a comment was made on an older one. Nullable: comments written
-- before this carry no version. Set null when the version row goes away.
-- An approval records who signed off on which version; it does not gate publishing.

ALTER TABLE artifact_comments ADD COLUMN version_id TEXT REFERENCES versions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_artifact_comments_version ON artifact_comments(version_id);

CREATE TABLE IF NOT EXISTS artifact_approvals (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_artifact_approvals_version_user ON artifact_approvals(version_id, user_id);
CREATE INDEX IF NOT EXISTS idx_artifact_approvals_artifact ON artifact_approvals(artifact_id, created_at);
