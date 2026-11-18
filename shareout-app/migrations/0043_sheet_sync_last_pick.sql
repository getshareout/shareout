-- The spreadsheet sync's drive.file consent remembers the last spreadsheet its person picked
-- in the Google Picker, in this workspace (src/file-imports/routes.ts handleSheetPick). An
-- assistant hands the person the pick link, the person picks in their own browser, and the
-- assistant reads the pick back from GET /v1/workspaces/{ws}/file-imports/sheet-sync to set
-- up the drive_file_sync schedule. Only on rows whose provider is the sheet consent; the
-- folder-import consents never set them.
--   picked_file_id   — the Drive file id Google returned in picked_file_ids
--   picked_file_name — its name in Drive at pick time (shown back to the person)
--   picked_at        — when it was picked
-- Additive: nullable columns only, nothing rewritten.
ALTER TABLE file_import_connections ADD COLUMN picked_file_id TEXT;
ALTER TABLE file_import_connections ADD COLUMN picked_file_name TEXT;
ALTER TABLE file_import_connections ADD COLUMN picked_at TEXT;
