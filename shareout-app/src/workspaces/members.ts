import type { Env, WorkspaceRole } from '../types';
import type { AuthUser } from '../api-auth';
import { json } from './json-response';
import { invalidateWorkspaceRole, requireWorkspaceRole } from './roles';
import { invalidateGrants } from '../access/can-access';
import { getWorkspaceInviteContext, inviteOrAddMember, MAX_BULK_INVITES } from './invite';
import { logAudit } from '../audit';

export async function handleListWorkspaceMembers(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'member');
  if (forbidden) return forbidden;

  const members = await env.DB.prepare(`
    SELECT wm.id, wm.role, wm.created_at, u.id as user_id, u.email, u.name, u.is_service
    FROM workspace_members wm
    JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = ? AND wm.member_class = 'internal'
    ORDER BY wm.created_at
  `).bind(workspaceId).all<{
    id: string;
    role: WorkspaceRole;
    created_at: string;
    user_id: string;
    email: string | null;
    name: string | null;
    is_service: number;
  }>();

  // is_service members are headless Agent identities (service accounts), surfaced
  // as first-class members so they're attributable in the members/activity views.
  const results = (members.results || []).map((m) => ({ ...m, is_agent: m.is_service === 1 }));
  return json({ members: results });
}

export async function handleAddWorkspaceMember(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  let body: { email: string; role?: WorkspaceRole };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  if (!body.email) {
    return json({ error: 'email is required', code: 'VALIDATION_ERROR' }, 400);
  }

  const role: WorkspaceRole = body.role || 'member';
  if (!['admin', 'member'].includes(role)) {
    return json({ error: "Invalid role. Must be 'admin' or 'member'.", code: 'INVALID_ROLE' }, 400);
  }

  const ctx = await getWorkspaceInviteContext(env, workspaceId, user.id);
  const result = await inviteOrAddMember(env, workspaceId, user.id, body.email, role, ctx);
  if (result.status === 'skipped') {
    const code = result.reason === 'domain_not_allowed' ? 'DOMAIN_NOT_ALLOWED' : 'INVALID_EMAIL';
    const msg = result.reason === 'domain_not_allowed'
      ? "Email is not in this workspace's allowed domains or emails"
      : 'Invalid email';
    return json({ error: msg, code }, code === 'DOMAIN_NOT_ALLOWED' ? 403 : 400);
  }

  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: 'member.add', targetType: 'email', targetId: body.email,
    detail: { role, status: result.status },
  });

  return handleListWorkspaceMembers(request, env, user, workspaceId);
}

export async function handleInviteWorkspaceMembers(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  let body: { emails?: unknown; role?: WorkspaceRole };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  if (!Array.isArray(body.emails)) {
    return json({ error: 'emails must be an array', code: 'VALIDATION_ERROR' }, 400);
  }

  const role: WorkspaceRole = body.role || 'member';
  if (!['admin', 'member'].includes(role)) {
    return json({ error: "Invalid role. Must be 'admin' or 'member'.", code: 'INVALID_ROLE' }, 400);
  }

  const emails = [...new Set(
    body.emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
  )].slice(0, MAX_BULK_INVITES);

  if (emails.length === 0) {
    return json({ error: 'No valid emails provided', code: 'VALIDATION_ERROR' }, 400);
  }

  const ctx = await getWorkspaceInviteContext(env, workspaceId, user.id);
  // Emails are deduped so invites are independent; run in bounded parallel waves
  // (caps concurrent invite-email sends) instead of one-at-a-time.
  const results = [];
  const WAVE = 10;
  for (let i = 0; i < emails.length; i += WAVE) {
    results.push(...await Promise.all(
      emails.slice(i, i + WAVE).map((email) => inviteOrAddMember(env, workspaceId, user.id, email, role, ctx))
    ));
  }

  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: 'member.invite_bulk', targetType: 'workspace', targetId: workspaceId,
    detail: { role, count: emails.length },
  });

  return json({ results });
}

export async function handleListWorkspaceMemberMetrics(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'member');
  if (forbidden) return forbidden;

  const rows = await env.DB.prepare(`
    SELECT
      wm.user_id, wm.role, wm.created_at AS joined_at,
      u.email, u.name, u.last_login_at,
      (u.last_login_at IS NULL) AS pending,
      (SELECT COUNT(*) FROM artifacts a
         WHERE a.owner_id = wm.user_id AND a.workspace_id = wm.workspace_id) AS artifact_count,
      (SELECT COUNT(*) FROM artifacts a
         WHERE a.owner_id = wm.user_id AND a.workspace_id = wm.workspace_id
           AND a.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')) AS artifacts_30d,
      (SELECT COUNT(*) FROM analytics_events ev
         JOIN artifacts a ON a.id = ev.artifact_id
         WHERE a.owner_id = wm.user_id AND a.workspace_id = wm.workspace_id
           AND ev.event_type = 'view') AS view_count,
      (SELECT COUNT(*) FROM analytics_events ev
         JOIN artifacts a ON a.id = ev.artifact_id
         WHERE a.owner_id = wm.user_id AND a.workspace_id = wm.workspace_id
           AND ev.event_type = 'view'
           AND ev.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')) AS views_30d,
      (SELECT COALESCE(SUM(e.input_tokens + e.output_tokens),0) FROM agent_usage_events e
         JOIN artifacts a ON a.id = e.artifact_id
         WHERE e.workspace_id = wm.workspace_id AND a.owner_id = wm.user_id) AS ai_tokens,
      (SELECT COALESCE(SUM(e.base_cost_micro_usd),0) FROM agent_usage_events e
         JOIN artifacts a ON a.id = e.artifact_id
         WHERE e.workspace_id = wm.workspace_id AND a.owner_id = wm.user_id) AS ai_cost_micro_usd,
      (SELECT COUNT(*) FROM artifact_comments c
         JOIN artifacts a ON a.id = c.artifact_id
         WHERE c.author_id = wm.user_id AND a.workspace_id = wm.workspace_id) AS comment_count,
      (SELECT MAX(ev.created_at) FROM analytics_events ev
         JOIN artifacts a ON a.id = ev.artifact_id
         WHERE a.owner_id = wm.user_id AND a.workspace_id = wm.workspace_id) AS last_view_ts
    FROM workspace_members wm
    JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = ?1 AND wm.member_class = 'internal'
    ORDER BY wm.created_at
  `).bind(workspaceId).all<{
    user_id: string; role: WorkspaceRole; joined_at: string;
    email: string | null; name: string | null; last_login_at: string | null;
    pending: number; artifact_count: number; artifacts_30d: number;
    view_count: number; views_30d: number; ai_tokens: number;
    ai_cost_micro_usd: number; comment_count: number; last_view_ts: number | null;
  }>();

  const members = (rows.results || []).map((r) => {
    const lastLoginMs = r.last_login_at ? new Date(r.last_login_at).getTime() : 0;
    const lastViewMs = r.last_view_ts ? r.last_view_ts * 1000 : 0;
    const lastActiveMs = Math.max(lastLoginMs, lastViewMs);
    return {
      user_id: r.user_id,
      role: r.role,
      email: r.email,
      name: r.name,
      joined_at: r.joined_at,
      pending: !!r.pending,
      last_login_at: r.last_login_at,
      last_active: lastActiveMs ? new Date(lastActiveMs).toISOString() : null,
      artifact_count: r.artifact_count,
      artifacts_30d: r.artifacts_30d,
      view_count: r.view_count,
      views_30d: r.views_30d,
      ai_tokens: r.ai_tokens,
      ai_cost_usd: (r.ai_cost_micro_usd || 0) / 1_000_000,
      comment_count: r.comment_count,
    };
  });

  return json({ members });
}

/** Workspace member directory for @mention / share autocomplete (no artifact context). */
export async function handleListWorkspacePeople(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'member');
  if (forbidden) return forbidden;

  const rows = await env.DB.prepare(`
    SELECT u.id AS user_id, u.email AS email, u.name AS name, wm.role AS role
      FROM workspace_members wm
      JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = ? AND wm.member_class = 'internal'
     ORDER BY u.name, u.email
     LIMIT 500
  `).bind(workspaceId).all<{ user_id: string; email: string | null; name: string | null; role: string }>();

  const people = (rows.results || [])
    .filter((r) => r.email)
    .map((r) => ({ id: r.user_id, email: r.email, name: r.name, role: r.role }));
  return json({ people });
}

export async function handleRemoveWorkspaceMember(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  userId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  const target = await env.DB.prepare(
    'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?'
  ).bind(workspaceId, userId).first<{ role: WorkspaceRole }>();

  if (target?.role === 'owner') {
    return json({ error: 'Cannot remove workspace owner', code: 'CANNOT_REMOVE_OWNER' }, 400);
  }

  // Removing the membership edge alone does NOT revoke an external's access: grants
  // resolve through `sharee_members` + `grants`, neither of which references the edge.
  // Drop both, or a removed client keeps every deliverable they were ever granted.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .bind(workspaceId, userId),
    env.DB.prepare(
      `DELETE FROM sharee_members WHERE user_id = ?
         AND sharee_id IN (SELECT id FROM sharees WHERE workspace_id = ?)`
    ).bind(userId, workspaceId),
    env.DB.prepare(
      "DELETE FROM grants WHERE workspace_id = ? AND subject_type = 'external_user' AND subject_id = ?"
    ).bind(workspaceId, userId),
  ]);

  await invalidateWorkspaceRole(env, workspaceId, userId);
  await invalidateGrants(env, workspaceId, userId);

  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: 'member.remove', targetType: 'user', targetId: userId,
    detail: { removed_role: target?.role ?? null },
  });

  return handleListWorkspaceMembers(request, env, user, workspaceId);
}

export async function handleTransferWorkspaceOwnership(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'owner');
  if (forbidden) return forbidden;

  let body: { user_id: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  if (!body.user_id) {
    return json({ error: 'user_id is required', code: 'VALIDATION_ERROR' }, 400);
  }

  // Internal only: an external (Sharee) edge must never become the workspace owner.
  const targetMember = await env.DB.prepare(
    "SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND member_class = 'internal'"
  ).bind(workspaceId, body.user_id).first();

  if (!targetMember) {
    return json({ error: 'User is not a workspace member', code: 'NOT_MEMBER' }, 400);
  }

  // One batch: a partial transfer leaves the workspace with two owners or none.
  await env.DB.batch([
    env.DB.prepare('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?')
      .bind('admin', workspaceId, user.id),
    env.DB.prepare('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?')
      .bind('owner', workspaceId, body.user_id),
    env.DB.prepare('UPDATE workspaces SET owner_id = ? WHERE id = ?')
      .bind(body.user_id, workspaceId),
  ]);

  await invalidateWorkspaceRole(env, workspaceId, user.id);
  await invalidateWorkspaceRole(env, workspaceId, body.user_id);

  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: 'ownership.transfer', targetType: 'user', targetId: body.user_id,
  });

  return json({ success: true, new_owner: body.user_id });
}
