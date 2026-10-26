-- Why: a page that goes private or into the trash can still be quoted by the topic, entity
-- and timeline notes and the workspace overview learned from it. Readers stop seeing those
-- notes at once; the nightly consolidator rebuilds them without the page. This column is how
-- a visibility change asks for that rebuild on the next run instead of the weekly sweep, and
-- the consolidator clears it once nothing is left to rebuild. NULL = nothing pending.
-- Existing rows start with a request (the epoch) so the first run after upgrading also
-- rewrites overviews learned before they listed their sources; a workspace that turns
-- Knowledge on later starts with one too, which costs it a no-op run.
-- Additive: one nullable column.

ALTER TABLE knowledge_settings ADD COLUMN rebuild_requested_at TEXT DEFAULT '1970-01-01T00:00:00.000Z';
