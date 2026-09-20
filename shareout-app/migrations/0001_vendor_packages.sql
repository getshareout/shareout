-- Why: the vendored-library allowlist (/vendor/<pkg>@<version>/<file>) ships as a
-- curated set of ~26 packages, which is the right default for the hosted instance and
-- the wrong one for everybody else. A self-hosted operator extends it instance-wide
-- with VENDOR_PACKAGES_EXTRA; this table is the other half — a workspace admin adding
-- the library their own artifacts need, without a fork or an env change.
--
-- Serving is instance-wide on purpose: /vendor is resolved before any artifact or
-- workspace is known, and the bytes are public npm code, not workspace data. What the
-- workspace scope controls is which packages publish will rewrite for that workspace's
-- artifacts, and who may manage the row.

CREATE TABLE IF NOT EXISTS vendor_packages (
    id TEXT PRIMARY KEY,
    package TEXT NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    added_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_vendor_packages_workspace_package
    ON vendor_packages(workspace_id, package);
CREATE INDEX IF NOT EXISTS idx_vendor_packages_package ON vendor_packages(package);
