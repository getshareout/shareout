-- A page that updates its data by email bounces mail from anyone not on its list, mail it cannot
-- verify, mail that is too big, or mail past the daily limit (src/email/inbound.ts). The bounce
-- goes back to the sender only, so the page's owner (and an assistant) saw "no file has arrived
-- yet" while the person insisted they had sent it. The last bounce is kept so the "Update by
-- email" panel and check_email_sync can say who sent it and why it was not used.
--   inbound_rejected_at     — when the last email was bounced (ISO 8601)
--   inbound_rejected_from   — its From address, as written in the mail (shown to editors only)
--   inbound_rejected_reason — not_allowed | unverified | too_large | rate_limited | inbox_off
-- Additive: nullable columns only, nothing rewritten.
ALTER TABLE artifact_emails ADD COLUMN inbound_rejected_at TEXT;
ALTER TABLE artifact_emails ADD COLUMN inbound_rejected_from TEXT;
ALTER TABLE artifact_emails ADD COLUMN inbound_rejected_reason TEXT;
