-- 0044 kept only the LAST email a page's address bounced, so one stray mail (a newsletter, a
-- colleague's reply) hid the bounce the person was actually asking about ("I sent the report, why
-- didn't it arrive?"). This keeps the few most recent instead: a JSON array, newest first, at most 5
-- entries (src/email/inbox-store.ts INBOUND_REJECTIONS_KEPT), one entry per sender and reason — a
-- sender bounced again moves to the top with its count raised instead of taking another slot.
--   [{ "at": ISO 8601, "from": header From, "reason": not_allowed | unverified | too_large | rate_limited | inbox_off,
--      "count": n, "verified": bool, "hasFile": bool, "forwardedBy": the allowed mailbox that auto-forwarded it }]
-- The 0044 columns keep holding the newest one, so code without this column still reads it.
-- Additive: one nullable column, nothing rewritten.
ALTER TABLE artifact_emails ADD COLUMN inbound_rejections TEXT;
