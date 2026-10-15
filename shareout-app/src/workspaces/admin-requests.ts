/**
 * "Ask an admin" — a member hit a role-gated action (a 403 in the UI) and asks the
 * workspace's owners/admins to do it for them or change the setting.
 *
 * Each admin gets a bell row (notifications kind 'admin_request', surfaced in Needs You)
 * and an email. A repeat ask for the same reason within a day re-notifies nobody: the
 * answer is the same `pending` so a button mashed twice stays quiet.
 */
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { getInternalWorkspaceRole } from './roles';
import { json } from './json-response';
import { simpleApiError } from '../http/api-error';
import { dispatchLifecycleEmail } from '../email/gateway';
import { getPlatformOrigin } from '../config/origins';

const CODE_RE = /^[A-Z0-9_]{1,64}$/;
const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function handleCreateAdminRequest(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
): Promise<Response> {
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (!role) return simpleApiError('Forbidden', 'FORBIDDEN', 403);

  let body: { code?: unknown; action?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return simpleApiError('Invalid JSON', 'INVALID_JSON', 400);
  }
  const code = typeof body.code === 'string' && CODE_RE.test(body.code) ? body.code : 'FORBIDDEN';
  const action = clip(body.action, 160);
  const message = clip(body.message, 300);

  const admins = await env.DB.prepare(`
    SELECT wm.user_id AS id, u.email AS email
    FROM workspace_members wm JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = ? AND wm.member_class = 'internal' AND wm.role IN ('owner', 'admin')
      AND wm.user_id != ? AND COALESCE(u.disabled, 0) = 0
  `).bind(workspaceId, user.id).all<{ id: string; email: string | null }>();
  const recipients = admins.results ?? [];
  if (!recipients.length) {
    return simpleApiError('This workspace has no other admins to ask.', 'NO_ADMINS', 409);
  }

  const recent = await env.DB.prepare(`
    SELECT 1 FROM notifications
    WHERE kind = 'admin_request' AND subject_type = 'workspace' AND subject_id = ?
      AND json_extract(payload, '$.requester_id') = ? AND json_extract(payload, '$.code') = ?
      AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
    LIMIT 1
  `).bind(workspaceId, user.id, code).first();
  if (recent) return json({ ok: true, status: 'pending' });

  const [profile, ws] = await Promise.all([
    env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(user.id).first<{ name: string | null }>(),
    env.DB.prepare('SELECT name FROM workspaces WHERE id = ?').bind(workspaceId).first<{ name: string | null }>(),
  ]);
  const requesterName = profile?.name || (user.email ? user.email.split('@')[0] : 'A member');
  const payload = JSON.stringify({ requester_id: user.id, requester_name: requesterName, requester_email: user.email, code, action, message });

  await env.DB.batch(recipients.map((r) => env.DB.prepare(
    `INSERT INTO notifications (id, recipient_type, recipient_id, kind, subject_type, subject_id, message, payload)
     VALUES (?, 'user', ?, 'admin_request', 'workspace', ?, ?, ?)`
  ).bind(crypto.randomUUID(), r.id, workspaceId, action || null, payload)));

  const url = `${getPlatformOrigin(env)}/home`;
  for (const r of recipients) {
    if (!r.email) continue;
    await dispatchLifecycleEmail(env, {
      type: 'admin_request',
      toUserId: r.id,
      toEmail: r.email,
      workspaceId,
      data: { requesterName, workspaceName: ws?.name || 'your workspace', action, reason: message, url },
    }).catch(() => {});
  }

  return json({ ok: true, status: 'sent', notified: recipients.length });
}
