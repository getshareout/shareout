-- Why: a customer that runs its own identity provider (Okta, Entra ID, …) needs its
-- people to sign in through it, and some need it to be the only way in. One OIDC app
-- per workspace. Only the instance owner may write a row: the IdP asserts email
-- addresses and nothing in ShareOut proves a workspace owns a domain, so a
-- self-served row would let a workspace admin sign in as anyone on those domains.
--
-- `email_domains` (JSON array, lowercase) is the set of addresses this IdP may sign
-- in; the application keeps a domain claimed by at most one workspace.
-- `is_enforced` = addresses on those domains may sign in only through this IdP.

CREATE TABLE IF NOT EXISTS workspace_sso_config (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    issuer TEXT NOT NULL,
    client_id TEXT NOT NULL,
    encrypted_client_secret TEXT NOT NULL,
    client_secret_iv TEXT NOT NULL,
    email_domains TEXT NOT NULL,
    button_label TEXT,
    is_enforced INTEGER NOT NULL DEFAULT 0,
    updated_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
