-- Why: workspaces get a monthly AI spend report with the full detail of every call, so
-- each metered model call keeps its input and output tokens apart (units stays their sum).
-- Null on rows written before this and on non-token usage (Whisper audio seconds).

ALTER TABLE ai_usage_events ADD COLUMN input_tokens INTEGER;
ALTER TABLE ai_usage_events ADD COLUMN output_tokens INTEGER;
