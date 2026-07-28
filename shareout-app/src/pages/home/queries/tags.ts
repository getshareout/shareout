/**
 * Sidebar tag filter — distinct labels + counts for the active home context.
 */
import type { Env } from '../../../types';
import { getVisibilityScope, type VisibilityScope } from '../../../account-links';
import type { HomeTag } from '../types';
import { homeScopeSql, isLinkedWorkspaceMember } from '../filters';

/** Distinct tags + counts across the active context, for the sidebar tag filter. */
export async function queryHomeTags(
  env: Env,
  user: { id: string; email: string | null },
  workspace?: string | null,
  visArg?: VisibilityScope,
): Promise<HomeTag[]> {
  const vis = visArg ?? await getVisibilityScope(env, user);
  let workspaceId: string | null = null;
  if (workspace) {
    if (!(await isLinkedWorkspaceMember(env, vis, workspace))) return [];
    workspaceId = workspace;
  }
  const base = homeScopeSql(vis, workspaceId);
  const rows = await env.DB.prepare(`
    SELECT t.label as label, COUNT(DISTINCT a.id) as count
    FROM artifacts a
    JOIN artifact_tags t ON t.artifact_id = a.id
    ${base.join}
    WHERE ${base.where}
    GROUP BY t.label
    ORDER BY count DESC, t.label COLLATE NOCASE ASC
    LIMIT 50
  `).bind(...base.joinParams, ...base.whereParams).all<HomeTag>();
  return rows.results || [];
}
