-- Why: the Vercel AI Gateway model was hardcoded (anthropic.ts's DEFAULT_GATEWAY_MODEL),
-- so changing it meant editing code and redeploying. This lets a workspace admin pick its
-- own model, and a superadmin set the instance-wide default, both from the gateway's live
-- catalog (GET /v1/ai/gateway-models) instead of a hardcoded list — NULL means "use the
-- next fallback" at both levels.

ALTER TABLE workspace_llm_config ADD COLUMN gateway_model TEXT;

CREATE TABLE IF NOT EXISTS instance_ai_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    default_gateway_model TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO instance_ai_settings (id) VALUES (1);
