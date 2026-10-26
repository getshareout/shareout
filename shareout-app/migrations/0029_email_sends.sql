-- Why: a crew emailed the same weekly report four hours in a row and nothing on the instance
-- recorded what had gone out, so "did this arrive twice?" could only be answered from the
-- recipient's inbox. One row per message per recipient, written by sendEmail. Crew sends also
-- read it to refuse an exact repeat (same artifact, recipient and subject within hours).
-- Rows outlive the artifact on purpose: it is a log. Additive: a new table, nothing altered.

CREATE TABLE IF NOT EXISTS email_sends (
  id          TEXT PRIMARY KEY,
  artifact_id TEXT,            -- NULL for platform mail (sign-in, invites, digests)
  recipient   TEXT NOT NULL,   -- lowercased
  subject     TEXT NOT NULL,
  source_kind TEXT NOT NULL,   -- crew | job | alert | page | system
  source_id   TEXT,            -- crew id, alert rule id, … when known
  status      TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped_duplicate')),
  error       TEXT,
  message_id  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_email_sends_artifact_recipient
  ON email_sends(artifact_id, recipient, created_at);
