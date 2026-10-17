-- Why: a workspace can serve on hostnames its customer owns (portal.acme.example), not
-- only on <slug>.<apex>. A hostname belongs to at most one workspace (ux index), is
-- stored normalized (lowercase ASCII / punycode, no trailing dot) and only routes once
-- its status is 'active', which takes a verified ownership check (Cloudflare for SaaS
-- custom hostname, or the manual DNS TXT check on instances without it).
-- provider_id is the Cloudflare custom hostname id, so deleting the row also removes
-- the hostname from the zone and nobody else can point it at another workspace.
CREATE TABLE IF NOT EXISTS workspace_domains (
    id                  TEXT PRIMARY KEY,
    workspace_id        TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    hostname            TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending',
    is_primary          INTEGER NOT NULL DEFAULT 0,
    provider            TEXT NOT NULL DEFAULT 'manual',
    provider_id         TEXT,
    verification_method TEXT NOT NULL,
    verification_name   TEXT,
    verification_token  TEXT NOT NULL,
    ssl_status          TEXT,
    last_error          TEXT,
    created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    verified_at         TEXT,
    last_checked_at     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_workspace_domains_hostname ON workspace_domains(hostname);
CREATE INDEX IF NOT EXISTS idx_workspace_domains_workspace ON workspace_domains(workspace_id);

-- Why: a session cookie on a customer hostname cannot be the apex's shared cookie, so
-- sign-in happens on the apex and hands a one-time code to the custom host. Only the
-- code's hash is stored. A code is bound to one hostname, lives for a minute and is
-- spent by the first callback that presents it (used_at).
CREATE TABLE IF NOT EXISTS workspace_domain_handoffs (
    id            TEXT PRIMARY KEY,
    code_hash     TEXT NOT NULL,
    hostname      TEXT NOT NULL,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_path TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at    TEXT NOT NULL,
    used_at       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_workspace_domain_handoffs_code ON workspace_domain_handoffs(code_hash);
