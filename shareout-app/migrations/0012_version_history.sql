-- Why: the version history panel shows who made each version, how it was made and
-- what it restored, and a restore is a new version rather than a pointer move, so the
-- history keeps every step. Nullable: versions written before this carry no attribution.
-- created_by is attribution (no cascade); source is one of VERSION_SOURCES in
-- src/artifacts/versions.ts.

ALTER TABLE versions ADD COLUMN created_by TEXT REFERENCES users(id);
ALTER TABLE versions ADD COLUMN source TEXT;
ALTER TABLE versions ADD COLUMN message TEXT;
ALTER TABLE versions ADD COLUMN restored_from_version_id TEXT REFERENCES versions(id);
