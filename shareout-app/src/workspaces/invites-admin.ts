import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { getInternalWorkspaceRole, invalidateWorkspaceRole } from '../workspaces';
import { createInviteClaim, sendInviteEmail } from '../workspaces-invite-email';
import { logAudit } from '../audit';
import { getPlatformOrigin } from '../config/origins';
import { jsonWithApiErrors } from '../http/api-error';

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

async function requireWsAdmin(env: Env, workspaceId: string, userId: string): Promise<Response | null> {
  const role = await getInternalWorkspaceRole(env, workspaceId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  return null;
}

// GET /v1/workspaces/{id}/invites — pending (unclaimed) invites, newest claim per user.
export async function handleListWorkspaceInvites(env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  const forbidden = await requireWsAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;
  const rows = await env.DB.prepare(`
    SELECT ic.id, ic.email, ic.created_at, ic.expires_at,
           (ic.expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS expired,
           inv.email AS invited_by_email, wm.role
    FROM workspace_invite_claims ic
    LEFT JOIN users inv ON inv.id = ic.invited_by
    LEFT JOIN workspace_members wm ON wm.workspace_id = ic.workspace_id AND wm.user_id = ic.user_id
    WHERE ic.workspace_id = ? AND ic.claimed_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM workspace_invite_claims ic2
        WHERE ic2.user_id = ic.user_id AND ic2.workspace_id = ic.workspace_id
          AND ic2.claimed_at IS NULL AND ic2.created_at > ic.created_at
      )
    ORDER BY ic.created_at DESC
  `).bind(workspaceId).all();
  return json({ invites: (rows.results || []).map((r) => ({ ...r, expired: !!(r as { expired: number }).expired })) });
}

// POST /v1/workspaces/{id}/invites/{inviteId}/resend — regenerate code, optionally re-email.
//
// The claim code is stored hashed, so the plaintext exists only here, at mint time. An
// instance with no EMAIL binding used to lose it the moment this function returned, which
// left the invite row valid and unreachable — nobody could join a self-host without mail.
// Returning the join URL is what makes a no-email instance invitable.
//
// `notify: false` mints a link without mailing anyone, so "copy link" does not spam the
// invitee. Minting never invalidates earlier claims — createInviteClaim inserts a row,
// and every unclaimed row stays redeemable until it expires.
export async function handleResendWorkspaceInvite(
  request: Request, env: Env, user: AuthUser, workspaceId: string, inviteId: string
): Promise<Response> {
  const forbidden = await requireWsAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;
  const inv = await env.DB.prepare(
    'SELECT user_id, email FROM workspace_invite_claims WHERE id = ? AND workspace_id = ? AND claimed_at IS NULL'
  ).bind(inviteId, workspaceId).first<{ user_id: string; email: string }>();
  if (!inv) return json({ error: 'Invite not found', code: 'NOT_FOUND' }, 404);

  const body = await request.json<{ notify?: boolean }>().catch(() => ({}) as { notify?: boolean });
  const notify = body.notify !== false;

  const ws = await env.DB.prepare('SELECT name FROM workspaces WHERE id = ?').bind(workspaceId).first<{ name: string }>();
  const code = await createInviteClaim(env, workspaceId, inv.user_id, inv.email, user.id);
  if (notify) {
    await sendInviteEmail(env, {
      email: inv.email,
      workspaceName: ws?.name || 'a workspace',
      inviterName: user.username || user.email || 'A teammate',
      claimCode: code,
    });
  }
  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: notify ? 'invite.resend' : 'invite.link', targetType: 'invite', targetId: inviteId,
    detail: { email: inv.email },
  });
  return json({ ok: true, inviteUrl: `${getPlatformOrigin(env)}/invite/${encodeURIComponent(code)}` });
}

// DELETE /v1/workspaces/{id}/invites/{inviteId} — revoke a pending invite and the pending membership.
export async function handleRevokeWorkspaceInvite(
  env: Env, user: AuthUser, workspaceId: string, inviteId: string
): Promise<Response> {
  const forbidden = await requireWsAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;
  const inv = await env.DB.prepare(
    'SELECT user_id, email, claimed_at FROM workspace_invite_claims WHERE id = ? AND workspace_id = ?'
  ).bind(inviteId, workspaceId).first<{ user_id: string; email: string; claimed_at: string | null }>();
  if (!inv) return json({ error: 'Invite not found', code: 'NOT_FOUND' }, 404);
  if (inv.claimed_at) return json({ error: 'Invite already claimed', code: 'ALREADY_CLAIMED' }, 400);

  // Drop every pending claim for this user, and the pending membership the invite created
  // (never the owner — an owner row is not a revocable invite).
  await env.DB.prepare(
    'DELETE FROM workspace_invite_claims WHERE workspace_id = ? AND user_id = ? AND claimed_at IS NULL'
  ).bind(workspaceId, inv.user_id).run();
  await env.DB.prepare(
    "DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND role != 'owner'"
  ).bind(workspaceId, inv.user_id).run();
  await invalidateWorkspaceRole(env, workspaceId, inv.user_id);
  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: 'invite.revoke', targetType: 'invite', targetId: inviteId, detail: { email: inv.email },
  });
  return json({ ok: true });
}
