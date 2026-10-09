-- A support ticket used to carry only a subject and a body, so whoever answered it had
-- to ask "where were you, what were you doing, which page?" before they could help —
-- and an agent that retried a failed report opened the same ticket twice.
--
-- Record the context the reporter (person or agent) already has at hand, and let the
-- caller name an idempotency key so a retry returns the original ticket.
--
-- `category` already exists (triage used to own it); the reporter may now set it first,
-- and triage only fills it when it is still empty.
--   severity : low | normal | high | blocker
--   client   : ui | claude | chatgpt | mcp | api | slack | telegram | email | chat_agent
--   locale   : en | es — the language replies to the requester are written in
ALTER TABLE tickets ADD COLUMN severity TEXT;
ALTER TABLE tickets ADD COLUMN request_id TEXT;
ALTER TABLE tickets ADD COLUMN page_url TEXT;
ALTER TABLE tickets ADD COLUMN artifact_id TEXT;
ALTER TABLE tickets ADD COLUMN user_agent TEXT;
ALTER TABLE tickets ADD COLUMN client TEXT;
ALTER TABLE tickets ADD COLUMN idempotency_key TEXT;
ALTER TABLE tickets ADD COLUMN locale TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tickets_requester_idempotency_key
  ON tickets (requester_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
