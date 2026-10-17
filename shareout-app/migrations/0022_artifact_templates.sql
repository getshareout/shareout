-- Why: something built for one workspace should install in another in one click. A
-- template is a frozen, scrubbed snapshot of an artifact or a folder of artifacts: the
-- files of the live version, type metadata, folder structure, and data bindings as
-- placeholders (table/dataset schemas, connector names). Never the source workspace's
-- data, credentials, comments, Knowledge or analytics. Bytes live in R2 under
-- templates/<id>/<version_no>/…; these rows hold metadata and the manifest.
-- scope is one of TEMPLATE_SCOPES in src/templates/types.ts (private | shared | instance);
-- only platform admins publish to 'instance'.

CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    scope TEXT NOT NULL DEFAULT 'private',
    name TEXT NOT NULL,
    description TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    source_kind TEXT NOT NULL,
    source_id TEXT,
    current_version_no INTEGER NOT NULL DEFAULT 0,
    preview_r2_key TEXT,
    preview_mime TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_templates_workspace ON templates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_templates_scope ON templates(scope);

-- One immutable row per published version. manifest_json is the TemplateManifest.
CREATE TABLE IF NOT EXISTS template_versions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    version_no INTEGER NOT NULL,
    version_label TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    notes TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(template_id, version_no)
);

-- scope 'shared': the extra workspaces that may see and install the template.
CREATE TABLE IF NOT EXISTS template_shares (
    template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (template_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_template_shares_workspace ON template_shares(workspace_id);

-- Which artifact came from which template item at which version. install_group ties
-- the artifacts of one install together so an update keeps their links consistent.
CREATE TABLE IF NOT EXISTS template_installs (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    install_group TEXT NOT NULL,
    item_key TEXT NOT NULL,
    version_no INTEGER NOT NULL,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    installed_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(artifact_id)
);
CREATE INDEX IF NOT EXISTS idx_template_installs_template ON template_installs(template_id);
CREATE INDEX IF NOT EXISTS idx_template_installs_group ON template_installs(install_group);
