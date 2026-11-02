-- AI usage is resold to a workspace — its invoices, the Usage tab, the monthly AI budget — at
-- cost × a markup the workspace never sees. Basis points, so 15000 = 1.5×. A workspace's own
-- value wins; NULL there falls back to the instance default; NULL on the instance means 10000
-- (at cost), which is what a self-hosted instance that does not resell wants.
-- workspace_llm_config.markup_multiplier (REAL, default 1.30) predates this and nothing reads it: its
-- default cannot tell "at cost on purpose" from "never set".
ALTER TABLE instance_ai_settings ADD COLUMN default_markup_bps INTEGER;
ALTER TABLE workspace_llm_config ADD COLUMN ai_markup_bps INTEGER;
