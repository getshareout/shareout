// External-sharing spine (work/030) — Sharee membership + external invite flow.
//
// Inviting an external email reuses inviteOrAddMember (pre-creates the users row and
// the workspace_members EDGE) but stamps the edge member_class='external' so the human
// is excluded from seats and internal listings. One edge per (workspace, human) no
// matter how many Sharees they belong to. The sharee_members row is the org link.
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { json } from '../workspaces/json-response';
import { requireWorkspaceRole } from '../workspaces';
import { generateId } from '../crypto-utils';
import { inviteOrAddMember } from '../workspaces/invite';
import { invalidateGrants } from '../access/can-access';
import { logAudit } from '../audit';
import { requireExternalSharing } from './guard';

async function shareeExists(env: Env, workspaceId: string, shareeId: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 FROM sharees WHERE id = ? AND workspace_id = ?')
    .bind(shareeId, workspaceId).first());
}

export async function handleListShareeMembers(
  request: Request, env: Env, user: AuthUser, workspaceId: string, shareeId: string,
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;
  if (!(await shareeExists(env, workspaceId, shareeId)))
    return json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

  const { results } = await env.DB.prepare(`
    SELECT sm.id, sm.email, sm.status, sm.user_id, sm.created_at, sm.joined_at,
           u.name AS user_name
    FROM sharee_members sm
    LEFT JOIN users u ON u.id = sm.user_id
    WHERE sm.sharee_id = ? AND sm.status != 'removed'
    ORDER BY sm.created_at
  `).bind(shareeId).all();
  return json({ members: results || [] });
}

export async function handleAddShareeMember(
  request: Request, env: Env, user: AuthUser, workspaceId: string, shareeId: string,
): Promise<Response> {
  const forbidden = await requireExternalSharing(env, workspaceId, user.id);
  if (forbidden) return forbidden;
  if (!(await shareeExists(env, workspaceId, shareeId)))
    return json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

  let body: { email?: string };
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@'))
    return json({ error: 'A valid email is required', code: 'VALIDATION_ERROR' }, 400);

  // Create/refresh the EXTERNAL workspace edge + send the invite/claim email.
  const result = await inviteOrAddMember(
    env, workspaceId, user.id, email, 'member', undefined, 'external',
  );
  if (result.status === 'skipped')
    return json({ error: `Invite skipped: ${result.reason}`, code: 'INVITE_SKIPPED' }, 400);

  // Resolve the (possibly just-created) user row to link the sharee membership.
  const target = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email).first<{ id: string }>();

  // Upsert the org link (idempotent on the unique (sharee_id, email) index).
  const existing = await env.DB.prepare(
    'SELECT id, status FROM sharee_members WHERE sharee_id = ? AND email = ?'
  ).bind(shareeId, email).first<{ id: string; status: string }>();

  if (existing) {
    await env.DB.prepare(
      "UPDATE sharee_members SET user_id = ?, status = CASE WHEN status = 'removed' THEN 'invited' ELSE status END WHERE id = ?"
    ).bind(target?.id ?? null, existing.id).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO sharee_members (id, sharee_id, user_id, email, status, invited_by)
      VALUES (?, ?, ?, ?, 'invited', ?)
    `).bind(generateId('shm'), shareeId, target?.id ?? null, email, user.id).run();
  }

  // The new edge changes what this human can reach — bust their grant cache.
  await invalidateGrants(env, workspaceId, target?.id);
  await logAudit(env, {
    workspaceId, actorId: user.id, action: 'sharee.member.invite',
    targetType: 'sharee', targetId: shareeId,
  }).catch(() => {});

  return json({ email, status: result.status }, 201);
}

// Remove from THIS sharee only. The workspace edge + users row stay (the human may
// belong to other Sharees). Grants on this sharee still exist but no longer resolve
// for this human once the org link is gone.
export async function handleRemoveShareeMember(
  request: Request, env: Env, user: AuthUser,
  workspaceId: string, shareeId: string, memberUserId: string,
): Promise<Response> {
  const forbidden = await requireExternalSharing(env, workspaceId, user.id);
  if (forbidden) return forbidden;
  if (!(await shareeExists(env, workspaceId, shareeId)))
    return json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

  // :uid may be a users.id (claimed) or a sharee_members.id (still-invited, no user).
  await env.DB.prepare(
    'DELETE FROM sharee_members WHERE sharee_id = ? AND (user_id = ? OR id = ?)'
  ).bind(shareeId, memberUserId, memberUserId).run();

  await invalidateGrants(env, workspaceId, memberUserId);
  await logAudit(env, {
    workspaceId, actorId: user.id, action: 'sharee.member.remove',
    targetType: 'sharee', targetId: shareeId,
  }).catch(() => {});
  return json({ success: true });
}
