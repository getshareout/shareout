/**
 * Home folder browser queries — personal, team, nested children, breadcrumbs.
 */
import type { Env } from '../../../types';
import { getVisibilityScope, placeholders, type VisibilityScope } from '../../../account-links';
import type { HomeFolder } from '../types';
import { isLinkedWorkspaceMember } from '../filters';
import { normalizeVisibility } from '../../../visibility-config';

/** The folders matching `where` (aliased `f`), each with its direct sub-folder count and
 *  the artifacts anywhere in its subtree, so a folder's number covers its sub-folders too. */
function subtreeCountsSql(where: string, withCreator: boolean): string {
  return `
    WITH RECURSIVE sub(root, id, depth) AS (
      SELECT f.id, f.id, 0 FROM folders f WHERE ${where}
      UNION ALL
      SELECT s.root, c.id, s.depth + 1 FROM folders c JOIN sub s ON c.parent_id = s.id
      WHERE s.depth < 32
    )
    SELECT f.id, f.name${withCreator ? ', f.created_by' : ''},
           (SELECT COUNT(*) FROM folders c WHERE c.parent_id = f.id) as subfolder_count,
           (SELECT COUNT(*) FROM sub s JOIN artifacts a ON a.folder_id = s.id
             WHERE s.root = f.id AND a.deleted_at IS NULL) as artifact_count
    FROM sub JOIN folders f ON f.id = sub.id
    WHERE sub.depth = 0
    ORDER BY artifact_count DESC, f.name
  `;
}

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
    const rows = await env.DB.prepare(subtreeCountsSql(`f.workspace_id = ? AND ${parentSql}`, true))
      .bind(...params).all<HomeFolder>();
    return rows.results || [];
  }
  const idPh = placeholders(vis.userIds.length);
  const params = opts.parentId ? [...vis.userIds, opts.parentId] : [...vis.userIds];
  const rows = await env.DB.prepare(subtreeCountsSql(`f.workspace_id IS NULL AND f.owner_id IN (${idPh}) AND ${parentSql}`, false))
    .bind(...params).all<HomeFolder>();
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
  if (opts.workspaceId && !(await isLinkedWorkspaceMember(env, vis, opts.workspaceId))) return null;
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
  if (opts.workspaceId && !(await isLinkedWorkspaceMember(env, vis, opts.workspaceId))) return [];
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

/** An item in a folder's subtree whose own visibility is more open than the folder. */
export interface FolderOpenItem {
  kind: 'artifact' | 'file';
  id: string;
  name: string;
  slug: string | null;
  visibility: 'public' | 'workspace';
}

export interface FolderAccess {
  /** The folder's own setting (`inherit` until resolved). */
  visibility: string;
  /** The folder's resolved setting. Not enforced on its contents. */
  effective: 'private' | 'workspace' | 'public';
  inheritedFrom: { id: string; name: string } | null;
  /** Who can actually open something in this folder: the most open of the folder's
   *  setting and the visibility of every non-deleted artifact and file in its subtree. */
  audience: 'private' | 'workspace' | 'public';
  /** The pill: `audience`, or `external` when it is not public and grants exist. */
  access: FolderAccessLabel;
  /** Items in the subtree more open than `effective`, by their own visibility. */
  moreOpen: { public: number; workspace: number };
  /** Those items by name (up to OPEN_ITEMS_LIMIT). Folder managers only: callers drop it
   *  for everyone else. */
  openItems?: FolderOpenItem[];
  grants: FolderAccessGrant[];
}

const OPEN_ITEMS_LIMIT = 50;
const RANK = { private: 0, workspace: 1, public: 2 } as const;
type Audience = keyof typeof RANK;

/** One pass over a folder's subtree: the artifacts and files anyone beyond their owner
 *  and collaborators can open (public, or the whole workspace), public first, with total
 *  counts by visibility. Deleted items are ignored. `workspace` only opens an item that
 *  belongs to a workspace. Files never go public; a `team` or `private` file counts as
 *  private. */
async function queryOpenContents(
  env: Env, folderId: string, scope: { workspaceId: string } | { ownerIds: string[] },
): Promise<{ moreOpen: FolderAccess['moreOpen']; openItems: FolderOpenItem[] }> {
  const seedSql = 'workspaceId' in scope ? 'workspace_id = ?' : `workspace_id IS NULL AND owner_id IN (${placeholders(scope.ownerIds.length)})`;
  const seedParams = 'workspaceId' in scope ? [scope.workspaceId] : scope.ownerIds;
  const rows = (await env.DB.prepare(`
    WITH RECURSIVE sub(id) AS (
      SELECT id FROM folders WHERE id = ? AND ${seedSql}
      UNION
      SELECT f.id FROM folders f JOIN sub s ON f.parent_id = s.id
    ),
    items(kind, id, name, slug, visibility) AS (
      SELECT 'artifact', a.id, a.name, a.slug, CASE WHEN a.visibility = 'workspace' THEN 'workspace' ELSE 'public' END
        FROM artifacts a
       WHERE a.folder_id IN (SELECT id FROM sub) AND a.deleted_at IS NULL AND (a.visibility IN ('public', 'unlisted') OR (a.visibility = 'workspace' AND a.workspace_id IS NOT NULL))
      UNION ALL
      SELECT 'file', d.id, d.name, NULL, 'workspace'
        FROM asset_deliverables d
       WHERE d.folder_id IN (SELECT id FROM sub) AND d.deleted_at IS NULL AND d.visibility = 'workspace' AND d.workspace_id IS NOT NULL
    )
    SELECT kind, id, name, slug, visibility,
           SUM(visibility = 'public') OVER () AS n_public,
           SUM(visibility = 'workspace') OVER () AS n_workspace
      FROM items
     ORDER BY visibility = 'public' DESC, name
     LIMIT ?
  `).bind(folderId, ...seedParams, OPEN_ITEMS_LIMIT).all<FolderOpenItem & { n_public: number; n_workspace: number }>()).results || [];
  if (!rows.length) return { moreOpen: { public: 0, workspace: 0 }, openItems: [] };
  return {
    moreOpen: { public: rows[0].n_public, workspace: rows[0].n_workspace },
    openItems: rows.map(({ kind, id, name, slug, visibility }) => ({ kind, id, name, slug, visibility })),
  };
}

/** `moreOpen` already holds only what beats `effective`. */
function audienceOf(effective: Audience, moreOpen: FolderAccess['moreOpen']): Audience {
  return moreOpen.public ? 'public' : moreOpen.workspace ? 'workspace' : effective;
}

/** A personal folder: private to its owner by setting, but each artifact in it keeps its
 *  own visibility, so the audience is whatever its most open artifact allows. null if
 *  the folder is not one of `ownerIds`'. */
export async function queryPersonalFolderAccess(env: Env, ownerIds: string[], folderId: string): Promise<FolderAccess | null> {
  if (!ownerIds.length) return null;
  const { moreOpen, openItems } = await queryOpenContents(env, folderId, { ownerIds });
  if (!openItems.length) {
    const own = await env.DB.prepare(`SELECT 1 FROM folders WHERE id = ? AND workspace_id IS NULL AND owner_id IN (${placeholders(ownerIds.length)})`)
      .bind(folderId, ...ownerIds).first();
    if (!own) return null;
  }
  const audience = audienceOf('private', moreOpen);
  return { visibility: 'private', effective: 'private', inheritedFrom: null, audience, access: audience, moreOpen, openItems, grants: [] };
}

/** Who can see a Team Space folder: its own visibility (`inherit` resolves from the
 *  nearest ancestor that sets one; none = workspace), the external grants on it and its
 *  ancestors (canAccess inherits them down the chain), and the artifacts and files inside
 *  whose own visibility is more open than the folder, since a folder's setting is not
 *  enforced on its contents. null if not in this workspace. `openItems` names those
 *  items: callers keep it for folder managers only. */
export async function queryFolderAccess(env: Env, workspaceId: string, folderId: string): Promise<FolderAccess | null> {
  // The subtree scan does not depend on the chain, so both start together; it is
  // narrowed to what is more open than the resolved setting below.
  const contentsP = queryOpenContents(env, folderId, { workspaceId });
  contentsP.catch(() => {});
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
  const contents = await contentsP;
  const openItems = contents.openItems.filter(i => RANK[i.visibility] > RANK[effective]);
  const moreOpen = {
    public: effective === 'public' ? 0 : contents.moreOpen.public,
    workspace: effective === 'private' ? contents.moreOpen.workspace : 0,
  };
  const audience = audienceOf(effective, moreOpen);
  return {
    visibility: own === 'unlisted' ? 'public' : own,
    effective,
    inheritedFrom: own === 'inherit' && setBy ? { id: setBy.id, name: setBy.name } : null,
    audience,
    access: audience === 'public' ? 'public' : grants.length ? 'external' : audience,
    moreOpen,
    openItems,
    grants,
  };
}
