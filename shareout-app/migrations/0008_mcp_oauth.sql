-- Why: claude.ai, Claude Desktop and ChatGPT add a remote MCP server as a "custom
-- connector" by URL and sign the person in with OAuth 2.1 — no token to paste. This is
-- the authorization server's state. Access tokens are NOT stored here: each one is an
-- ordinary short-lived `so_` row in `tokens`, so every existing authz path applies to
-- it unchanged. Only hashes of codes and refresh tokens are kept.

-- One row per client that registered itself (RFC 7591 dynamic client registration).
-- `client_secret_hash` is NULL for public clients (PKCE only), which is the norm.
CREATE TABLE IF NOT EXISTS oauth_clients (
    id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    redirect_uris TEXT NOT NULL,            -- JSON array of exact redirect URIs
    client_secret_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Authorization codes: single-use (deleted on redemption), minutes-long, PKCE-bound.
CREATE TABLE IF NOT EXISTS oauth_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    scope TEXT,
    resource TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON oauth_codes(expires_at);

-- One row per "person allowed this client": holds the current refresh token (rotated on
-- every use) and points at the access token it last minted, so a refresh or a revoke
-- can delete that `tokens` row. Revoking the grant ends the connection.
CREATE TABLE IF NOT EXISTS oauth_grants (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    access_token_id TEXT REFERENCES tokens(id) ON DELETE SET NULL,
    scope TEXT,
    resource TEXT,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_oauth_grants_user ON oauth_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_grants_access_token ON oauth_grants(access_token_id);
