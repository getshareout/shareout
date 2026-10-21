-- Why: a page can run queries with a viewer's saved per-user connector credentials,
-- so each viewer must approve that once per page and connector. Revoking deletes the row.

CREATE TABLE IF NOT EXISTS connection_consents (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (user_id, artifact_id, connection_id)
);
