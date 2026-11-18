-- Google Drive import through sharing (src/file-imports/service-account.ts). Each workspace
-- gets its own Google service account; people share a Drive folder with its email as
-- Viewer, and ShareOut reads it as that account. Isolation is Google's ACLs: one
-- workspace's token cannot open what was shared with another workspace's account.
-- Nothing here is secret: the accounts have no keys (one instance key impersonates them).

-- One service account per workspace. No FK to workspaces on purpose: when a workspace
-- is deleted this row must outlive it until the hourly sweep deletes the account at
-- Google, or the account would be orphaned there with every folder still shared to it.
CREATE TABLE IF NOT EXISTS file_import_service_accounts (
  workspace_id  TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,                                  -- the email's local part, so-<hex>
  project_id    TEXT NOT NULL,
  email         TEXT NOT NULL,
  unique_id     TEXT,                                           -- Google's numeric id, once created
  status        TEXT NOT NULL DEFAULT 'creating',               -- creating | ready
  created_by    TEXT,                                           -- attribution: the member who opened it
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_file_import_service_accounts_email ON file_import_service_accounts(email);

-- How a source reads its drive: 'oauth' through connection_id (a member's consent), or
-- 'service_account' through its workspace's account (connection_id stays NULL).
ALTER TABLE file_import_sources ADD COLUMN auth TEXT NOT NULL DEFAULT 'oauth';
