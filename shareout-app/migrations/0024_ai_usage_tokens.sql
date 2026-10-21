-- Why: workspaces get a monthly AI spend report with the full detail of every call, so
-- each metered model call keeps its input and output tokens apart (units stays their sum)
-- and says how its cost is known. Calls are written `pending`; the hourly reconcile sets
-- `actual` (the gateway's debited cost, looked up by `provider_ref`, the gateway generation
-- id), `estimate` (live catalog list price, for providers with no cost lookup) or
-- `unpriced` (model not in the catalog yet; retried).
-- All null on rows written before this and on non-token usage (Whisper audio seconds).

ALTER TABLE ai_usage_events ADD COLUMN input_tokens INTEGER;
ALTER TABLE ai_usage_events ADD COLUMN output_tokens INTEGER;
ALTER TABLE ai_usage_events ADD COLUMN cost_source TEXT;
ALTER TABLE ai_usage_events ADD COLUMN provider_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_cost_source ON ai_usage_events(cost_source, created_at);
