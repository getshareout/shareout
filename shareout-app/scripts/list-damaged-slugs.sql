-- READ-ONLY, not run by anything. Lists artifact slugs that look like an accented letter was replaced by a dash
-- before slugs were transliterated ("gesti-n", "inducci-n", "a-o"): a 1-2 letter segment glued between longer
-- ones. Heuristic, expect false positives ("pg-08-a-b"). Existing slugs are NOT rewritten: their links may be
-- shared. Run per instance:
--   npx wrangler d1 execute <DB> --remote --file scripts/list-damaged-slugs.sql
SELECT w.slug AS workspace, a.display_slug, a.slug AS routing_slug, a.name
  FROM artifacts a
  LEFT JOIN workspaces w ON w.id = a.workspace_id
 WHERE a.deleted_at IS NULL
   AND (a.display_slug GLOB '*[a-z][a-z][a-z]-[a-z]-*' OR a.display_slug GLOB '*[a-z][a-z][a-z]-[a-z]'
        OR a.slug GLOB '*[a-z][a-z][a-z]-[a-z]-*' OR a.slug GLOB '*[a-z][a-z][a-z]-[a-z]')
 ORDER BY w.slug, a.display_slug;
