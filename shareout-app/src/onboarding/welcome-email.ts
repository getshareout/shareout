// Welcome email for brand-new accounts. Sent in the background (waitUntil) off
// the signup paths that carry an email (Google OAuth, email OTP). Points the user
// at the starter kit we just seeded into their home. No-ops without an EMAIL
// binding or recipient.
import type { Env } from '../types';
import { dispatchLifecycleEmail } from '../email/gateway';

export async function sendWelcomeEmail(env: Env, email: string): Promise<void> {
  if (!env.EMAIL || !email) return;
  try {
    await dispatchLifecycleEmail(env, { type: 'welcome', toEmail: email });
  } catch (e) {
    console.error('welcome email failed', email, e);
  }
}

/** Fire-and-forget welcome email; requires a waitUntil context (prod fetch path). */
export function scheduleWelcomeEmail(env: Env, email: string | null, executionCtx?: ExecutionContext): void {
  if (!executionCtx?.waitUntil || !email) return;
  executionCtx.waitUntil(sendWelcomeEmail(env, email));
}

// A pre-created invitee activating for the first time gets a welcome scoped to the
// workspace they were invited to — not the generic personal starter-kit welcome.
export async function sendWorkspaceWelcomeEmail(env: Env, userId: string, email: string): Promise<void> {
  if (!env.EMAIL || !email) return;
  try {
    const row = await env.DB.prepare(
      `SELECT w.name AS workspace_name, wm.role AS role, u.name AS inviter_name, u.email AS inviter_email
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       LEFT JOIN users u ON u.id = wm.invited_by
       WHERE wm.user_id = ? AND wm.member_class = 'internal'
       ORDER BY wm.created_at DESC LIMIT 1`
    ).bind(userId).first<{ workspace_name: string; role: string; inviter_name: string | null; inviter_email: string | null }>();
    if (!row) return; // no internal membership — nothing workspace-specific to welcome into
    const inviterName = row.inviter_name || (row.inviter_email ? row.inviter_email.split('@')[0] : 'A teammate');
    await dispatchLifecycleEmail(env, {
      type: 'workspace_welcome',
      toUserId: userId,
      toEmail: email,
      data: {
        workspaceName: row.workspace_name,
        inviterName,
        role: row.role === 'admin' ? 'an admin' : 'a member',
      },
    });
  } catch (e) {
    console.error('workspace welcome email failed', email, e);
  }
}

/** Fire-and-forget workspace welcome for a first-time invitee; needs waitUntil. */
export function scheduleWorkspaceWelcome(env: Env, userId: string, email: string | null, executionCtx?: ExecutionContext): void {
  if (!executionCtx?.waitUntil || !email) return;
  executionCtx.waitUntil(sendWorkspaceWelcomeEmail(env, userId, email));
}
