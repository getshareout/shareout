-- Why: crew and scheduled artifact emails carried no unsubscribe, so a recipient's only way out was
-- "mark as spam", which suppresses ALL mail from the instance. This is a per-artifact opt-out: one
-- recipient stops hearing from one artifact, nothing else. Additive: a new table, nothing altered.

CREATE TABLE IF NOT EXISTS artifact_email_optouts (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,   -- lowercased
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (artifact_id, email)
);
