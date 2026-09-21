-- An invite that never reached its inbox used to look identical to one that did:
-- sendInviteEmail() dropped the dispatch result, so the API answered status:"invited"
-- whether Cloudflare accepted the message or rejected it. Admins had no way to tell,
-- and the only evidence was a Worker log line that does not exist for invites.
--
-- Record the delivery outcome on the claim row so the Members view can show it.
-- Nullable on purpose: rows minted before this migration have no outcome to report,
-- and the UI renders that as "unknown" rather than inventing a success.
ALTER TABLE workspace_invite_claims ADD COLUMN email_status TEXT;
ALTER TABLE workspace_invite_claims ADD COLUMN email_sent_at TEXT;
ALTER TABLE workspace_invite_claims ADD COLUMN email_error TEXT;
