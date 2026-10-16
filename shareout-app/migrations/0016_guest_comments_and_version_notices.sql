-- Why: people reviewing through a public or password link can comment without an
-- account. A guest proves an email with a one-time code and comments under a name; the
-- comment keeps author_type 'guest' and a keyed hash of that email (never the address),
-- so the owner can tell guests apart and no reader can recover anyone's email.
-- The owner turns guests on per artifact (comments config) or for a whole folder here;
-- an artifact without its own setting inherits the nearest folder that has it on.

ALTER TABLE artifact_comments ADD COLUMN guest_email_hash TEXT;
ALTER TABLE folders ADD COLUMN guest_comments_enabled INTEGER NOT NULL DEFAULT 0;

-- Why: followers hear about new versions once publishing settles. An hourly sweep reads
-- the versions published in the last day; this index keeps that a range read.
CREATE INDEX IF NOT EXISTS idx_versions_created_at ON versions(created_at);
