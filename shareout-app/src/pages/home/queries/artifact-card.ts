/**
 * Shared SQL projection for home artifact cards (grid, For You, Recently Viewed, catalog).
 *
 * One definition instead of four copy-pasted SELECT blocks; owner name/picture come
 * from a single `users u` join rather than two correlated subqueries per row.
 * Requires `a` (artifacts), `c` (collaborators, via homeScopeSql's join or explicit)
 * and ARTIFACT_CARD_JOINS in the FROM clause.
 * Binds: userIds (user_role) then userIds (is_favorite).
 */

/** SELECT list for artifact card rows; `idPh` is a placeholders() string for user id IN clauses. */
export function artifactCardSelect(idPh: string): string {
  return `a.id, a.name, COALESCE(d.slug, a.slug) AS slug, a.display_slug, a.description, a.artifact_type, a.visibility, a.workspace_id, a.created_at, a.folder_id, a.is_example,
           COALESCE(mod_a.status, 'approved') AS moderation_status, mod_a.held_visibility AS moderation_held_visibility,
           d.updated_at,
           CASE WHEN a.owner_id IN (${idPh}) THEN 'owner' ELSE COALESCE(c.role, 'viewer') END as user_role,
           u.name as owner_name,
           u.picture as owner_picture,
           (SELECT COUNT(*) FROM favorites WHERE artifact_id = a.id AND user_id IN (${idPh})) as is_favorite,
           COALESCE(avt.views, 0) as total_views,
           COALESCE(avt.unique_visitors, 0) as unique_visitors,
           (SELECT EXISTS(SELECT 1 FROM blobs WHERE artifact_id = a.id)) as f_blobs,
           (SELECT EXISTS(SELECT 1 FROM datasets WHERE artifact_id = a.id)) as f_datasets,
           (SELECT EXISTS(SELECT 1 FROM connections WHERE scope_type = 'artifact' AND scope_id = a.id AND kind = 'generic')) as f_connections,
           (SELECT EXISTS(SELECT 1 FROM connections WHERE scope_type = 'artifact' AND scope_id = a.id AND kind = 'platform')) as f_platform,
           (SELECT EXISTS(SELECT 1 FROM scheduled_jobs WHERE artifact_id = a.id AND enabled = 1)) as f_jobs,
           (SELECT CASE WHEN visitor_enabled = 1 OR admin_enabled = 1 THEN 1 ELSE 0 END FROM artifact_agent_config WHERE artifact_id = a.id) as f_agent,
           (SELECT EXISTS(SELECT 1 FROM artifact_tests WHERE artifact_id = a.id AND enabled = 1)) as f_tests,
           (SELECT EXISTS(SELECT 1 FROM artifact_skills WHERE artifact_id = a.id)) as f_skills,
           (SELECT GROUP_CONCAT(label, char(10)) FROM artifact_tags WHERE artifact_id = a.id) as tags`;
}

/** Companion 1:1 joins for artifactCardSelect (users once, production deployment, view
 *  totals, moderation). LEFT throughout — a missing artifact_moderation row is the
 *  normal case and must not drop the artifact from the list. */
export const ARTIFACT_CARD_JOINS = `LEFT JOIN users u ON u.id = a.owner_id
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    LEFT JOIN artifact_view_totals avt ON avt.artifact_id = a.id
    LEFT JOIN artifact_moderation mod_a ON mod_a.artifact_id = a.id`;
