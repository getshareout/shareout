-- Why: a page can declare workspace MCP connections it calls as its viewer. Each
-- member allows that once per page and connection; the allow is bound to the hash
-- of the page's declaration, so a republish that changes which connections or tools
-- the page may call asks again. Revoking deletes the row.

CREATE TABLE IF NOT EXISTS artifact_mcp_consents (
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    capability_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (artifact_id, user_id, connection_id)
);
CREATE INDEX IF NOT EXISTS idx_artifact_mcp_consents_user ON artifact_mcp_consents(user_id);
