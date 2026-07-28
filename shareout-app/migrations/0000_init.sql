-- ShareOut database schema.
--
-- The whole thing, in one file. Applying this to an empty database gives you a
-- complete, working ShareOut install — that is the only thing this file is for.
-- It is the *state* of the schema, not the story of how it got here.
--
-- Read this alongside:
--   migrations/SCHEMA.md       — what every table is for, domain by domain, with diagrams
--   migrations/CONVENTIONS.md  — rules for new tables and columns
--   migrations/REDESIGN.md     — how the schema got this shape, and what the plan got wrong
--
-- Statements are `IF NOT EXISTS` so re-applying is a no-op. Wrangler tracks applied
-- migrations by exact filename: never rename this file or edit it in a way that
-- changes an existing install's schema. Changes to a shipped table go in a new
-- `0001_*.sql` and up, checked by scripts/check-migrations.mjs.

-- ==========================================================================
-- 01. Identity & auth
-- Accounts, sessions, tokens, and the credentials that prove who someone is.
-- ==========================================================================

-- users
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
    picture TEXT,
    google_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_login_at TEXT,
    username TEXT,
    metadata TEXT DEFAULT '{}'
, tier TEXT NOT NULL DEFAULT 'free', disabled INTEGER NOT NULL DEFAULT 0, identity_id TEXT, is_service INTEGER NOT NULL DEFAULT 0, last_janitor_at TEXT);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_identity ON users(identity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username) WHERE username IS NOT NULL;

-- user_passwords
-- Kept out of `users`: a credential digest has its own lifecycle, and every existing
-- SELECT on `users` would otherwise carry a password hash it has no business reading.
-- `iterations` is per row so the cost can be raised without invalidating old credentials.
CREATE TABLE IF NOT EXISTS user_passwords (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hash         TEXT NOT NULL,
  salt         TEXT NOT NULL,
  iterations   INTEGER NOT NULL,
  algo         TEXT NOT NULL DEFAULT 'PBKDF2-SHA256',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- user_profiles
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile_md TEXT NOT NULL DEFAULT '',          -- free-form markdown the agent reads/writes
  follows TEXT NOT NULL DEFAULT '[]',           -- JSON array of { kind, ref } follow targets
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- admin_sessions
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_id TEXT REFERENCES artifacts(id) ON DELETE CASCADE,
  session_token TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  ip_address TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id);

-- tokens
-- Every bearer token, personal and workspace-agent alike. `principal_type` says who
-- owns it (a user's own `so_` token, or a workspace's `sot_` agent token); `user_id`
-- is always the identity it authenticates as, so the join to `users` is the same for
-- both. `scopes` is NULL for personal tokens (full rights of their user) and a csv of
-- service scopes for workspace tokens.
CREATE TABLE IF NOT EXISTS tokens (
    id TEXT PRIMARY KEY,
    principal_type TEXT NOT NULL CHECK (principal_type IN ('user','workspace')),
    principal_id TEXT NOT NULL,             -- user id | workspace id
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,        -- SHA-256; plaintext shown once at mint
    name TEXT NOT NULL DEFAULT 'default',
    scopes TEXT,                            -- csv: "artifacts:publish,data:write"
    subject_external_user_id TEXT REFERENCES users(id),
    created_by TEXT,                        -- human admin who minted a workspace token
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_used_at TEXT,
    expires_at TEXT,
    revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tokens_principal ON tokens(principal_type, principal_id);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);

-- device_auth
CREATE TABLE IF NOT EXISTS device_auth (
  id           TEXT PRIMARY KEY,
  device_code  TEXT NOT NULL UNIQUE,   -- secret, held only by the CLI; never shown to user
  user_code    TEXT NOT NULL UNIQUE,   -- short human code shown/typed in the browser
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | denied
  user_id        TEXT REFERENCES users(id) ON DELETE CASCADE,                 -- set on approval
  token          TEXT,                 -- plaintext so_ token, set on approval, cleared on claim
  expected_email TEXT,                 -- optional: email the CLI expects (invited-under); pre-selects Google + drives mismatch warn
  warn           TEXT,                 -- optional note surfaced to CLI (e.g. signed in under a different email)
  ip_address   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at   TEXT NOT NULL,       -- ISO; row unusable past this
  approved_at  TEXT,
  claimed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_device_auth_expires ON device_auth(expires_at);
CREATE INDEX IF NOT EXISTS idx_device_auth_user_code ON device_auth(user_code);

-- email_otp_codes
CREATE TABLE IF NOT EXISTS email_otp_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_otp_created ON email_otp_codes(created_at);
CREATE INDEX IF NOT EXISTS idx_email_otp_email ON email_otp_codes(email);

-- google_oauth_tokens
CREATE TABLE IF NOT EXISTS google_oauth_tokens (
    user_id TEXT PRIMARY KEY,
    -- One AES-GCM blob holding access token, refresh token and expiry together.
    -- Two ciphertexts cannot share one iv: that is why the refresh token used to be
    -- undecryptable, and why this is a single column.
    encrypted_credentials TEXT NOT NULL,
    iv TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    scopes TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- artifact_passwords
-- Basic-auth credentials for a password-gated artifact. Named for what it is: the old
-- `credentials` collided with `user_passwords` and with connection credentials.
CREATE TABLE IF NOT EXISTS artifact_passwords (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(artifact_id, username)
);
CREATE INDEX IF NOT EXISTS idx_artifact_passwords_artifact ON artifact_passwords(artifact_id);

-- rate_limits
-- One counter table for every rate limit in the product. A row is "principal did
-- `action` `count` times in the window that starts at `window_start`". The window
-- string carries its own granularity — an ISO day for publishes, an hour for
-- presentations, `YYYY-MM-DDTHH:MM` for the per-minute agent limit — so a new limit
-- needs a new action name, never a new table. Limits themselves live in code.
CREATE TABLE IF NOT EXISTS rate_limits (
    principal_type TEXT NOT NULL CHECK (principal_type IN ('user','artifact')),
    principal_id TEXT NOT NULL,
    action TEXT NOT NULL,
    window_start TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (principal_type, principal_id, action, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

-- onboarding_state
CREATE TABLE IF NOT EXISTS onboarding_state (
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_ack_at  TEXT,            -- set when the user clicks "Get the skill" (task not server-observable)
  dismissed_at  TEXT,            -- checklist hidden by the user
  celebrated_at TEXT,            -- 100% moment already fired (once)
  PRIMARY KEY (workspace_id, user_id)
);


-- ==========================================================================
-- 02. Workspaces & access control
-- Workspaces, who belongs to them, and every way access is granted or requested.
-- ==========================================================================

-- workspaces
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    owner_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT
, subdomain_enabled INTEGER NOT NULL DEFAULT 0, allowed_email_domains TEXT, allowed_emails TEXT, branding TEXT, feature_flags TEXT, context_entry TEXT, session_max_days INTEGER, public_publish_policy TEXT NOT NULL DEFAULT 'allow', public_publish_approvals_required INTEGER NOT NULL DEFAULT 1, last_janitor_at TEXT);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug);

-- workspace_members
CREATE TABLE IF NOT EXISTS workspace_members (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member', -- owner, admin, member
    invited_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), member_class TEXT NOT NULL DEFAULT 'internal',
    UNIQUE(workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_wm_workspace_class ON workspace_members(workspace_id, member_class);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);

-- Workspace agent tokens live in `tokens` (section 01) as principal_type='workspace';
-- the is_service=1 user they authenticate as is `tokens.user_id`.

-- workspace_invite_claims
CREATE TABLE IF NOT EXISTS workspace_invite_claims (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email        TEXT NOT NULL,
    code_hash    TEXT NOT NULL,
    invited_by   TEXT REFERENCES users(id),
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at   TEXT NOT NULL,
    claimed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_invite_claims_code ON workspace_invite_claims(code_hash);
CREATE INDEX IF NOT EXISTS idx_invite_claims_ws ON workspace_invite_claims(workspace_id);

-- workspace_llm_config
CREATE TABLE IF NOT EXISTS workspace_llm_config (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  byo_provider TEXT CHECK (byo_provider IN ('openai', 'vercel-gateway')),
  byo_encrypted_credentials TEXT,
  byo_iv TEXT,
  balance_micro_usd INTEGER NOT NULL DEFAULT 5000000,      -- $5 free grant
  markup_multiplier REAL NOT NULL DEFAULT 1.30,            -- platform margin on platform-key usage
  monthly_budget_micro_usd INTEGER,                        -- optional soft cap (null = none)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, topup_balance_micro_usd INTEGER NOT NULL DEFAULT 0);

-- workspace_event_visibility
CREATE TABLE IF NOT EXISTS workspace_event_visibility (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_kind   TEXT NOT NULL,                  -- ActivityKind, e.g. 'publish', 'favorite', 'member'
  audience     TEXT NOT NULL                   -- who may see this kind in this workspace
    CHECK (audience IN ('self', 'members', 'admins', 'off')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by   TEXT,
  PRIMARY KEY (workspace_id, event_kind)
);

-- workspace_library
CREATE TABLE IF NOT EXISTS workspace_library (
  artifact_id      TEXT PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
  scope            TEXT NOT NULL,            -- 'personal' | 'workspace'
  owner_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,            -- publisher (always set)
  workspace_id     TEXT REFERENCES workspaces(id) ON DELETE CASCADE,                     -- NULL for personal scope
  namespace        TEXT NOT NULL,            -- URL handle: workspace slug or user handle
  module_name      TEXT NOT NULL,            -- e.g. "charts"
  latest_version   TEXT,                     -- semver of the most recent publish
  latest_main_path TEXT,                     -- served JS file path in the latest version
  install_count    INTEGER NOT NULL DEFAULT 0,
  use_count        INTEGER NOT NULL DEFAULT 0,
  blocked          INTEGER NOT NULL DEFAULT 0,  -- admin moderation
  featured         INTEGER NOT NULL DEFAULT 0,  -- admin curation
  published_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_library_ident ON workspace_library(scope, namespace, module_name);
CREATE INDEX IF NOT EXISTS idx_workspace_library_owner ON workspace_library(owner_id);
CREATE INDEX IF NOT EXISTS idx_workspace_library_ws ON workspace_library(workspace_id);

-- workspace_files
-- A workspace's virtual filesystem: agent context files, the data catalog and the
-- learned knowledge base were three tables with the same shape and different
-- defaults. `namespace` is the directory. `scope_id` narrows a file to one sharee
-- ('' means the whole workspace) — only context files use it.
CREATE TABLE IF NOT EXISTS workspace_files (
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  namespace       TEXT NOT NULL CHECK (namespace IN ('catalog','knowledge','context')),
  scope_id        TEXT NOT NULL DEFAULT '',  -- sharee id, or '' for workspace-wide
  path            TEXT NOT NULL,             -- chat_sent.md, artifacts/<id>.md, glossary/active-user.md
  content         TEXT NOT NULL,             -- raw markdown + YAML frontmatter
  source          TEXT NOT NULL DEFAULT 'manual',  -- manual | learned | consolidated | seed:connector | seed:provenance
  updated_by      TEXT,
  updated_by_kind TEXT NOT NULL DEFAULT 'user',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, namespace, scope_id, path)
);
CREATE INDEX IF NOT EXISTS idx_workspace_files_scope ON workspace_files(scope_id);

-- workspace_storage_snapshots
CREATE TABLE IF NOT EXISTS workspace_storage_snapshots (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL, -- YYYY-MM-DD UTC
  bytes INTEGER NOT NULL DEFAULT 0,
  max_bytes INTEGER NOT NULL DEFAULT 0,
  overage_bytes INTEGER NOT NULL DEFAULT 0,
  tier TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_storage_snap_date ON workspace_storage_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_storage_snap_over ON workspace_storage_snapshots(overage_bytes);

-- folders
CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    owner_id TEXT REFERENCES users(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    visibility TEXT NOT NULL DEFAULT 'inherit', -- inherit, public, unlisted, private
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT
, readme TEXT);
CREATE INDEX IF NOT EXISTS idx_folders_owner ON folders(owner_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_workspace ON folders(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_folders_personal ON folders(owner_id, IFNULL(parent_id, '~'), slug) WHERE workspace_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_folders_ws ON folders(workspace_id, IFNULL(parent_id, '~'), slug) WHERE workspace_id IS NOT NULL;

-- collaborators
CREATE TABLE IF NOT EXISTS collaborators (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  added_by TEXT REFERENCES users(id),
  added_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(artifact_id, email)
);
CREATE INDEX IF NOT EXISTS idx_collaborators_artifact_role
ON collaborators(artifact_id, role, email);
CREATE INDEX IF NOT EXISTS idx_collaborators_email_artifact
ON collaborators(email, artifact_id);

-- grants
CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL,   -- 'sharee' | 'external_user'
  subject_id TEXT NOT NULL,     -- sharee_id OR users.id
  resource_type TEXT NOT NULL,  -- folder|artifact|dataset|connection|asset_bucket|subdomain
  resource_id TEXT NOT NULL,
  capability TEXT NOT NULL,     -- view|comment|create|edit|manage|api
  granted_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT               -- deferred; NOT part of the unique key
);
CREATE INDEX IF NOT EXISTS idx_grants_resource ON grants(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_grants_subject  ON grants(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_grants_workspace ON grants(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_grants_dedup
  ON grants(subject_type, subject_id, resource_type, resource_id, capability);

-- sharees
CREATE TABLE IF NOT EXISTS sharees (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,                       -- Phase 4 portal subdomain/path
  type TEXT NOT NULL DEFAULT 'client',      -- client|supplier|partner|investor|... free attribute
  properties TEXT,                          -- JSON custom props
  branding TEXT,                            -- JSON (logo, colors) — Phase 4
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sharees_workspace ON sharees(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sharees_ws_slug ON sharees(workspace_id, slug);

-- sharee_members
CREATE TABLE IF NOT EXISTS sharee_members (
  id TEXT PRIMARY KEY,
  sharee_id TEXT NOT NULL REFERENCES sharees(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),        -- NULL until invite claimed/login
  email TEXT NOT NULL,                      -- invite target; canonical pre-claim identity
  status TEXT NOT NULL DEFAULT 'invited',   -- invited|active|removed
  invited_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  joined_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sharee_members_user ON sharee_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sharee_members_email ON sharee_members(sharee_id, email);

-- sharee_activity
CREATE TABLE IF NOT EXISTS sharee_activity (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sharee_id TEXT REFERENCES sharees(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'view',   -- view|comment|download
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sharee_activity_resource ON sharee_activity(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_sharee_activity_sharee ON sharee_activity(sharee_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sharee_activity_ws ON sharee_activity(workspace_id, created_at);

-- access_requests
CREATE TABLE IF NOT EXISTS access_requests (
  id                 TEXT PRIMARY KEY,
  artifact_id        TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  requester_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_email    TEXT NOT NULL,
  requester_name     TEXT,
  status             TEXT NOT NULL DEFAULT 'pending', -- pending | approved | denied
  decided_by         TEXT REFERENCES users(id),
  decided_at         TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_access_requests_artifact ON access_requests(artifact_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_pending
  ON access_requests(artifact_id, requester_user_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_access_requests_requester ON access_requests(requester_user_id, artifact_id);

-- home_event_dismissals
CREATE TABLE IF NOT EXISTS home_event_dismissals (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  dismissed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, event_id)
);


-- ==========================================================================
-- 03. Artifacts
-- The core object: an artifact, its versions, and everything hanging directly off one.
-- ==========================================================================

-- artifacts
-- The spine, plus how it is reached. Everything about *presenting* an artifact lives
-- in artifact_presentation, and everything about review in artifact_moderation —
-- both 1:1, both optional (a missing row means "all defaults").
--
-- Access columns deliberately stay here: `visibility` is filtered in the list WHERE
-- clause and pairs with `owner_id`/`workspace_id` in two composite indexes, which a
-- satellite table could not carry.
CREATE TABLE IF NOT EXISTS artifacts (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    slug          TEXT NOT NULL UNIQUE,
    display_slug  TEXT,
    artifact_type TEXT NOT NULL DEFAULT 'html'
      CHECK (artifact_type IN ('html', 'csv', 'txt', 'markdown', 'json', 'pdf', 'image', 'video')),
    type_metadata TEXT,
    description   TEXT,
    owner_id      TEXT REFERENCES users(id),
    workspace_id  TEXT REFERENCES workspaces(id),
    folder_id     TEXT REFERENCES folders(id),
    is_example    INTEGER NOT NULL DEFAULT 0,
    paused        INTEGER NOT NULL DEFAULT 0,

    -- access
    visibility        TEXT NOT NULL DEFAULT 'public',
    auth_method       TEXT DEFAULT 'google',
    password_hash     TEXT,
    access_policy     TEXT,
    allow_anon_write  INTEGER NOT NULL DEFAULT 0,
    allow_anon_email  INTEGER NOT NULL DEFAULT 0,
    allow_anon_agent  INTEGER NOT NULL DEFAULT 0,
    allow_anon_collab INTEGER NOT NULL DEFAULT 0,

    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_artifacts_deleted_at ON artifacts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_folder ON artifacts(folder_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_owner_visibility ON artifacts(owner_id, visibility);
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_artifacts_visibility_workspace ON artifacts(visibility, workspace_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_workspace_folder ON artifacts(workspace_id, folder_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_artifacts_display_personal ON artifacts(owner_id, display_slug)
  WHERE workspace_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_artifacts_display_ws ON artifacts(workspace_id, display_slug)
  WHERE workspace_id IS NOT NULL AND deleted_at IS NULL;

-- artifact_presentation
-- How the artifact looks when it is linked, embedded or installed: social card, PWA
-- manifest, thumbnail, embedding rules. Read on the serve path and nowhere else.
-- No row = every default below.
CREATE TABLE IF NOT EXISTS artifact_presentation (
  artifact_id            TEXT PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
  social_title           TEXT,
  social_description     TEXT,
  social_image_url       TEXT,
  thumbnail_ext          TEXT,
  thumbnail_generated_at TEXT,
  pwa_config             TEXT,
  has_mobile             INTEGER NOT NULL DEFAULT 0,
  embed_allowed          INTEGER NOT NULL DEFAULT 1,
  embed_origins          TEXT,
  editor_readiness       TEXT,
  auto_summary_hash      TEXT
);
CREATE INDEX IF NOT EXISTS idx_artifact_presentation_mobile
  ON artifact_presentation(has_mobile) WHERE has_mobile = 1;

-- artifact_moderation
-- Review state. Only non-'approved' rows are interesting, and most artifacts never
-- get a row at all — a missing row reads as approved.
CREATE TABLE IF NOT EXISTS artifact_moderation (
  artifact_id       TEXT PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'approved',
  reason            TEXT,
  checked_at        TEXT,
  content_hash      TEXT,
  held_visibility   TEXT
);
CREATE INDEX IF NOT EXISTS idx_artifact_moderation_status
  ON artifact_moderation(status) WHERE status != 'approved';

-- versions
CREATE TABLE IF NOT EXISTS versions (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    version_no INTEGER NOT NULL,
    entrypoint TEXT NOT NULL,
    manifest_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), mobile_entrypoint TEXT,
    UNIQUE(artifact_id, version_no)
);
CREATE INDEX IF NOT EXISTS idx_versions_artifact ON versions(artifact_id);

-- deployments
CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    version_id TEXT NOT NULL REFERENCES versions(id),
    channel TEXT NOT NULL DEFAULT 'production',
    slug TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(artifact_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_deployments_artifact_channel
ON deployments(artifact_id, channel);
CREATE INDEX IF NOT EXISTS idx_deployments_slug_channel
ON deployments(slug, channel);

-- artifact_tags
CREATE TABLE IF NOT EXISTS artifact_tags (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(artifact_id, label)
);
CREATE INDEX IF NOT EXISTS idx_artifact_tags_artifact ON artifact_tags(artifact_id);
CREATE INDEX IF NOT EXISTS idx_artifact_tags_label ON artifact_tags(label);

-- artifact_drafts
CREATE TABLE IF NOT EXISTS artifact_drafts (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    html_content TEXT NOT NULL,
    assets_json TEXT,                -- JSON array of asset references
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(artifact_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_drafts_artifact ON artifact_drafts(artifact_id);
CREATE INDEX IF NOT EXISTS idx_drafts_updated ON artifact_drafts(updated_at);
CREATE INDEX IF NOT EXISTS idx_drafts_user ON artifact_drafts(user_id);

-- artifact_storage
CREATE TABLE IF NOT EXISTS artifact_storage (
    artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
    used_bytes INTEGER NOT NULL DEFAULT 0,
    blob_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- artifact_libraries
CREATE TABLE IF NOT EXISTS artifact_libraries (
  artifact_id         TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, -- consumer
  library_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, -- the module
  semver              TEXT NOT NULL,   -- pinned version
  position            INTEGER NOT NULL DEFAULT 0,
  pinned_by           TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (artifact_id, library_artifact_id)
);
CREATE INDEX IF NOT EXISTS idx_artifact_libraries_consumer ON artifact_libraries(artifact_id, position);
CREATE INDEX IF NOT EXISTS idx_artifact_libraries_module ON artifact_libraries(library_artifact_id);

-- library_versions
CREATE TABLE IF NOT EXISTS library_versions (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  semver      TEXT NOT NULL,
  version_no  INTEGER NOT NULL,   -- artifacts/versions.version_no holding this semver
  main_path   TEXT NOT NULL,      -- the module JS file path within that version
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (artifact_id, semver)
);

-- artifact_perf
CREATE TABLE IF NOT EXISTS artifact_perf (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  fcp INTEGER,
  lcp INTEGER,
  dcl INTEGER,
  ttfb INTEGER,
  visitor_hash TEXT,
  country TEXT
);
CREATE INDEX IF NOT EXISTS idx_artifact_perf_artifact_ts
  ON artifact_perf (artifact_id, created_at DESC);

-- artifact_agent_config
CREATE TABLE IF NOT EXISTS artifact_agent_config (
    artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
    -- Visitor chat settings
    visitor_enabled INTEGER DEFAULT 0,
    visitor_system_prompt TEXT,
    visitor_model TEXT DEFAULT 'claude-sonnet-4-20250514',
    visitor_max_tokens INTEGER DEFAULT 4096,
    visitor_temperature REAL DEFAULT 0.7,
    visitor_context_json INTEGER DEFAULT 1,
    visitor_context_tables TEXT,
    visitor_context_blobs INTEGER DEFAULT 0,
    -- Admin settings
    admin_enabled INTEGER DEFAULT 1,
    admin_model TEXT DEFAULT 'claude-sonnet-4-20250514',
    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, pilot_enabled INTEGER NOT NULL DEFAULT 0);

-- favorites
CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(artifact_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_artifact ON favorites(artifact_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);

-- user_recent_views
CREATE TABLE IF NOT EXISTS user_recent_views (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  viewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, artifact_id)
);
CREATE INDEX IF NOT EXISTS idx_recent_views_user ON user_recent_views(user_id, viewed_at DESC);

-- share_links
CREATE TABLE IF NOT EXISTS share_links (
  id              TEXT PRIMARY KEY,            -- lnk_*
  presentation_id TEXT NOT NULL,
  artifact_id     TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  recipient_label TEXT,                        -- "Acme Corp", "John @ Globex"
  gate            TEXT NOT NULL DEFAULT 'none',-- 'none' | 'email' | 'password' | 'domain'
  gate_value      TEXT,                        -- password hash, or comma-separated allowed domains
  expires_at      TEXT,
  max_views       INTEGER,                     -- null = unlimited
  created_by      TEXT,
  created_at      TEXT NOT NULL,
  revoked         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_share_links_pres ON share_links(presentation_id, created_at DESC);


-- ==========================================================================
-- 04. Data connections
-- Live data sources, their cached results, and the secrets used to reach them.
-- ==========================================================================

-- datasets
CREATE TABLE IF NOT EXISTS datasets (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    format TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    metadata JSON,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(artifact_id, name)
);
CREATE INDEX IF NOT EXISTS idx_datasets_artifact ON datasets(artifact_id);

-- connections
-- Every way this instance reaches an outside system, at either scope: an artifact's
-- own connector, or one shared across a workspace. `kind` splits the two families the
-- product exposes — 'generic' is a queryable data source (SQL warehouse, API),
-- 'platform' is an OAuth app connection (Slack, Sheets, GitHub, BigQuery).
--
-- Credentials live inline: one AES-GCM blob in `encrypted_credentials` with its own
-- `iv`. The blob holds the whole credential object — access token, refresh token and
-- expiry together — because a second blob would need a second iv, and storing two
-- ciphertexts against one iv is how the old artifact_sheets_tokens table silently
-- lost every refresh token.
--
-- `credential_scope='per_user'` means the shared blob is empty and each member's own
-- credentials live in connection_user_credentials, keyed by (connection_id, user_id).
CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('artifact','workspace')),
    scope_id TEXT NOT NULL,                 -- artifact id | workspace id
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'generic' CHECK (kind IN ('platform','generic')),
    provider TEXT NOT NULL,                 -- postgres | bigquery | slack | google_sheets | github | …
    auth_type TEXT,                         -- oauth | api_key | basic | …
    config TEXT NOT NULL DEFAULT '{}',
    encrypted_credentials TEXT,             -- NULL until connected, and for per_user rows
    iv TEXT,
    expires_at TEXT,                        -- access-token expiry, when the provider gives one
    preferred_mode TEXT NOT NULL DEFAULT 'auto' CHECK (preferred_mode IN ('direct','proxy','auto')),
    cache_ttl_seconds INTEGER NOT NULL DEFAULT 300,
    rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
    is_private INTEGER NOT NULL DEFAULT 0,  -- workspace scope: hide from other members
    credential_scope TEXT NOT NULL DEFAULT 'shared' CHECK (credential_scope IN ('shared','per_user')),
    agent_query_enabled INTEGER NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(scope_type, scope_id, name)
);
CREATE INDEX IF NOT EXISTS idx_connections_scope ON connections(scope_type, scope_id, kind);
CREATE INDEX IF NOT EXISTS idx_connections_provider ON connections(provider);

-- connection_cache
CREATE TABLE IF NOT EXISTS connection_cache (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    query_hash TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    row_count INTEGER,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(connection_id, query_hash)
);
CREATE INDEX IF NOT EXISTS idx_cache_connection ON connection_cache(connection_id);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON connection_cache(expires_at);

-- Connection credentials are inline on `connections`: one encrypted blob per row.

-- Workspace-shared connectors are `connections` rows with scope_type='workspace'.

-- connection_usage
-- Which artifacts reach through which connection, for the "who uses this" panel.
CREATE TABLE IF NOT EXISTS connection_usage (
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  artifact_id   TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  last_used_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  use_count     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (connection_id, artifact_id)
);

-- connection_user_credentials
-- One member's own credentials for a connection whose credential_scope is 'per_user'.
CREATE TABLE IF NOT EXISTS connection_user_credentials (
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_credentials TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (connection_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_connection_user_credentials_user
  ON connection_user_credentials(user_id);

-- workspace_shared_tables
CREATE TABLE IF NOT EXISTS workspace_shared_tables (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  shared_name TEXT NOT NULL,
  owner_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  source_table_name TEXT NOT NULL,
  access TEXT NOT NULL DEFAULT 'read' CHECK (access IN ('read', 'readwrite')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id, shared_name)
);
CREATE INDEX IF NOT EXISTS idx_workspace_shared_tables_owner ON workspace_shared_tables(owner_artifact_id);
CREATE INDEX IF NOT EXISTS idx_workspace_shared_tables_workspace ON workspace_shared_tables(workspace_id);

-- sheet_syncs
-- A Google Sheet wired to an artifact table, with its schedule and last-run state.
-- Named a sync, not a connection: it holds no credentials (the artifact's Sheets
-- OAuth row in `connections` does) — it is the definition of what syncs where.
CREATE TABLE IF NOT EXISTS sheet_syncs (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL,
    name TEXT NOT NULL,
    spreadsheet_id TEXT NOT NULL,
    sheet_name TEXT,
    target_table TEXT NOT NULL,
    sync_direction TEXT NOT NULL DEFAULT 'import',
    sync_schedule TEXT,
    last_synced_at TEXT,
    row_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), last_notified_stale_at TEXT,
    FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,
    UNIQUE(artifact_id, name)
);
CREATE INDEX IF NOT EXISTS idx_sheet_syncs_artifact ON sheet_syncs(artifact_id);
CREATE INDEX IF NOT EXISTS idx_sheet_syncs_schedule ON sheet_syncs(sync_schedule) WHERE sync_schedule IS NOT NULL;

-- sheets_sync_log
CREATE TABLE IF NOT EXISTS sheets_sync_log (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    status TEXT NOT NULL,
    rows_affected INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (connection_id) REFERENCES sheet_syncs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sync_log_connection ON sheets_sync_log(connection_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_started ON sheets_sync_log(started_at);

-- Artifact OAuth app connections are `connections` rows, scope_type='artifact',
-- kind='platform'. Sheets and GitHub tokens live there too, one row per provider.

-- artifact_secrets
CREATE TABLE IF NOT EXISTS artifact_secrets (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  allowed_hosts TEXT NOT NULL,      -- JSON array of allowed hostnames
  allowed_methods TEXT NOT NULL,    -- JSON array: ["GET", "POST", etc.]
  allowed_paths TEXT NOT NULL,      -- JSON array of glob patterns
  credentials_id TEXT,
  injection_type TEXT NOT NULL,     -- 'bearer' | 'basic' | 'header' | 'query'
  injection_config TEXT,            -- JSON: { headerName, queryParam, prefix }
  rate_limit_rpm INTEGER DEFAULT 60,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(artifact_id, name)
);
CREATE INDEX IF NOT EXISTS idx_artifact_secrets_name ON artifact_secrets(artifact_id, name);

-- artifact_secret_credentials
CREATE TABLE IF NOT EXISTS artifact_secret_credentials (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  encrypted_data TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_secret_credentials_artifact ON artifact_secret_credentials(artifact_id);

-- secret_audit_log
CREATE TABLE IF NOT EXISTS secret_audit_log (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  secret_name TEXT NOT NULL,
  method TEXT NOT NULL,
  host TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER,
  error TEXT,
  execution_time_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_secret_audit_artifact ON secret_audit_log(artifact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_secret_audit_name ON secret_audit_log(artifact_id, secret_name, created_at);

-- artifact_proxy_config
CREATE TABLE IF NOT EXISTS artifact_proxy_config (
    artifact_id TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 1,
    allowed_hosts TEXT,
    blocked_hosts TEXT,
    cache_ttl INTEGER DEFAULT 300,
    max_requests_per_minute INTEGER DEFAULT 100,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_proxy_config_artifact ON artifact_proxy_config(artifact_id);

-- Sheets and GitHub artifact tokens are `connections` rows (provider='google_sheets'
-- / 'github', auth_type='oauth'), the token object in `encrypted_credentials`.



-- ==========================================================================
-- 05. Comments & editor
-- Review threads on artifacts and the collaborative editing session state.
-- ==========================================================================

-- artifact_comments
CREATE TABLE IF NOT EXISTS artifact_comments (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    context_id TEXT,
    parent_id TEXT REFERENCES artifact_comments(id) ON DELETE CASCADE,
    author_id TEXT,
    author_name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, resolved INTEGER NOT NULL DEFAULT 0, resolved_by TEXT, resolved_at TEXT, position TEXT, state TEXT, mentions TEXT, author_type TEXT NOT NULL DEFAULT 'human', assignee_user_id TEXT, assignee_email TEXT, due_at TEXT);
CREATE INDEX IF NOT EXISTS idx_comments_assignee ON artifact_comments(assignee_user_id, resolved, due_at);
CREATE INDEX IF NOT EXISTS idx_comments_context ON artifact_comments(artifact_id, context_id);
CREATE INDEX IF NOT EXISTS idx_comments_created ON artifact_comments(artifact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON artifact_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_resolved ON artifact_comments(artifact_id, resolved);

-- comment_reactions
CREATE TABLE IF NOT EXISTS comment_reactions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reactions_comment ON comment_reactions(comment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_unique ON comment_reactions(comment_id, user_id, emoji);

-- comment_reads
CREATE TABLE IF NOT EXISTS comment_reads (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, artifact_id)
);

-- artifact_docs
CREATE TABLE IF NOT EXISTS artifact_docs (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    snapshot BLOB,
    snapshot_sv BLOB,
    update_count INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(artifact_id, name)
);
CREATE INDEX IF NOT EXISTS idx_artifact_docs_artifact ON artifact_docs(artifact_id);

-- artifact_doc_updates
CREATE TABLE IF NOT EXISTS artifact_doc_updates (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL REFERENCES artifact_docs(id) ON DELETE CASCADE,
    update_data BLOB NOT NULL,
    client_id TEXT,
    seq INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_doc_updates_seq ON artifact_doc_updates(doc_id, seq);

-- artifact_pending_edits
CREATE TABLE IF NOT EXISTS artifact_pending_edits (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    original_content TEXT,
    new_content TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected')),
    applied_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pending_edits_artifact ON artifact_pending_edits(artifact_id, status);

-- editor_sessions
CREATE TABLE IF NOT EXISTS editor_sessions (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_name TEXT,
    user_avatar TEXT,
    user_color TEXT,
    cursor_x REAL,
    cursor_y REAL,
    selected_element TEXT,           -- CSS selector of selected element
    last_active TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(artifact_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON editor_sessions(artifact_id, last_active);

-- Editor chat history is `agent_threads` / `agent_messages` rows with
-- scope_type='editor' (section 07), one thread per (artifact, author).

-- editor_pending_changes
CREATE TABLE IF NOT EXISTS editor_pending_changes (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_context_id TEXT,
    change_type TEXT NOT NULL,       -- 'patches' | 'full_replace'
    change_data TEXT NOT NULL,       -- JSON with patches or full HTML
    status TEXT DEFAULT 'pending',   -- 'pending' | 'applied' | 'rejected'
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_artifact ON editor_pending_changes(artifact_id, user_id);
CREATE INDEX IF NOT EXISTS idx_pending_status ON editor_pending_changes(status);


-- ==========================================================================
-- 06. Slides & presentations
-- Slide decks built from artifacts, plus live presenter state and viewing telemetry.
-- ==========================================================================

-- slides
CREATE TABLE IF NOT EXISTS slides (
    id TEXT PRIMARY KEY,
    presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,

    -- Optional per-slide owner
    owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,

    -- Override cascading properties (NULL = inherit from presentation)
    override_background TEXT,
    override_fonts JSON,
    override_transition JSON,

    -- The canvas - raw HTML content
    content TEXT NOT NULL DEFAULT '',

    -- Metadata
    hidden INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,

    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_slides_position ON slides(presentation_id, position);

-- slide_notes
CREATE TABLE IF NOT EXISTS slide_notes (
    id TEXT PRIMARY KEY,
    slide_id TEXT NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(slide_id)
);
CREATE INDEX IF NOT EXISTS idx_slide_notes_slide ON slide_notes(slide_id);

-- presentations
CREATE TABLE IF NOT EXISTS presentations (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Untitled Presentation',
    description TEXT,

    -- Cascading properties (inherited by slides unless overridden)
    width INTEGER NOT NULL DEFAULT 1920,
    height INTEGER NOT NULL DEFAULT 1080,
    aspect_ratio TEXT NOT NULL DEFAULT '16:9',
    template TEXT,

    -- Default fonts (JSON)
    default_fonts JSON DEFAULT '{"heading":"Inter","body":"Inter","mono":"JetBrains Mono"}',

    -- Default colors (JSON)
    default_colors JSON DEFAULT '{"background":"#0f172a","text":"#f8fafc","accent":"#3b82f6"}',

    -- Default transition (JSON)
    default_transition JSON DEFAULT '{"type":"fade","duration":300}',

    -- Published state
    published_artifact_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'unlisted', 'private')),

    -- Ownership
    created_by TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_presentations_created ON presentations(artifact_id, created_at);

-- presentation_state
CREATE TABLE IF NOT EXISTS presentation_state (
    presentation_id TEXT PRIMARY KEY REFERENCES presentations(id) ON DELETE CASCADE,
    is_presenting INTEGER NOT NULL DEFAULT 0,
    presenter_id TEXT,
    current_slide_index INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, presenter_name TEXT, slide_started_at TEXT, countdown_total INTEGER, countdown_remaining INTEGER, countdown_paused INTEGER DEFAULT 0, laser_enabled INTEGER DEFAULT 0, laser_x REAL, laser_y REAL);

-- presentation_versions
CREATE TABLE IF NOT EXISTS presentation_versions (
    id TEXT PRIMARY KEY,
    presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,

    -- Snapshot data (JSON containing all slides state)
    snapshot JSON NOT NULL,
    slide_count INTEGER NOT NULL DEFAULT 0,

    -- Who created this version
    created_by_id TEXT,
    created_by_name TEXT,

    -- Auto-save vs manual
    is_auto_save INTEGER NOT NULL DEFAULT 0,

    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_versions_created ON presentation_versions(presentation_id, created_at);

-- slide_views
CREATE TABLE IF NOT EXISTS slide_views (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  presentation_id TEXT NOT NULL,
  slide_id        TEXT,
  slide_index     INTEGER NOT NULL,
  entered_at      TEXT NOT NULL,
  dwell_ms        INTEGER NOT NULL DEFAULT 0,
  UNIQUE(session_id, slide_index)
);
CREATE INDEX IF NOT EXISTS idx_slide_views_pres ON slide_views(presentation_id, slide_index);
CREATE INDEX IF NOT EXISTS idx_slide_views_session ON slide_views(session_id);


-- ==========================================================================
-- 07. Agents, crews & skills
-- Agent conversations, the crew runtime that executes them, and the skill marketplace.
-- ==========================================================================

-- agent_threads
-- Every AI conversation in the product, whichever surface it happens on:
-- an artifact's visitor or admin chat, a workspace/home assistant thread, or the
-- editor's chat with the artifact author. `scope_key` is the artifact id for the
-- artifact and editor scopes, and the workspace (or personal sentinel) for the
-- workspace one. `user_id` is NULL only for anonymous visitors, who are identified
-- by `session_id` instead. Token totals are maintained by the artifact surfaces;
-- the others leave them at zero.
CREATE TABLE IF NOT EXISTS agent_threads (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('artifact_visitor','artifact_admin','workspace','editor')),
    scope_key TEXT NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT,                        -- anonymous visitor session
    title TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    total_input_tokens INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_threads_scope ON agent_threads(scope_type, scope_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_threads_user ON agent_threads(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_threads_session ON agent_threads(scope_key, session_id);
-- The editor keeps exactly one thread per (artifact, author) — the workspace and
-- artifact surfaces may have many, so this is a partial index, not a table constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_threads_editor
  ON agent_threads(scope_key, user_id) WHERE scope_type = 'editor';

-- agent_messages
-- One row per message. `suggested_edits`/`applied_at` are used by the artifact admin
-- and editor surfaces, where the assistant proposes changes the human can apply.
CREATE TABLE IF NOT EXISTS agent_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    suggested_edits TEXT,
    applied_at TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    model TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_thread ON agent_messages(thread_id, created_at);

-- agent_usage
CREATE TABLE IF NOT EXISTS agent_usage (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('visitor', 'admin', 'crew', 'pilot')),
    period TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    request_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(artifact_id, mode, period)
);
CREATE INDEX IF NOT EXISTS idx_agent_usage_artifact ON agent_usage(artifact_id, period);

-- agent_usage_events
CREATE TABLE IF NOT EXISTS agent_usage_events (
  id                     TEXT PRIMARY KEY,
  workspace_id           TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  artifact_id            TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  conversation_id        TEXT,
  mode                   TEXT NOT NULL CHECK (mode IN ('visitor','admin','crew','pilot')),
  provider               TEXT NOT NULL,
  model                  TEXT NOT NULL,
  input_tokens           INTEGER NOT NULL DEFAULT 0,
  output_tokens          INTEGER NOT NULL DEFAULT 0,
  base_cost_micro_usd    INTEGER NOT NULL DEFAULT 0,
  billed_cost_micro_usd  INTEGER NOT NULL DEFAULT 0,
  byo                    INTEGER NOT NULL DEFAULT 0,
  crew_id                TEXT,
  run_id                 TEXT,
  trigger_kind           TEXT,
  tool_name              TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_usage_events_artifact
  ON agent_usage_events(artifact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_usage_events_run
  ON agent_usage_events(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_usage_events_workspace
  ON agent_usage_events(workspace_id, created_at);

-- The visitor-agent request and token ceilings are rows in `rate_limits`
-- (section 01), principal_type='artifact', actions 'agent_requests'/'agent_tokens'.

-- The workspace/home assistant's threads and messages are `agent_threads` /
-- `agent_messages` rows with scope_type='workspace' (section 07).

-- crews
CREATE TABLE IF NOT EXISTS crews (
  id                    TEXT PRIMARY KEY,
  artifact_id           TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  workspace_id          TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  TEXT,
  instructions          TEXT,
  model                 TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  status                TEXT NOT NULL DEFAULT 'active',   -- active | paused | disabled
  -- hard safety rails (required, not tuning knobs)
  max_iterations        INTEGER NOT NULL DEFAULT 8,
  max_tokens_per_call   INTEGER NOT NULL DEFAULT 4096,
  run_budget_micro_usd  INTEGER NOT NULL DEFAULT 250000,  -- $0.25 / run
  max_runtime_ms        INTEGER NOT NULL DEFAULT 25000,   -- under the 30s Worker wall
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_crews_artifact ON crews(artifact_id);

-- crew_runs
CREATE TABLE IF NOT EXISTS crew_runs (
  id                  TEXT PRIMARY KEY,
  crew_id             TEXT NOT NULL,
  artifact_id         TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  trigger_kind        TEXT NOT NULL DEFAULT 'manual',
  initiated_by        TEXT,                         -- owner user id for manual runs
  status              TEXT NOT NULL,                -- running | done | error
  termination_reason  TEXT,                         -- goal_met | max_iterations |
                                                    -- budget_exhausted | timeout | error
  input_json          TEXT,
  result_text         TEXT,                         -- finish-tool summary
  iterations          INTEGER NOT NULL DEFAULT 0,
  token_input         INTEGER NOT NULL DEFAULT 0,
  token_output        INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd      INTEGER NOT NULL DEFAULT 0,
  started_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_crew_runs_artifact ON crew_runs(artifact_id, started_at);
CREATE INDEX IF NOT EXISTS idx_crew_runs_crew ON crew_runs(crew_id, started_at);

-- crew_run_events
CREATE TABLE IF NOT EXISTS crew_run_events (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  crew_id       TEXT NOT NULL,                      -- the attributed principal
  seq           INTEGER NOT NULL,
  event_type    TEXT NOT NULL,                      -- model_start | reasoning | tool_call |
                                                    -- tool_result | error | finish
  tool_name     TEXT,
  input_json    TEXT,                               -- redacted
  output_json   TEXT,                               -- redacted / truncated
  token_input   INTEGER,
  token_output  INTEGER,
  latency_ms    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_crew_run_events_run ON crew_run_events(run_id, seq);

-- crew_triggers
CREATE TABLE IF NOT EXISTS crew_triggers (
  id              TEXT PRIMARY KEY,
  crew_id         TEXT NOT NULL,
  artifact_id     TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,            -- cron | event  (condition = Phase 3)
  cron            TEXT,                     -- when kind=cron
  event_type      TEXT,                     -- when kind=event (e.g. table.row.inserted)
  condition_json  TEXT,                     -- reserved for Phase 3
  enabled         INTEGER NOT NULL DEFAULT 1,
  -- Scheduler cursor, not a timestamp for humans: unix seconds as TEXT, compared and
  -- advanced numerically by the dispatch loop (and by the compare-and-swap claim in
  -- crew_triggers). Deliberately not ISO — see CONVENTIONS.md § Timestamps.
  next_run_at     TEXT,
  last_run_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_crew_triggers_crew
  ON crew_triggers(crew_id);
CREATE INDEX IF NOT EXISTS idx_crew_triggers_due
  ON crew_triggers(kind, enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_crew_triggers_event
  ON crew_triggers(artifact_id, kind, event_type, enabled);

-- crew_grants
CREATE TABLE IF NOT EXISTS crew_grants (
  crew_id          TEXT NOT NULL,
  tool_name        TEXT NOT NULL,
  mode             TEXT NOT NULL,                  -- read | write (Phase 0: read only)
  enabled          INTEGER NOT NULL DEFAULT 0,
  approval_policy  TEXT NOT NULL DEFAULT 'never',  -- never | always | whenPublic (Phase 2)
  limits_json      TEXT,                           -- {"maxRows":500,"maxCalls":5,...}
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (crew_id, tool_name)
);

-- crew_action_approvals
CREATE TABLE IF NOT EXISTS crew_action_approvals (
  id            TEXT PRIMARY KEY,                 -- appr_*
  crew_id       TEXT NOT NULL,
  run_id        TEXT NOT NULL,
  artifact_id   TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  tool_name     TEXT NOT NULL,
  input_json    TEXT NOT NULL,                    -- the captured action input
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | executed | failed
  result_json   TEXT,                             -- executor result or error
  decided_by    TEXT,                             -- owner user id
  decided_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_crew_approvals_artifact ON crew_action_approvals(artifact_id, status);
CREATE INDEX IF NOT EXISTS idx_crew_approvals_run ON crew_action_approvals(run_id);

-- plan_crew_limits
CREATE TABLE IF NOT EXISTS plan_crew_limits (
  plan                          TEXT PRIMARY KEY,   -- free | pro | team | enterprise
  max_crews_per_artifact        INTEGER NOT NULL,
  max_concurrent_runs           INTEGER NOT NULL,
  default_run_budget_micro_usd  INTEGER NOT NULL,
  max_iterations_cap            INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- skill_marketplace
CREATE TABLE IF NOT EXISTS skill_marketplace (
  artifact_id   TEXT PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category      TEXT,
  upvote_count  INTEGER NOT NULL DEFAULT 0,
  install_count INTEGER NOT NULL DEFAULT 0,   -- save-to-library
  attach_count  INTEGER NOT NULL DEFAULT 0,   -- # artifacts this skill is attached to
  use_count     INTEGER NOT NULL DEFAULT 0,   -- display-only, per-conversation deduped
  score         REAL    NOT NULL DEFAULT 0,   -- decay-free 'top' score, recomputed on events
  blocked       INTEGER NOT NULL DEFAULT 0,   -- admin moderation
  featured      INTEGER NOT NULL DEFAULT 0,   -- admin curation
  published_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, official INTEGER NOT NULL DEFAULT 0, content_hash TEXT, official_rank INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_skill_market_official ON skill_marketplace(official, official_rank)
  WHERE official = 1;
CREATE INDEX IF NOT EXISTS idx_skill_market_rank ON skill_marketplace(workspace_id, score DESC, published_at DESC, artifact_id DESC);
CREATE INDEX IF NOT EXISTS idx_skill_market_ws_cat ON skill_marketplace(workspace_id, category);

-- skill_installs
CREATE TABLE IF NOT EXISTS skill_installs (
  artifact_id  TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (artifact_id, user_id)
);

-- skill_uses
CREATE TABLE IF NOT EXISTS skill_uses (
  skill_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  conversation_id   TEXT NOT NULL,
  used_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (skill_artifact_id, conversation_id)
);

-- skill_votes
CREATE TABLE IF NOT EXISTS skill_votes (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (artifact_id, user_id)
);

-- artifact_skills
CREATE TABLE IF NOT EXISTS artifact_skills (
  artifact_id       TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, -- target
  skill_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, -- the skill
  skill_version_no  INTEGER NOT NULL,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,   -- denormalized: loader re-asserts same-workspace
  attached_by       TEXT,
  position          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (artifact_id, skill_artifact_id)
);
CREATE INDEX IF NOT EXISTS idx_artifact_skills_skill ON artifact_skills(skill_artifact_id);
CREATE INDEX IF NOT EXISTS idx_artifact_skills_target ON artifact_skills(artifact_id, position);

-- workspace_agent_skills
CREATE TABLE IF NOT EXISTS workspace_agent_skills (
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,   -- real workspace id, or '__personal'
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  skill_version_no  INTEGER NOT NULL,
  position          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, user_id, skill_artifact_id)
);
CREATE INDEX IF NOT EXISTS idx_was_scope ON workspace_agent_skills(workspace_id, user_id, position);


-- ==========================================================================
-- 08. Scheduled jobs
-- Cron- and event-triggered jobs, their run history, and per-step traces.
-- ==========================================================================

-- scheduled_jobs
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  schedule TEXT NOT NULL,
  config TEXT NOT NULL,
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  last_status TEXT CHECK (last_status IN ('success', 'failed', 'pending')),
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  backoff_type TEXT NOT NULL DEFAULT 'fixed',
  initial_delay INTEGER NOT NULL DEFAULT 300,
  trigger_type TEXT NOT NULL DEFAULT 'cron',
  event_type TEXT
, title TEXT, description TEXT);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_artifact ON scheduled_jobs(artifact_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_event ON scheduled_jobs(artifact_id, event_type) WHERE trigger_type = 'event' AND enabled = 1;
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run ON scheduled_jobs(next_run_at) WHERE enabled = 1;
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_owner ON scheduled_jobs(owner_id);

-- job_runs
-- One execution of a scheduled job. `created_at` here is unix seconds as TEXT, not
-- ISO — the scheduler writes Math.floor(Date.now()/1000) and every reader compares it
-- that way (see CONVENTIONS.md § Timestamps — the one documented exception).
CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  duration_ms INTEGER,
  error TEXT,
  response_data TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_runs_created ON job_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job_id);

-- job_run_steps
CREATE TABLE IF NOT EXISTS job_run_steps (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
  job_id      TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  step        TEXT NOT NULL,          -- fetch | transform | deliver | <free-form>
  status      TEXT NOT NULL,          -- success | failed
  duration_ms INTEGER,
  detail_json TEXT,                   -- { target, rowCount, httpStatus, error, ... }
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_job_run_steps_run ON job_run_steps(run_id, seq);

-- Per-user scheduling ceilings are rows in `rate_limits` (section 01),
-- actions 'schedule:email' / 'schedule:webhook' / 'schedule:job'.

-- webhook_log
CREATE TABLE IF NOT EXISTS webhook_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  subscription_id TEXT,
  rebill_id TEXT,
  detail TEXT,
  status_code INTEGER NOT NULL DEFAULT 200
);
CREATE INDEX IF NOT EXISTS idx_webhook_log_ts ON webhook_log(created_at DESC);


-- ==========================================================================
-- 09. Analytics & audit
-- Raw view events, their rollups, and the operational/audit logs.
-- ==========================================================================

-- analytics_events
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('view', 'asset', 'data_api')),
  visitor_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_agent TEXT,
  referrer TEXT,
  country TEXT,
  path TEXT,
  metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_artifact_day ON analytics_events(artifact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_timestamp ON analytics_events(created_at);

-- analytics_daily
CREATE TABLE IF NOT EXISTS analytics_daily (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  unique_visitors INTEGER NOT NULL DEFAULT 0,
  top_referrers TEXT,
  top_countries TEXT,
  top_paths TEXT,
  UNIQUE(artifact_id, date)
);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_artifact ON analytics_daily(artifact_id);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_date ON analytics_daily(date);

-- analytics_agg_state
CREATE TABLE IF NOT EXISTS analytics_agg_state (
  date TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL
);

-- analytics_agg_cursor
CREATE TABLE IF NOT EXISTS analytics_agg_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  date TEXT NOT NULL,
  last_artifact_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- artifact_view_totals
CREATE TABLE IF NOT EXISTS artifact_view_totals (
  artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
  views INTEGER NOT NULL DEFAULT 0,
  unique_visitors INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

-- view_sessions
CREATE TABLE IF NOT EXISTS view_sessions (
  id              TEXT PRIMARY KEY,            -- ses_*
  presentation_id TEXT NOT NULL,
  artifact_id     TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  viewer_id       TEXT,                        -- set if gated/known (P1)
  viewer_email    TEXT,                        -- captured at gate (P1)
  link_id         TEXT,                        -- tracked link used (P1)
  ip_hash         TEXT,                        -- hashed, never raw
  user_agent      TEXT,
  country         TEXT,                        -- request.cf.country
  started_at      TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  completed       INTEGER NOT NULL DEFAULT 0,  -- reached final slide
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  slides_seen     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_view_sessions_artifact ON view_sessions(artifact_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_view_sessions_pres ON view_sessions(presentation_id, started_at DESC);

-- viewer_view_events
CREATE TABLE IF NOT EXISTS viewer_view_events (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  viewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  path TEXT
);
CREATE INDEX IF NOT EXISTS idx_viewer_view_events_artifact_email
  ON viewer_view_events(artifact_id, email);
CREATE INDEX IF NOT EXISTS idx_viewer_view_events_artifact_viewed_at
  ON viewer_view_events (artifact_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_viewer_view_events_viewed_at
  ON viewer_view_events(viewed_at);

-- funnel_events
CREATE TABLE IF NOT EXISTS funnel_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL,          -- view | focus | keystroke | chip | submit
    mode TEXT,                    -- business | personal
    sid TEXT,                     -- anonymous client id (localStorage)
    label TEXT,                   -- e.g. starter chip label
    meta TEXT,                    -- JSON blob (e.g. submit typed/len)
    country TEXT,                 -- cf country, coarse
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_funnel_events_event ON funnel_events(event);
CREATE INDEX IF NOT EXISTS idx_funnel_events_sid ON funnel_events(sid);
CREATE INDEX IF NOT EXISTS idx_funnel_events_ts ON funnel_events(created_at);

-- health_metrics_hourly
CREATE TABLE IF NOT EXISTS health_metrics_hourly (
    hour TEXT PRIMARY KEY,              -- UTC hour bucket 'YYYY-MM-DDTHH'
    requests INTEGER NOT NULL DEFAULT 0,
    status_2xx INTEGER NOT NULL DEFAULT 0,
    status_3xx INTEGER NOT NULL DEFAULT 0,
    status_4xx INTEGER NOT NULL DEFAULT 0,
    status_5xx INTEGER NOT NULL DEFAULT 0,
    exceptions INTEGER NOT NULL DEFAULT 0,
    dur_sum_ms INTEGER NOT NULL DEFAULT 0,   -- sum of handler durations (for avg)
    dur_max_ms INTEGER NOT NULL DEFAULT 0,   -- slowest request this hour
    b_le_100 INTEGER NOT NULL DEFAULT 0,     -- latency histogram buckets (ms)
    b_le_300 INTEGER NOT NULL DEFAULT 0,
    b_le_1000 INTEGER NOT NULL DEFAULT 0,
    b_le_3000 INTEGER NOT NULL DEFAULT 0,
    b_gt_3000 INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

-- ops_error_log
CREATE TABLE IF NOT EXISTS ops_error_log (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    status INTEGER NOT NULL,
    outcome TEXT NOT NULL,             -- 'http_error' (5xx) | 'exception'
    method TEXT,
    route TEXT,
    path TEXT,
    request_id TEXT,
    message TEXT,
    country TEXT
);
CREATE INDEX IF NOT EXISTS idx_ops_error_log_ts ON ops_error_log(created_at DESC);

-- audit_log
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_workspace_ts ON audit_log(workspace_id, created_at DESC);


-- ==========================================================================
-- 10. Metrics, alerts & watches
-- User-defined metrics over artifact data and the alerting built on top.
-- ==========================================================================

-- artifact_metric_definitions
CREATE TABLE IF NOT EXISTS artifact_metric_definitions (
  id            TEXT PRIMARY KEY,
  artifact_id   TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  workspace_id  TEXT REFERENCES workspaces(id) ON DELETE CASCADE,                 -- team scope; NULL = personal (owner default space)
  metric_id     TEXT NOT NULL,        -- stable key referenced by rules (e.g. "revenue")
  label         TEXT NOT NULL,
  format        TEXT,                 -- display hint: "currency:USD" | "number" | "percent"
  source_json   TEXT NOT NULL,        -- MetricSource: json_path | table_count | table_aggregate
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(artifact_id, metric_id)
);
CREATE INDEX IF NOT EXISTS idx_metric_defs_artifact
  ON artifact_metric_definitions(artifact_id);

-- metric_alert_rules
CREATE TABLE IF NOT EXISTS metric_alert_rules (
  id                   TEXT PRIMARY KEY,
  artifact_id          TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  workspace_id         TEXT REFERENCES workspaces(id) ON DELETE CASCADE,            -- inherited from the artifact; NULL = personal
  metric_id            TEXT NOT NULL,
  owner_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- creator (the user a delivery acts on behalf of)
  name                 TEXT NOT NULL,
  condition_json       TEXT NOT NULL,   -- { op, value }
  schedule             TEXT NOT NULL,   -- cron (5-field)
  destination_kind     TEXT NOT NULL,   -- slack | email | discord | webhook | http_get
  destination_config   TEXT NOT NULL,   -- JSON, validated by the destination registry
  message              TEXT,            -- optional author note appended to the alert
  cooldown_seconds     INTEGER NOT NULL DEFAULT 86400,
  next_run_at          TEXT NOT NULL,
  last_evaluated_at    TEXT,
  last_value           REAL,
  last_triggered_at    TEXT,
  last_triggered_value REAL,
  last_status          TEXT,            -- ok | matched | delivered | failed
  last_error           TEXT,
  enabled              INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, on_trigger_json TEXT);
CREATE INDEX IF NOT EXISTS idx_metric_alert_rules_artifact
  ON metric_alert_rules(artifact_id);
CREATE INDEX IF NOT EXISTS idx_metric_alert_rules_due
  ON metric_alert_rules(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_metric_alert_rules_owner
  ON metric_alert_rules(owner_id);

-- metric_alert_runs
-- One evaluation of an alert rule — written on every run, matched or not, errors
-- included. It is a run ledger, not a notification: the owner-facing rows live in
-- `notifications`.
CREATE TABLE IF NOT EXISTS metric_alert_runs (
  id                TEXT PRIMARY KEY,
  rule_id           TEXT NOT NULL,
  artifact_id       TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  metric_id         TEXT NOT NULL,
  evaluated_at      TEXT NOT NULL,
  value             REAL,
  matched           INTEGER NOT NULL DEFAULT 0,
  delivered         INTEGER NOT NULL DEFAULT 0,
  destination_kind  TEXT,
  error             TEXT,
  message           TEXT
, threshold REAL, delivery_detail TEXT);
CREATE INDEX IF NOT EXISTS idx_metric_alert_runs_rule
  ON metric_alert_runs(rule_id, evaluated_at);

-- metric_watches
CREATE TABLE IF NOT EXISTS metric_watches (
  id             TEXT PRIMARY KEY,
  artifact_id    TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  workspace_id   TEXT REFERENCES workspaces(id) ON DELETE CASCADE,                       -- inherited from the artifact; NULL = personal
  created_by     TEXT NOT NULL,
  table_name     TEXT NOT NULL,
  metric_kind    TEXT NOT NULL,              -- count | sum | last
  column_name    TEXT NOT NULL DEFAULT '',   -- '' for count; the numeric column for sum/last
  threshold_pct  REAL NOT NULL DEFAULT 20,
  last_value     REAL,
  last_checked_at  TEXT,
  last_alerted_at  TEXT,
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(artifact_id, table_name, metric_kind, column_name)
);
CREATE INDEX IF NOT EXISTS idx_metric_watches_artifact ON metric_watches(artifact_id);
CREATE INDEX IF NOT EXISTS idx_metric_watches_sweep ON metric_watches(enabled);

-- notifications
-- "The system needs to tell someone something." Five surfaces used to each own a
-- private events table; this is the one they share. `recipient_type` says who the
-- row is addressed to: a user, a workspace, or an *artifact* — meaning whoever can
-- already see that artifact, which is how the artifact-scoped notices have always
-- been targeted. `subject_*` points at what the notice is about, when that differs
-- from the recipient. `payload` carries the kind-specific extras.
--
-- Dismissals are NOT here: `home_event_dismissals` covers every kind of row the
-- "Needs you" surface can show (comments, failed runs, alerts), not just these.
CREATE TABLE IF NOT EXISTS notifications (
  id             TEXT PRIMARY KEY,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('user','workspace','artifact')),
  recipient_id   TEXT NOT NULL,
  kind           TEXT NOT NULL,     -- metric_watch | stale_data | unused_artifacts | moderation
  subject_type   TEXT,              -- artifact | connection | watch
  subject_id     TEXT,
  message        TEXT,              -- ready-to-render line, when the emitter builds one
  payload        TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON notifications(recipient_type, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_kind
  ON notifications(kind, created_at DESC);


-- ==========================================================================
-- 11. Email & messaging
-- Inbound/outbound email plus the chat-platform links (Telegram, etc).
-- ==========================================================================

-- artifact_emails
CREATE TABLE IF NOT EXISTS artifact_emails (
  artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
  email_prefix TEXT UNIQUE NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  reply_to TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  emails_sent_today INTEGER NOT NULL DEFAULT 0,
  last_reset_date TEXT NOT NULL DEFAULT (date('now'))
, inbound_enabled INTEGER NOT NULL DEFAULT 0, inbound_enabled_at TEXT, inbound_allowlist TEXT, inbound_received_today INTEGER NOT NULL DEFAULT 0, inbound_last_reset_date TEXT NOT NULL DEFAULT (date('now')));
CREATE INDEX IF NOT EXISTS idx_artifact_emails_inbound ON artifact_emails(email_prefix) WHERE inbound_enabled = 1;
CREATE INDEX IF NOT EXISTS idx_artifact_emails_owner ON artifact_emails(owner_id);
CREATE INDEX IF NOT EXISTS idx_artifact_emails_prefix ON artifact_emails(email_prefix);

-- email_log
CREATE TABLE IF NOT EXISTS email_log (
  type    TEXT NOT NULL,
  key     TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (type, key)
);

-- email_templates
CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY,
  artifact_id TEXT REFERENCES artifacts(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text_body TEXT,
  variables_schema TEXT NOT NULL DEFAULT '{"variables":[]}',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(artifact_id, owner_id, name)
);
CREATE INDEX IF NOT EXISTS idx_email_templates_artifact ON email_templates(artifact_id) WHERE artifact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_templates_owner ON email_templates(owner_id) WHERE artifact_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_templates_system ON email_templates(is_system) WHERE is_system = 1;

-- email_preferences
CREATE TABLE IF NOT EXISTS email_preferences (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,           -- 'product' | 'commercial' | 'marketing'
  opted_in   INTEGER NOT NULL,        -- 0 | 1
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, category)
);

-- email_suppressions
CREATE TABLE IF NOT EXISTS email_suppressions (
  email      TEXT PRIMARY KEY,        -- lowercased
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,                    -- nullable: external recipients have none
  reason     TEXT NOT NULL,           -- 'bounce' | 'complaint' | 'unsubscribe'
  kind       TEXT,                    -- e.g. 'hard' | 'soft' | 'spam'
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_email_suppressions_user ON email_suppressions(user_id);

-- Telegram links are rows in `messaging_links`: platform='telegram',
-- session_key = platform_user_id = the Telegram chat id.

-- messaging_links
CREATE TABLE IF NOT EXISTS messaging_links (
  platform              TEXT NOT NULL,
  session_key           TEXT NOT NULL,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform_user_id      TEXT,
  team_id               TEXT,
  selected_workspace_id TEXT,
  linked_at             TEXT NOT NULL, connection_name TEXT,
  PRIMARY KEY (platform, session_key)
);
CREATE INDEX IF NOT EXISTS idx_messaging_links_platform_user ON messaging_links(platform, platform_user_id);
CREATE INDEX IF NOT EXISTS idx_messaging_links_user ON messaging_links(user_id);

-- ai_usage_events
-- Non-LLM AI usage measured in units, not tokens: audio seconds for transcription and
-- so on, account-level and with no artifact. Deliberately NOT merged into
-- `agent_usage_events`: they share only workspace_id, model and base_cost_micro_usd —
-- five of these eight columns have no counterpart there, and that table requires an
-- artifact_id every row here lacks.
CREATE TABLE IF NOT EXISTS ai_usage_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,                                  -- null for personal-scope usage
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,                                       -- who triggered it (account-level surfaces)
  kind TEXT NOT NULL,                                 -- e.g. 'whisper_transcribe'
  model TEXT NOT NULL,                                -- e.g. '@cf/openai/whisper-large-v3-turbo'
  units REAL NOT NULL DEFAULT 0,                      -- amount consumed (audio seconds for Whisper)
  unit_kind TEXT NOT NULL,                            -- e.g. 'audio_seconds'
  base_cost_micro_usd INTEGER NOT NULL DEFAULT 0,     -- computed raw cost (micro-USD), tracking only
  source TEXT,                                        -- surface that triggered it, e.g. 'telegram'
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_kind
  ON ai_usage_events(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_user
  ON ai_usage_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_workspace
  ON ai_usage_events(workspace_id, created_at);


-- ==========================================================================
-- 13. Assets, blobs & knowledge
-- Uploaded files: raw blobs, curated asset collections, delivery, and the knowledge index.
-- ==========================================================================

-- assets
CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL REFERENCES versions(id),
    path TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    mime TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(version_id, path)
);
CREATE INDEX IF NOT EXISTS idx_assets_version ON assets(version_id);

-- asset_buckets
CREATE TABLE IF NOT EXISTS asset_buckets (
  artifact_id  TEXT PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_buckets_owner
  ON asset_buckets(owner_id) WHERE workspace_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_buckets_ws
  ON asset_buckets(workspace_id) WHERE workspace_id IS NOT NULL;

-- asset_collections
CREATE TABLE IF NOT EXISTS asset_collections (
  id                 TEXT PRIMARY KEY,            -- col_*
  bucket_artifact_id TEXT NOT NULL,
  workspace_id       TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_asset_collections_bucket ON asset_collections(bucket_artifact_id);

-- asset_collection_items
CREATE TABLE IF NOT EXISTS asset_collection_items (
  collection_id  TEXT NOT NULL,
  deliverable_id TEXT NOT NULL,
  position       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (collection_id, deliverable_id)
);

-- asset_deliverables
CREATE TABLE IF NOT EXISTS asset_deliverables (
  id                 TEXT PRIMARY KEY,            -- dlv_*
  bucket_artifact_id TEXT NOT NULL,
  workspace_id       TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, visibility TEXT NOT NULL DEFAULT 'workspace', folder_id TEXT, deleted_at TEXT, type_metadata TEXT);
CREATE INDEX IF NOT EXISTS idx_asset_deliverables_bucket ON asset_deliverables(bucket_artifact_id);
CREATE INDEX IF NOT EXISTS idx_asset_deliverables_folder ON asset_deliverables(folder_id);

-- asset_share_links
CREATE TABLE IF NOT EXISTS asset_share_links (
  id            TEXT PRIMARY KEY,                 -- dlk_*
  collection_id TEXT NOT NULL,
  expires_at    TEXT,
  revoked       INTEGER NOT NULL DEFAULT 0,
  view_count    INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, gate TEXT NOT NULL DEFAULT 'none', gate_value TEXT);
CREATE INDEX IF NOT EXISTS idx_asset_share_links_collection ON asset_share_links(collection_id);

-- blobs
CREATE TABLE IF NOT EXISTS blobs (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, deliverable_id TEXT, version_no INTEGER);
CREATE INDEX IF NOT EXISTS idx_blobs_artifact ON blobs(artifact_id);
CREATE INDEX IF NOT EXISTS idx_blobs_deliverable ON blobs(deliverable_id);

-- blob_origins
CREATE TABLE IF NOT EXISTS blob_origins (
  blob_id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('email', 'chat', 'share_target')),
  sender TEXT,
  subject TEXT,
  body_text TEXT,
  email_message_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blob_origins_msg ON blob_origins(email_message_id);

-- blob_artifact_links
CREATE TABLE IF NOT EXISTS blob_artifact_links (
  blob_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blob_id, artifact_id)
);
CREATE INDEX IF NOT EXISTS idx_blob_artifact_links_artifact ON blob_artifact_links(artifact_id);

-- upload_tokens
-- One short-lived, single-use grant to write one R2 object, for both upload paths.
-- `kind` says which: a dataset upload names the dataset and its format, a blob upload
-- names the file, its MIME type and a size ceiling.
CREATE TABLE IF NOT EXISTS upload_tokens (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('dataset','blob')),
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    r2_key TEXT NOT NULL,
    dataset_name TEXT,                      -- kind='dataset'
    format TEXT,                            -- kind='dataset'
    filename TEXT,                          -- kind='blob'
    mime_type TEXT,                         -- kind='blob'
    max_size INTEGER,                       -- kind='blob'
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_upload_tokens_artifact ON upload_tokens(artifact_id);
CREATE INDEX IF NOT EXISTS idx_upload_tokens_expires ON upload_tokens(expires_at);

-- Catalog files are rows in `workspace_files` (section 02), namespace='catalog'.

-- catalog_settings
CREATE TABLE IF NOT EXISTS catalog_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- file_artifact_usage
CREATE TABLE IF NOT EXISTS file_artifact_usage (
  deliverable_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (deliverable_id, artifact_id)
);
CREATE INDEX IF NOT EXISTS idx_file_usage_artifact ON file_artifact_usage(artifact_id);
CREATE INDEX IF NOT EXISTS idx_file_usage_deliverable ON file_artifact_usage(deliverable_id);

-- Knowledge files are rows in `workspace_files` (section 02), namespace='knowledge'.
-- Note the default source differs per namespace: 'learned' here, 'manual' elsewhere —
-- writers pass it explicitly.

-- knowledge_ingest
CREATE TABLE IF NOT EXISTS knowledge_ingest (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  content_hash TEXT,                                  -- version id; hash-debounces re-learns
  reason TEXT NOT NULL,                               -- publish | ...
  queued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed_at TEXT,
  PRIMARY KEY (workspace_id, artifact_id, reason)
);

-- knowledge_settings
CREATE TABLE IF NOT EXISTS knowledge_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  last_consolidated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- knowledge_tombstones
CREATE TABLE IF NOT EXISTS knowledge_tombstones (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  forgotten_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, path)
);


-- ==========================================================================
-- 14. Moderation, support & tests
-- Abuse handling, publish approvals, support tickets, and artifact self-tests.
-- ==========================================================================

-- abuse_reports
CREATE TABLE IF NOT EXISTS abuse_reports (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  reporter_ip TEXT,
  category TEXT NOT NULL,        -- phishing | malware | csam | spam | copyright | other
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | actioned | dismissed
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_abuse_reports_artifact ON abuse_reports(artifact_id);
CREATE INDEX IF NOT EXISTS idx_abuse_reports_status ON abuse_reports(status) WHERE status = 'open';

-- Owner-facing moderation outcomes are `notifications` rows, kind='moderation'.

-- artifact_publish_approvals
CREATE TABLE IF NOT EXISTS artifact_publish_approvals (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL,
  requested_visibility TEXT NOT NULL,            -- 'public' | 'unlisted'
  content_hash TEXT NOT NULL,
  approvals_required INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',        -- 'pending' | 'approved' | 'rejected'
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pub_appr_artifact ON artifact_publish_approvals(artifact_id);
CREATE INDEX IF NOT EXISTS idx_pub_appr_ws_status ON artifact_publish_approvals(workspace_id, status);

-- artifact_publish_approval_voters
CREATE TABLE IF NOT EXISTS artifact_publish_approval_voters (
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',         -- 'pending' | 'approved' | 'rejected'
  decided_at TEXT,
  UNIQUE(approval_id, approver_id)
);
CREATE INDEX IF NOT EXISTS idx_pub_appr_voter_appr ON artifact_publish_approval_voters(approver_id, status);

-- tickets
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  requester_user_id TEXT,
  requester_email TEXT,
  channel TEXT NOT NULL,                 -- ui | skill | slack | telegram | email
  channel_ref TEXT,                      -- origin handle for reply routing (chat id, msg id, email addr)
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open | pending | resolved | closed
  priority TEXT,                         -- low | normal | high | urgent (set by triage)
  category TEXT,                         -- set by triage
  assignee_user_id TEXT,
  ai_draft TEXT,                         -- triage-proposed reply, never auto-sent
  ai_meta_json TEXT,                     -- raw triage output {category,priority,...}
  sla_due INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_msg_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets (assignee_user_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_requester ON tickets (requester_user_id, last_msg_at);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status, last_msg_at);
CREATE INDEX IF NOT EXISTS idx_tickets_workspace ON tickets (workspace_id, status, last_msg_at);

-- ticket_messages
CREATE TABLE IF NOT EXISTS ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  author TEXT NOT NULL,                  -- customer | staff | ai
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_thread ON ticket_messages (ticket_id, created_at);

-- artifact_tests
CREATE TABLE IF NOT EXISTS artifact_tests (
  artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  -- monitor: publish goes live immediately, tests run after, alert on fail.
  -- block: hold the new version on a candidate deployment, promote only on pass —
  -- but only once a passing baseline exists (else behaves as monitor, never dark).
  mode TEXT NOT NULL DEFAULT 'monitor' CHECK (mode IN ('monitor', 'block')),
  -- Active declarative spec (shareout.tests.json contents, JSON). The runner reads
  -- this rather than re-fetching the bundle from R2. Null = T1 smoke + policy only.
  spec TEXT,
  -- Last version_id that fully passed. BLOCK falls back to this; enabling BLOCK on an
  -- existing artifact grandfathers its current live version into this column.
  baseline_version_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- artifact_test_runs
CREATE TABLE IF NOT EXISTS artifact_test_runs (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version_id TEXT,
  trigger TEXT NOT NULL CHECK (trigger IN ('publish', 'manual', 'schedule')),
  mode TEXT NOT NULL DEFAULT 'monitor' CHECK (mode IN ('monitor', 'block')),
  -- running: in flight. passed/failed: assertions ran and (all|some) failed.
  -- errored: the harness itself failed (render null, session cap, timeout) — NEVER
  -- treated as a pass; alerted and never used to promote a version.
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'passed', 'failed', 'errored')),
  passed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  errored_count INTEGER NOT NULL DEFAULT 0,
  -- JSON array of per-test results: {name, tier, status, message, duration_ms}.
  -- Booleans/messages only — NEVER captured values, store contents, or page text.
  results TEXT,
  -- User id that triggered the run (audit). Null for scheduled.
  triggered_by TEXT,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_artifact_test_runs_artifact
  ON artifact_test_runs (artifact_id, started_at DESC);

-- platform_config
CREATE TABLE IF NOT EXISTS platform_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);


-- ==========================================================================
-- Seed data: none.
--
-- This file creates structure only. A fresh ShareOut instance needs no rows to run.
--
-- `plan_crew_limits` is the one table that might look like it wants seeding. It does
-- not: `src/crew/limits.ts` falls back to its FALLBACK constant for any tier with no
-- row, and ShareOut is free, so the fallback is the answer for everyone. Populate it
-- only if you are running your own tiers — see seeds/crew-limits.example.sql. It is a
-- spend ceiling, not a price list.
--
-- An earlier revision of this schema seeded four subscription plan rows carrying one
-- company's price list. That is the wrong default for a project other people install:
-- pricing is a business decision, not a schema constant.
-- ==========================================================================
