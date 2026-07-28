/**
 * Home artifact grid queries — For You, Recently Viewed, paged grid, catalog, counts.
 */
import type { Env } from '../../../types';
import { getVisibilityScope, placeholders, type VisibilityScope } from '../../../account-links';
import type { ArtifactRow, HomeFilters } from '../types';
import { HOME_CATALOG_LIMIT, HOME_PAGE_SIZE, TYPE_GROUPS } from '../constants';
import { homeScopeSql, isLinkedWorkspaceMember } from '../filters';
import { type ActivityFeedOpts } from './shared';
import { artifactCardSelect, ARTIFACT_CARD_JOINS } from './artifact-card';

/**
 * "For You" relevance heuristic v1 (no ML): rank the user's visible artifacts by
 * shared-to-me + favorited + recency, excluding examples. The follows signal
 * (user_profiles) folds in later behind this same surface.
 */
export async function queryForYou(
  env: Env,
  user: { id: string; email: string | null },
  opts: ActivityFeedOpts = {},
  visArg?: VisibilityScope,
): Promise<ArtifactRow[]> {
  const vis = visArg ?? await getVisibilityScope(env, user);
  const workspaceId = opts.workspaceId ?? null;
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 50);
  const base = homeScopeSql(vis, workspaceId);
  const idPh = placeholders(vis.userIds.length);

  const rows = await env.DB.prepare(`
    SELECT ${artifactCardSelect(idPh)},
           ( (CASE WHEN a.owner_id NOT IN (${idPh}) THEN 3 ELSE 0 END)
           + (CASE WHEN EXISTS(SELECT 1 FROM favorites WHERE artifact_id = a.id AND user_id IN (${idPh})) THEN 2 ELSE 0 END)
           ) as relevance_score
    FROM artifacts a
    ${ARTIFACT_CARD_JOINS}
    ${base.join}
    WHERE ${base.where} AND a.is_example = 0
    GROUP BY a.id
    ORDER BY relevance_score DESC, COALESCE(d.updated_at, a.created_at) DESC
    LIMIT ?
  `).bind(...vis.userIds, ...vis.userIds, ...vis.userIds, ...vis.userIds, ...base.joinParams, ...base.whereParams, limit)
    .all<ArtifactRow>();

  return rows.results || [];
}

/** Record that a user opened an artifact (upsert viewed_at). Powers Recently Viewed. */
export async function recordRecentView(env: Env, userId: string, artifactId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_recent_views (user_id, artifact_id, viewed_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(user_id, artifact_id) DO UPDATE SET viewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).bind(userId, artifactId).run();
}

/**
 * Artifacts the user recently opened (owned or shared to them), newest first.
 * On the apex (no workspaceId) the scope is looser than homeScopeSql on purpose:
 * a viewed page may live in any workspace, so we gate on owner/collaborator across
 * all linked accounts. On a subdomain (workspaceId set) we pin to that workspace so
 * the view stays isolated to it.
 */
export async function queryRecentlyViewed(
  env: Env,
  user: { id: string; email: string | null },
  opts: ActivityFeedOpts = {},
  visArg?: VisibilityScope,
): Promise<ArtifactRow[]> {
  const vis = visArg ?? await getVisibilityScope(env, user);
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 50);
  const idPh = placeholders(vis.userIds.length);
  const emailPh = placeholders(vis.emails.length);
  const wsFilter = opts.workspaceId ? ' AND a.workspace_id = ?' : '';

  const rows = await env.DB.prepare(`
    SELECT ${artifactCardSelect(idPh)},
           MAX(v.viewed_at) as viewed_at
    FROM user_recent_views v
    JOIN artifacts a ON a.id = v.artifact_id AND a.deleted_at IS NULL
    ${ARTIFACT_CARD_JOINS}
    LEFT JOIN collaborators c ON c.artifact_id = a.id AND c.email IN (${emailPh})
    WHERE v.user_id IN (${idPh}) AND (a.owner_id IN (${idPh}) OR c.email IN (${emailPh}))${wsFilter}
    GROUP BY a.id
    ORDER BY viewed_at DESC
    LIMIT ?
  `).bind(...vis.userIds, ...vis.userIds, ...vis.emails, ...vis.userIds, ...vis.userIds, ...vis.emails, ...(opts.workspaceId ? [opts.workspaceId] : []), limit)
    .all<ArtifactRow>();

  return rows.results || [];
}

export async function queryHomeArtifacts(
  env: Env,
  user: { id: string; email: string | null },
  filters: HomeFilters,
  visArg?: VisibilityScope,
): Promise<{ artifacts: ArtifactRow[]; total: number; totalPages: number }> {
  const { page, search, sort, type, scope, workspace, folder, filesScope } = filters;
  const offset = (page - 1) * HOME_PAGE_SIZE;

  const vis = visArg ?? await getVisibilityScope(env, user);
  const idPh = placeholders(vis.userIds.length);

  // In a workspace, filesScope=personal shows the user's private artifacts (workspace_id IS NULL).
  let workspaceId: string | null = null;
  if (workspace && filesScope !== 'personal') {
    if (!(await isLinkedWorkspaceMember(env, vis, workspace))) {
      return { artifacts: [], total: 0, totalPages: 0 };
    }
    workspaceId = workspace;
  }
  const base = homeScopeSql(vis, workspaceId);

  let filterSql = '';
  const filterParams: unknown[] = [];
  if (search) {
    filterSql += ' AND (a.name LIKE ? OR EXISTS (SELECT 1 FROM artifact_tags t WHERE t.artifact_id = a.id AND t.label LIKE ?))';
    filterParams.push(`%${search}%`, `%${search}%`);
  }
  if (type && TYPE_GROUPS[type]) {
    const types = TYPE_GROUPS[type];
    filterSql += ` AND a.artifact_type IN (${types.map(() => '?').join(',')})`;
    filterParams.push(...types);
  }
  if (folder) {
    filterSql += ' AND a.folder_id = ?';
    filterParams.push(folder);
  }
  if (scope === 'shared') {
    filterSql += ` AND a.owner_id NOT IN (${idPh})`;
    filterParams.push(...vis.userIds);
  } else if (scope === 'owned') {
    filterSql += ` AND a.owner_id IN (${idPh})`;
    filterParams.push(...vis.userIds);
  } else if (scope === 'favorites') {
    filterSql += ` AND EXISTS (SELECT 1 FROM favorites fav WHERE fav.artifact_id = a.id AND fav.user_id IN (${idPh}))`;
    filterParams.push(...vis.userIds);
  }

  let orderBy = 'COALESCE(d.updated_at, a.created_at) DESC';
  if (sort === 'name') orderBy = 'a.name ASC';
  else if (sort === 'views') orderBy = 'total_views DESC, a.created_at DESC';
  else if (sort === 'oldest') orderBy = 'a.created_at ASC';

  const countResult = await env.DB.prepare(`
    SELECT COUNT(DISTINCT a.id) as total
    FROM artifacts a
    ${base.join}
    WHERE ${base.where}${filterSql}
  `).bind(...base.joinParams, ...base.whereParams, ...filterParams).first<{ total: number }>();

  const total = countResult?.total || 0;
  const totalPages = Math.ceil(total / HOME_PAGE_SIZE);

  const artifacts = await env.DB.prepare(`
    SELECT ${artifactCardSelect(idPh)}
    FROM artifacts a
    ${ARTIFACT_CARD_JOINS}
    ${base.join}
    WHERE ${base.where}${filterSql}
    GROUP BY a.id
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).bind(...vis.userIds, ...vis.userIds, ...base.joinParams, ...base.whereParams, ...filterParams, HOME_PAGE_SIZE, offset)
    .all<ArtifactRow>();

  return { artifacts: artifacts.results || [], total, totalPages };
}

/** Full artifact list for instant client-side filtering (capped). Optionally scoped
 *  to a workspace (membership-gated) so the same cache-and-filter strategy that makes
 *  personal artifacts instant also powers workspace switching. */
export async function queryHomeArtifactCatalog(
  env: Env,
  user: { id: string; email: string | null },
  workspace?: string | null,
  visArg?: VisibilityScope,
): Promise<{ artifacts: ArtifactRow[]; total: number; truncated: boolean }> {
  const vis = visArg ?? await getVisibilityScope(env, user);
  const idPh = placeholders(vis.userIds.length);

  let workspaceId: string | null = null;
  if (workspace) {
    if (!(await isLinkedWorkspaceMember(env, vis, workspace))) {
      return { artifacts: [], total: 0, truncated: false };
    }
    workspaceId = workspace;
  }
  const base = homeScopeSql(vis, workspaceId);

  // Probe one past the limit instead of a separate COUNT(DISTINCT) round-trip:
  // if we get LIMIT+1 rows the catalog is truncated. `total` is unused by callers
  // (the sidebar "all" count comes from queryHomeCounts), so we don't need an exact
  // count here — this drops the catalog from two D1 hops to one (opt: home TTFB).
  const rows = await env.DB.prepare(`
    SELECT ${artifactCardSelect(idPh)}
    FROM artifacts a
    ${ARTIFACT_CARD_JOINS}
    ${base.join}
    WHERE ${base.where}
    GROUP BY a.id
    ORDER BY COALESCE(d.updated_at, a.created_at) DESC
    LIMIT ?
  `).bind(...vis.userIds, ...vis.userIds, ...base.joinParams, ...base.whereParams, HOME_CATALOG_LIMIT + 1)
    .all<ArtifactRow>();

  const results = rows.results || [];
  const truncated = results.length > HOME_CATALOG_LIMIT;
  const artifacts = truncated ? results.slice(0, HOME_CATALOG_LIMIT) : results;
  return { artifacts, total: artifacts.length, truncated };
}

export async function queryHomeCounts(
  env: Env,
  user: { id: string; email: string | null },
  workspace?: string | null,
  visArg?: VisibilityScope,
): Promise<{ allCount: number; favCount: number; sharedCount: number }> {
  const vis = visArg ?? await getVisibilityScope(env, user);
  const idPh = placeholders(vis.userIds.length);
  let workspaceId: string | null = null;
  if (workspace) {
    if (!(await isLinkedWorkspaceMember(env, vis, workspace))) {
      return { allCount: 0, favCount: 0, sharedCount: 0 };
    }
    workspaceId = workspace;
  }
  const base = homeScopeSql(vis, workspaceId);

  const [allCountResult, favCountResult, sharedCountResult] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(DISTINCT a.id) as total,
             COUNT(DISTINCT CASE WHEN a.is_example = 0 THEN a.id END) as real_total
      FROM artifacts a
      ${base.join}
      WHERE ${base.where}
    `).bind(...base.joinParams, ...base.whereParams).first<{ total: number; real_total: number }>(),

    env.DB.prepare(`
      SELECT COUNT(DISTINCT a.id) as total
      FROM artifacts a
      JOIN favorites f ON f.artifact_id = a.id AND f.user_id IN (${idPh})
      ${base.join}
      WHERE ${base.where}
    `).bind(...vis.userIds, ...base.joinParams, ...base.whereParams).first<{ total: number }>(),

    env.DB.prepare(`
      SELECT COUNT(DISTINCT a.id) as total
      FROM artifacts a
      ${base.join}
      WHERE ${base.where} AND a.owner_id NOT IN (${idPh})
    `).bind(...base.joinParams, ...base.whereParams, ...vis.userIds).first<{ total: number }>(),
  ]);

  // Mirror the grid's example-hiding: once the user has real work, the "All"
  // count drops the examples (they live in the Examples folder). A brand-new user
  // whose only artifacts are examples still sees them counted.
  const realTotal = allCountResult?.real_total || 0;
  const allCount = realTotal > 0 ? realTotal : (allCountResult?.total || 0);

  return {
    allCount,
    favCount: favCountResult?.total || 0,
    sharedCount: sharedCountResult?.total || 0,
  };
}
