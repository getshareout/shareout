-- Gmail asks the destination to confirm before it auto-forwards mail there: it emails the address a
-- link and a code. A page's address bounced that mail (Google is not on the page's list of senders),
-- so nobody ever saw the link and Gmail forwarding to a page could not be set up.
-- src/email/forwarding-confirm.ts now recognises a genuine confirmation (authenticated as google.com
-- by Cloudflare, from Google's forwarding sender, with a link on Google's own host), keeps only what
-- the page's editors need to finish the step, and shows it in the Update-by-email panel and over
-- check_email_sync. The mail itself is not stored and never becomes data.
--
-- At most 3 pending per page — over that, requesters not on the page's list are dropped first, so a
-- stranger's requests cannot push out the person's own — one per asking mailbox (a new request from
-- the same mailbox replaces the old one), gone after expires_at or once dismissed.
CREATE TABLE IF NOT EXISTS email_forward_confirmations (
  id           TEXT PRIMARY KEY,                                         -- efc_…
  artifact_id  TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, -- owned by the page
  provider     TEXT NOT NULL,                                            -- gmail
  requester    TEXT NOT NULL,                                            -- the mailbox asking to forward, e.g. ana@gmail.com
  code         TEXT,                                                     -- the provider's confirmation code, when it sends one
  confirm_url  TEXT NOT NULL,                                            -- https on the provider's own host only, checked on the way in
  expires_at   TEXT NOT NULL,
  opened_at    TEXT,                                                     -- an editor opened the link from the panel
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_email_forward_confirmations_artifact_requester
  ON email_forward_confirmations(artifact_id, requester);
