-- Why: publishing a draft started before someone else published silently reverted their
-- change. The editor now refuses that publish (409 STALE_BASE) by comparing the live
-- deployment with the live state the draft was built on, which needs its own column:
-- created_at keeps meaning "when this draft row was created".
-- Additive: nullable; an older draft without a base falls back to its created_at.

ALTER TABLE artifact_drafts ADD COLUMN base_live_at TEXT; -- deployments.updated_at of the live page this draft builds on; NULL = unknown
