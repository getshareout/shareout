/**
 * Home folder browser queries — personal, team, nested children, breadcrumbs.
 */
import type { Env } from '../../../types';
import { getVisibilityScope, placeholders, type VisibilityScope } from '../../../account-links';
import type { HomeFolder } from '../types';
import { isLinkedWorkspaceMember } from '../filters';

/** Folders directly inside a parent (or root, when parentId is null/undefined),
 *  scoped to a workspace (Team Space, admin-defined) or personal (workspace_id
 *  IS NULL, owner-scoped). Generalizes the former root-only queries so the
 *  browser API can drill into nested folders (parent_id already supports
 *  arbitrary depth; only root was ever queried before work/026). */
export async function queryFoldersInParent(
  env: Env,
  user: { id: string; email: string | null },
  opts: { workspaceId: string | null; parentId: string | null },
  visArg?: VisibilityScope,
): Promise<HomeFolder[]> {
  const vis = visArg ?? await getVisibilityScope(env, user);
  const parentSql = opts.parentId ? 'f.parent_id = ?' : 'f.parent_id IS NULL';
  if (opts.workspaceId) {
    if (!(await isLinkedWorkspaceMember(env, vis, opts.workspaceId))) return [];
    const params = opts.parentId ? [opts.workspaceId, opts.parentId] : [opts.workspaceId];
    const rows = await env.DB.prepare(`
      SELECT f.id, f.name,
             (SELECT COUNT(*) FROM artifacts WHERE folder_id = f.id AND deleted_at IS NULL) as artifact_count
      FROM folders f
      WHERE f.workspace_id = ? AND ${parentSql}
      ORDER BY artifact_count DESC, f.name
    `).bind(...params).all<HomeFolder>();
    return rows.results || [];
  }
  const idPh = placeholders(vis.userIds.length);
  const params = opts.parentId ? [...vis.userIds, opts.parentId] : [...vis.userIds];
  const rows = await env.DB.prepare(`
    SELECT f.id, f.name,
           (SELECT COUNT(*) FROM artifacts WHERE folder_id = f.id AND deleted_at IS NULL) as artifact_count
    FROM folders f
    WHERE f.workspace_id IS NULL AND f.owner_id IN (${idPh}) AND ${parentSql}
    ORDER BY artifact_count DESC, f.name
  `).bind(...params).all<HomeFolder>();
  return rows.results || [];
}

/** Personal folders (workspace_id IS NULL). Always private to the user. */
export async function queryPersonalFolders(
  env: Env,
  user: { id: string; email: string | null },
  visArg?: VisibilityScope,
): Promise<HomeFolder[]> {
  return queryFoldersInParent(env, user, { workspaceId: null, parentId: null }, visArg);
}

/** Team Space folders for a workspace (admin-defined shared structure). */
export async function queryTeamFolders(
  env: Env,
  user: { id: string; email: string | null },
  workspaceId: string,
  visArg?: VisibilityScope,
): Promise<HomeFolder[]> {
  return queryFoldersInParent(env, user, { workspaceId, parentId: null }, visArg);
}

/** A folder's README ("folder guide") markdown, scoped like queryFolderPath.
 *  null if the folder isn't found/owned/in-workspace or has no guide yet. */
export async function queryFolderReadme(
  env: Env,
  user: { id: string; email: string | null },
  opts: { workspaceId: string | null; folderId: string },
  visArg?: VisibilityScope,
): Promise<string | null> {
  const vis = visArg ?? await getVisibilityScope(env, user);
  const scopeSql = opts.workspaceId ? 'workspace_id = ?' : `workspace_id IS NULL AND owner_id IN (${placeholders(vis.userIds.length)})`;
  const scopeParams = opts.workspaceId ? [opts.workspaceId] : vis.userIds;
  const row = await env.DB.prepare(
    `SELECT readme FROM folders WHERE id = ? AND ${scopeSql}`
  ).bind(opts.folderId, ...scopeParams).first<{ readme: string | null }>();
  return row?.readme ?? null;
}

/** Root-to-current breadcrumb trail for a folder (arbitrary depth via parent_id),
 *  scoped the same way as queryFoldersInParent. Empty array if the folder isn't
 *  found/owned/in-workspace. */
export async function queryFolderPath(
  env: Env,
  user: { id: string; email: string | null },
  opts: { workspaceId: string | null; folderId: string },
  visArg?: VisibilityScope,
): Promise<{ id: string; name: string }[]> {
  const vis = visArg ?? await getVisibilityScope(env, user);
  const scopeSql = opts.workspaceId ? 'f.workspace_id = ?' : `f.workspace_id IS NULL AND f.owner_id IN (${placeholders(vis.userIds.length)})`;
  const scopeParams = opts.workspaceId ? [opts.workspaceId] : vis.userIds;
  const rows = await env.DB.prepare(`
    WITH RECURSIVE anc(id, name, parent_id, depth) AS (
      SELECT f.id, f.name, f.parent_id, 0 FROM folders f WHERE f.id = ? AND ${scopeSql}
      UNION ALL
      SELECT f.id, f.name, f.parent_id, anc.depth + 1
      FROM folders f JOIN anc ON f.id = anc.parent_id
      WHERE anc.depth < 32
    )
    SELECT id, name FROM anc ORDER BY depth DESC
  `).bind(opts.folderId, ...scopeParams).all<{ id: string; name: string }>();
  return rows.results || [];
}
