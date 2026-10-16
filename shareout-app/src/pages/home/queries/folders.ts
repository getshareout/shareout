/**
 * Home folder browser queries — personal, team, nested children, breadcrumbs.
 */
import type { Env } from '../../../types';
import { getVisibilityScope, placeholders, type VisibilityScope } from '../../../account-links';
import type { HomeFolder } from '../types';
import { isLinkedWorkspaceMember } from '../filters';
import { normalizeVisibility } from '../../../visibility-config';

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
      SELECT f.id, f.name, f.created_by,
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

export type FolderAccessLabel = 'private' | 'workspace' | 'public' | 'external';

export interface FolderAccessGrant {
  id: string;
  subject_type: string;
  subject_label: string;
  capability: string;
  folder_id: string;
  folder_name: string;
  inherited: boolean;
  expires_at: string | null;
}

export interface FolderAccess {
  visibility: string;
  effective: 'private' | 'workspace' | 'public';
  inheritedFrom: { id: string; name: string } | null;
  access: FolderAccessLabel;
  grants: FolderAccessGrant[];
}

/** Who can see a Team Space folder: its own visibility (`inherit` resolves from the
 *  nearest ancestor that sets one; none = workspace) plus the external grants on it and
 *  its ancestors, which canAccess inherits down the chain. null if not in this workspace. */
export async function queryFolderAccess(env: Env, workspaceId: string, folderId: string): Promise<FolderAccess | null> {
  const chain = (await env.DB.prepare(`
    WITH RECURSIVE anc(id, name, visibility, parent_id, depth) AS (
      SELECT f.id, f.name, f.visibility, f.parent_id, 0 FROM folders f WHERE f.id = ? AND f.workspace_id = ?
      UNION ALL
      SELECT f.id, f.name, f.visibility, f.parent_id, anc.depth + 1
      FROM folders f JOIN anc ON f.id = anc.parent_id
      WHERE anc.depth < 32
    )
    SELECT id, name, visibility FROM anc ORDER BY depth
  `).bind(folderId, workspaceId).all<{ id: string; name: string; visibility: string | null }>()).results || [];
  if (!chain.length) return null;

  const setBy = chain.find(f => f.visibility && f.visibility !== 'inherit');
  const resolved = setBy ? normalizeVisibility(setBy.visibility) : 'workspace';
  const effective = resolved === 'public' || resolved === 'private' ? resolved : 'workspace';
  const names = new Map(chain.map(f => [f.id, f.name]));

  const rows = (await env.DB.prepare(`
    SELECT g.id, g.subject_type, g.capability, g.resource_id, g.expires_at,
           COALESCE(u.email, s.name, g.subject_id) AS subject_label
      FROM grants g
      LEFT JOIN users u ON g.subject_type = 'external_user' AND u.id = g.subject_id
      LEFT JOIN sharees s ON g.subject_type = 'sharee' AND s.id = g.subject_id
     WHERE g.workspace_id = ? AND g.resource_type = 'folder'
       AND g.resource_id IN (${placeholders(chain.length)})
       AND (g.expires_at IS NULL OR g.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ORDER BY g.created_at
  `).bind(workspaceId, ...chain.map(f => f.id)).all<{ id: string; subject_type: string; capability: string; resource_id: string; expires_at: string | null; subject_label: string }>()).results || [];

  const grants = rows.map(g => ({
    id: g.id,
    subject_type: g.subject_type,
    subject_label: g.subject_label,
    capability: g.capability,
    folder_id: g.resource_id,
    folder_name: names.get(g.resource_id) ?? '',
    inherited: g.resource_id !== folderId,
    expires_at: g.expires_at ?? null,
  }));
  const own = chain[0].visibility || 'inherit';
  return {
    visibility: own === 'unlisted' ? 'public' : own,
    effective,
    inheritedFrom: own === 'inherit' && setBy ? { id: setBy.id, name: setBy.name } : null,
    access: effective === 'public' ? 'public' : grants.length ? 'external' : effective,
    grants,
  };
}
