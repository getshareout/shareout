// External-sharing spine (work/030) — Phase 4. Activity log + read receipts.
// recordShareeView is fire-and-forget on the hot serve path: deduped per
// (user, resource) per hour via KV so a client refreshing a dashboard doesn't spam the
// log, and it never throws (an audit write must not break serving the artifact).
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { generateId } from '../crypto-utils';
import { json } from '../workspaces/json-response';
import { requireWorkspaceRole } from '../workspaces/roles';
import { requireFolderManager } from '../folders';
import { notifyFolderFirstOpen } from '../notify/review-notify';

interface ViewEvent {
  workspaceId: string;
  userId: string;
  resourceType: string;
  resourceId: string;
}

// Resolve which Sharee org (if any) this user belongs to in the workspace, to attribute
// the activity row. First membership wins; null when the access came from an individual
// external_user grant with no Sharee.
async function resolveShareeId(env: Env, workspaceId: string, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(`
    SELECT sm.sharee_id AS id
      FROM sharee_members sm
      JOIN sharees s ON s.id = sm.sharee_id
     WHERE s.workspace_id = ? AND sm.user_id = ? AND sm.status != 'removed'
     LIMIT 1
  `).bind(workspaceId, userId).first<{ id: string }>();
  return row?.id ?? null;
}

export async function recordShareeView(env: Env, ev: ViewEvent): Promise<void> {
  try {
    const dedupeKey = `shactivity:${ev.userId}:${ev.resourceType}:${ev.resourceId}`;
    if (env.SLUGS) {
      try {
        if (await env.SLUGS.get(dedupeKey)) return; // already logged this hour
      } catch { /* KV blip → fall through and log */ }
    }
    const shareeId = await resolveShareeId(env, ev.workspaceId, ev.userId);
    await env.DB.prepare(`
      INSERT INTO sharee_activity (id, workspace_id, sharee_id, user_id, resource_type, resource_id, action)
      VALUES (?, ?, ?, ?, ?, ?, 'view')
    `).bind(generateId('act'), ev.workspaceId, shareeId, ev.userId, ev.resourceType, ev.resourceId).run();

    if (env.SLUGS) {
      try { await env.SLUGS.put(dedupeKey, '1', { expirationTtl: 3600 }); } catch { /* best-effort */ }
    }
    // The folder's sharer hears about this person once per folder per day.
    if (ev.resourceType === 'artifact') {
      await notifyFolderFirstOpen(env, { workspaceId: ev.workspaceId, userId: ev.userId, artifactId: ev.resourceId });
    }
  } catch { /* never break serving */ }
}

export interface ShareeActivityRow {
  id: string;
  sharee_id: string | null;
  user_id: string;
  user_email: string | null;
  resource_type: string;
  resource_id: string;
  action: string;
  created_at: string;
}

// Admin read-out: recent activity for a workspace, optionally filtered to one Sharee.
export async function listShareeActivity(
  env: Env, workspaceId: string, shareeId?: string, limit = 200,
): Promise<ShareeActivityRow[]> {
  const where = ['a.workspace_id = ?'];
  const binds: unknown[] = [workspaceId];
  if (shareeId) { where.push('a.sharee_id = ?'); binds.push(shareeId); }
  binds.push(Math.min(limit, 500));
  const { results } = await env.DB.prepare(`
    SELECT a.id, a.sharee_id, a.user_id, u.email AS user_email,
           a.resource_type, a.resource_id, a.action, a.created_at
      FROM sharee_activity a
      LEFT JOIN users u ON u.id = a.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.created_at DESC
     LIMIT ?
  `).bind(...binds).all<ShareeActivityRow>();
  return results || [];
}

// Admin-only read-out. shareeId optional (workspace-wide vs one Sharee).
export async function handleListShareeActivity(
  request: Request, env: Env, user: AuthUser, workspaceId: string, shareeId?: string,
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;
  const activity = await listShareeActivity(env, workspaceId, shareeId);
  return json({ activity });
}

export interface FolderActivityRow {
  user_email: string | null;
  resource_type: string;
  resource_id: string;
  resource_name: string | null;
  action: string;
  created_at: string;
  /** 1 when the person is a space guest (no account): their views live in audit_log. */
  guest: number;
}

// "Who opened what, when" for one folder: external activity on the folder itself and on
// every artifact/file in its subtree (the same downward expansion the portal uses), plus
// space guests' views (audit_log 'space_guest.view' — a guest has no user row).
export async function listFolderActivity(
  env: Env, workspaceId: string, folderId: string, limit = 100,
): Promise<FolderActivityRow[]> {
  const { results } = await env.DB.prepare(`
    WITH RECURSIVE sub(id) AS (
      SELECT id FROM folders WHERE id = ? AND workspace_id = ?
      UNION
      SELECT f.id FROM folders f JOIN sub s ON f.parent_id = s.id
    ),
    ev(user_email, resource_type, resource_id, action, created_at, guest) AS (
      SELECT u.email, a.resource_type, a.resource_id, a.action, a.created_at, 0
        FROM sharee_activity a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.workspace_id = ?
      UNION ALL
      SELECT l.actor_email, l.target_type, l.target_id, 'view', l.created_at, 1
        FROM audit_log l
       WHERE l.workspace_id = ? AND l.action = 'space_guest.view'
    )
    SELECT ev.user_email, ev.resource_type, ev.resource_id,
           COALESCE(ar.name, ar.slug, d.name, fo.name) AS resource_name,
           ev.action, ev.created_at, ev.guest
      FROM ev
      LEFT JOIN artifacts ar ON ev.resource_type = 'artifact' AND ar.id = ev.resource_id
      LEFT JOIN asset_deliverables d ON ev.resource_type = 'file' AND d.id = ev.resource_id
      LEFT JOIN folders fo ON ev.resource_type = 'folder' AND fo.id = ev.resource_id
     WHERE (ev.resource_type = 'artifact' AND ar.folder_id IN (SELECT id FROM sub))
        OR (ev.resource_type = 'file' AND d.folder_id IN (SELECT id FROM sub))
        OR (ev.resource_type = 'folder' AND ev.resource_id IN (SELECT id FROM sub))
     ORDER BY ev.created_at DESC
     LIMIT ?
  `).bind(folderId, workspaceId, workspaceId, workspaceId, Math.min(limit, 500)).all<FolderActivityRow>();
  return results || [];
}

// GET /v1/workspaces/{ws}/folders/{folder}/activity — folder managers only (admins, or the
// folder's creator while members manage their own folders): the same gate as its grants.
export async function handleListFolderActivity(
  env: Env, user: AuthUser, workspaceId: string, folderId: string,
): Promise<Response> {
  const forbidden = await requireFolderManager(env, user, workspaceId, folderId);
  if (forbidden) return forbidden;
  return json({ activity: await listFolderActivity(env, workspaceId, folderId) });
}
