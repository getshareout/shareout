-- Folder import from Google Drive and OneDrive / SharePoint (src/file-imports). A team
-- connects a cloud drive with a consent that only reads files (separate from signing
-- in), picks a remote folder and a ShareOut folder, and a resumable job mirrors the tree
-- into workspace files. Re-runs only fetch what changed, which needs a ledger of what
-- each remote item became here — file_import_items is that ledger.

-- One person's file-read consent for one provider, inside one workspace. The whole token
-- set (access, refresh) is one AES-GCM blob with its own iv, like `connections`.
CREATE TABLE IF NOT EXISTS file_import_connections (
  id                    TEXT PRIMARY KEY,                               -- fic_*
  workspace_id          TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL,                                  -- FILE_IMPORT_PROVIDERS
  account_email         TEXT,
  scopes                TEXT,
  encrypted_credentials TEXT NOT NULL,
  iv                    TEXT NOT NULL,
  expires_at            TEXT,                                           -- access-token expiry
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_file_import_connections_owner
  ON file_import_connections(workspace_id, user_id, provider);

-- A remote folder mirrored into the workspace. Disconnecting nulls connection_id, which
-- stops every sync that read through it; the files already imported stay.
CREATE TABLE IF NOT EXISTS file_import_sources (
  id                 TEXT PRIMARY KEY,                                  -- fis_*
  workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id      TEXT REFERENCES file_import_connections(id) ON DELETE SET NULL,
  provider           TEXT NOT NULL,
  remote_drive_id    TEXT,                                              -- shared drive / Graph drive; NULL = My Drive
  remote_folder_id   TEXT NOT NULL,
  remote_name        TEXT NOT NULL,
  target_folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,    -- NULL = top level of Files
  convert_enabled    INTEGER NOT NULL DEFAULT 1,
  daily_sync_enabled INTEGER NOT NULL DEFAULT 0,
  next_sync_at       TEXT,
  last_run_id        TEXT,
  created_by         TEXT REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_file_import_sources_workspace ON file_import_sources(workspace_id);
-- The hourly sweep: daily sources that are due.
CREATE INDEX IF NOT EXISTS idx_file_import_sources_due
  ON file_import_sources(next_sync_at) WHERE daily_sync_enabled = 1;

-- One pass over a source, with the counts the progress view shows.
CREATE TABLE IF NOT EXISTS file_import_runs (
  id              TEXT PRIMARY KEY,                                     -- fir_*
  source_id       TEXT NOT NULL REFERENCES file_import_sources(id) ON DELETE CASCADE,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_trigger     TEXT NOT NULL DEFAULT 'manual',                       -- manual | resync | schedule
  status          TEXT NOT NULL DEFAULT 'queued',                       -- RUN_STATUSES
  found_count     INTEGER NOT NULL DEFAULT 0,
  imported_count  INTEGER NOT NULL DEFAULT 0,
  converted_count INTEGER NOT NULL DEFAULT 0,
  skipped_count   INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  stop_code       TEXT,
  stop_message    TEXT,
  started_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_file_import_runs_source ON file_import_runs(source_id, created_at);

-- Remote id → what it became here. `remote_version` is what the provider says now
-- (Drive modifiedTime, Graph cTag); `synced_version` is what was last imported, so a
-- re-run fetches a file only when the two differ.
CREATE TABLE IF NOT EXISTS file_import_items (
  source_id        TEXT NOT NULL REFERENCES file_import_sources(id) ON DELETE CASCADE,
  remote_id        TEXT NOT NULL,
  kind             TEXT NOT NULL,                                       -- folder | file
  parent_remote_id TEXT,
  name             TEXT NOT NULL,
  path             TEXT NOT NULL,
  depth            INTEGER NOT NULL DEFAULT 0,
  remote_mime      TEXT,
  remote_size      INTEGER,
  remote_version   TEXT,
  seen_run_id      TEXT,                                                -- last run whose walk saw it
  listed_run_id    TEXT,                                                -- folders: last run that listed it
  attempt_run_id   TEXT,                                                -- files: last run that processed it
  synced_version   TEXT,
  folder_id        TEXT,                                                -- folders: the mirrored ShareOut folder
  deliverable_id   TEXT,                                                -- files: the workspace file
  artifact_id      TEXT,                                                -- files: the converted page, if any
  artifact_slug    TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',                     -- pending | imported | skipped | failed
  error_code       TEXT,
  error_message    TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (source_id, remote_id)
);
-- The walk and import batches: this run's folders still to list, files still to fetch.
CREATE INDEX IF NOT EXISTS idx_file_import_items_seen ON file_import_items(source_id, seen_run_id, kind);
