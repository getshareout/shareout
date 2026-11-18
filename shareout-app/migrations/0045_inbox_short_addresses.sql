-- A page's inbox address comes from its slug (artifact_emails.email_prefix), so it can be long to
-- type or dictate: "ventas-del-mes-noviembre-2026@inbox…". Each page that receives mail also gets a
-- short one, "ventas.k7m4p2@inbox…": the first word of the slug, a dot, six random characters
-- (src/scheduling/email.ts newShortPrefix). Slugs and workspace slugs never contain a dot, so a short
-- address can never equal a long one or a workspace inbox, and the random part cannot be guessed.
-- The long address keeps working; the short one is the one shown.
--
-- A row is never deleted. When its page is purged, artifact_id becomes NULL and the address bounces
-- for good: no other page, in any workspace, can ever be handed a short address someone once used.
CREATE TABLE IF NOT EXISTS email_inbox_short_addresses (
  short_prefix TEXT PRIMARY KEY,                                  -- the local part, e.g. ventas.k7m4p2
  artifact_id  TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_email_inbox_short_addresses_artifact
  ON email_inbox_short_addresses(artifact_id) WHERE artifact_id IS NOT NULL;
