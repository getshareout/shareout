// External-sharing spine (work/030) — the GRANT spine API.
// A grant attaches a capability on a resource to a Sharee org (all members) or an
// individual external_user. Phase 1 ships view/comment on folder/artifact.
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { json } from '../workspaces/json-response';
import { requireWorkspaceRole } from '../workspaces';
import { generateId } from '../crypto-utils';
import { invalidateGrants } from '../access/can-access';
import { logAudit } from '../audit';
import { requireExternalSharing } from './guard';
import { inviteOrAddMember } from '../workspaces/invite';

// Phase 2 surface: view/comment (read) + create/edit (author-in-sandbox). The lattice
// and table support the full set; we only let admins MINT what the access layer honors.
// `create` is folder-scoped (author NEW artifacts fenced inside a granted folder);
// `edit` applies to a folder (subtree) or a single artifact.
const CREATABLE_CAPABILITIES = new Set(['view', 'comment', 'create', 'edit']);
const GRANTABLE_RESOURCES = new Set(['folder', 'artifact', 'file']);

// Share-with-a-person surface (work/042 P2b): read-level sharing of a file/folder with one
// external individual by email. edit/create stay in the admin grant API above.
const SHAREABLE_RESOURCES = new Set(['file', 'folder']);
const SHARE_CAPABILITIES = new Set(['view', 'comment']);

// Insert a grant (idempotent) + bust caches + audit, returning the live row. Shared by the
// admin grant API and the share-with-a-person flow.
async function insertGrant(
  env: Env, workspaceId: string, subjectType: string, subjectId: string,
  resourceType: string, resourceId: string, capability: string, grantedBy: string,
): Promise<unknown> {
  const id = generateId('grt');
  await env.DB.prepare(`
    INSERT OR IGNORE INTO grants
      (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, workspaceId, subjectType, subjectId, resourceType, resourceId, capability, grantedBy).run();

  await invalidateGrants(env, workspaceId, subjectType === 'external_user' ? subjectId : undefined);
  await logAudit(env, {
    workspaceId, actorId: grantedBy, action: 'grant.create',
    targetType: resourceType, targetId: resourceId,
  }).catch(() => {});

  return env.DB.prepare(
    `SELECT * FROM grants WHERE workspace_id = ? AND subject_type = ? AND subject_id = ?
       AND resource_type = ? AND resource_id = ? AND capability = ?`
  ).bind(workspaceId, subjectType, subjectId, resourceType, resourceId, capability).first();
}

export async function handleListGrants(
  request: Request, env: Env, user: AuthUser, workspaceId: string,
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  const url = new URL(request.url);
  const subjectId = url.searchParams.get('subject_id');
  const resourceType = url.searchParams.get('resource_type');
  const resourceId = url.searchParams.get('resource_id');

  const where: string[] = ['g.workspace_id = ?'];
  const binds: unknown[] = [workspaceId];
  if (subjectId) { where.push('g.subject_id = ?'); binds.push(subjectId); }
  if (resourceType) { where.push('g.resource_type = ?'); binds.push(resourceType); }
  if (resourceId) { where.push('g.resource_id = ?'); binds.push(resourceId); }

  // subject_label: resolve the human handle (external's email / Sharee org name) so the
  // "shared with" UI shows who, not an opaque id. Falls back to the id for orphaned rows.
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.subject_type, g.subject_id, g.resource_type, g.resource_id, g.capability,
            g.granted_by, g.created_at, g.expires_at,
            COALESCE(u.email, s.name, g.subject_id) AS subject_label
       FROM grants g
       LEFT JOIN users u ON g.subject_type = 'external_user' AND u.id = g.subject_id
       LEFT JOIN sharees s ON g.subject_type = 'sharee' AND s.id = g.subject_id
      WHERE ${where.join(' AND ')} ORDER BY g.created_at DESC`
  ).bind(...binds).all();
  return json({ grants: results || [] });
}

// Resource must live in THIS workspace — never grant another workspace's resource.
async function resourceInWorkspace(
  env: Env, workspaceId: string, resourceType: string, resourceId: string,
): Promise<boolean> {
  const table = resourceType === 'folder' ? 'folders'
    : resourceType === 'file' ? 'asset_deliverables' : 'artifacts';
  const row = await env.DB.prepare(
    `SELECT workspace_id FROM ${table} WHERE id = ?`
  ).bind(resourceId).first<{ workspace_id: string | null }>();
  return row?.workspace_id === workspaceId;
}

// Subject must belong to this workspace: a Sharee owned by it, or a user who already
// holds an EXTERNAL edge here (you can't grant access to an arbitrary account).
async function subjectInWorkspace(
  env: Env, workspaceId: string, subjectType: string, subjectId: string,
): Promise<boolean> {
  if (subjectType === 'sharee') {
    return !!(await env.DB.prepare('SELECT 1 FROM sharees WHERE id = ? AND workspace_id = ?')
      .bind(subjectId, workspaceId).first());
  }
  if (subjectType === 'external_user') {
    return !!(await env.DB.prepare(
      "SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND member_class = 'external'"
    ).bind(workspaceId, subjectId).first());
  }
  return false;
}

export async function handleCreateGrant(
  request: Request, env: Env, user: AuthUser, workspaceId: string,
): Promise<Response> {
  const forbidden = await requireExternalSharing(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  let body: {
    subject_type?: string; subject_id?: string;
    resource_type?: string; resource_id?: string; capability?: string;
  };
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }

  const subjectType = body.subject_type ?? '';
  const subjectId = body.subject_id ?? '';
  const resourceType = body.resource_type ?? '';
  const resourceId = body.resource_id ?? '';
  const capability = body.capability ?? 'view';

  if (!['sharee', 'external_user'].includes(subjectType) || !subjectId)
    return json({ error: 'subject_type/subject_id invalid', code: 'VALIDATION_ERROR' }, 400);
  if (!GRANTABLE_RESOURCES.has(resourceType) || !resourceId)
    return json({ error: 'resource_type must be folder|artifact|file', code: 'VALIDATION_ERROR' }, 400);
  if (!CREATABLE_CAPABILITIES.has(capability))
    return json({ error: 'capability must be view|comment|create|edit', code: 'VALIDATION_ERROR' }, 400);
  // `create` means "author new artifacts inside this folder" — it only makes sense on
  // a folder, never a single artifact.
  if (capability === 'create' && resourceType !== 'folder')
    return json({ error: 'create grants apply to folders only', code: 'VALIDATION_ERROR' }, 400);

  if (!(await subjectInWorkspace(env, workspaceId, subjectType, subjectId)))
    return json({ error: 'Unknown subject for this workspace', code: 'VALIDATION_ERROR' }, 400);
  if (!(await resourceInWorkspace(env, workspaceId, resourceType, resourceId)))
    return json({ error: 'Resource not in this workspace', code: 'VALIDATION_ERROR' }, 400);

  // Unique index (subject,resource,capability) dedups — OR IGNORE makes re-grant a no-op.
  const row = await insertGrant(env, workspaceId, subjectType, subjectId, resourceType, resourceId, capability, user.id);
  return json({ grant: row }, 201);
}

// POST /v1/workspaces/{ws}/share-person — share a file/folder with ONE person by email.
// Reuses the external-sharing spine: ensure an org-less external edge, then mint an
// external_user grant. Portal enumeration + private-file serving already handle bare
// external_user grants. (work/042 P2b)
export async function handleShareWithPerson(
  request: Request, env: Env, user: AuthUser, workspaceId: string,
): Promise<Response> {
  const forbidden = await requireExternalSharing(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  let body: { email?: string; resource_type?: string; resource_id?: string; capability?: string };
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }

  const email = (body.email ?? '').trim().toLowerCase();
  const resourceType = body.resource_type ?? '';
  const resourceId = body.resource_id ?? '';
  const capability = body.capability ?? 'view';

  if (!email || !email.includes('@'))
    return json({ error: 'A valid email is required', code: 'VALIDATION_ERROR' }, 400);
  if (!SHAREABLE_RESOURCES.has(resourceType) || !resourceId)
    return json({ error: 'resource_type must be file|folder', code: 'VALIDATION_ERROR' }, 400);
  if (!SHARE_CAPABILITIES.has(capability))
    return json({ error: 'capability must be view|comment', code: 'VALIDATION_ERROR' }, 400);
  if (!(await resourceInWorkspace(env, workspaceId, resourceType, resourceId)))
    return json({ error: 'Resource not in this workspace', code: 'VALIDATION_ERROR' }, 400);

  // Refuse an existing INTERNAL member: we won't create a conflicting external edge, and
  // internal members aren't granted a peer's file by design (files aren't membership
  // resources). Re-sharing with an existing EXTERNAL person is fine (idempotent grant).
  const existing = await env.DB.prepare(
    `SELECT wm.member_class FROM users u
       JOIN workspace_members wm ON wm.user_id = u.id
      WHERE u.email = ? AND wm.workspace_id = ?`
  ).bind(email, workspaceId).first<{ member_class: string }>();
  if (existing && existing.member_class !== 'external') {
    return json({ error: 'That person is already a member of this workspace.', code: 'ALREADY_MEMBER' }, 409);
  }

  // Ensure the external edge (pre-creates the user + sends the invite/claim email if new).
  await inviteOrAddMember(env, workspaceId, user.id, email, 'member', undefined, 'external');
  const target = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (!target) return json({ error: 'Could not resolve the invited person', code: 'INTERNAL_ERROR' }, 500);

  const grant = await insertGrant(env, workspaceId, 'external_user', target.id, resourceType, resourceId, capability, user.id);
  return json({ grant, email }, 201);
}

export async function handleDeleteGrant(
  request: Request, env: Env, user: AuthUser, workspaceId: string, grantId: string,
): Promise<Response> {
  const forbidden = await requireExternalSharing(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  // Hard DELETE (no soft-delete) so revocation is a real removal; cache busts on the
  // workspace generation. A KV outage may serve up to TTL(60s) stale — accepted.
  const row = await env.DB.prepare(
    'SELECT subject_type, subject_id FROM grants WHERE id = ? AND workspace_id = ?'
  ).bind(grantId, workspaceId).first<{ subject_type: string; subject_id: string }>();
  if (!row) return json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

  await env.DB.prepare('DELETE FROM grants WHERE id = ? AND workspace_id = ?')
    .bind(grantId, workspaceId).run();

  await invalidateGrants(env, workspaceId, row.subject_type === 'external_user' ? row.subject_id : undefined);
  await logAudit(env, {
    workspaceId, actorId: user.id, action: 'grant.revoke', targetType: 'grant', targetId: grantId,
  }).catch(() => {});
  return json({ success: true });
}
