import type { Env, WorkspaceRole } from '../types';
import { generateId } from '../crypto-utils';
import { createInviteClaim, expireOtherInviteClaims, sendInviteEmail } from '../workspaces-invite-email';
import { getPlatformOrigin } from '../config/origins';
import { parseEmails } from './parse-emails';
import { dispatchLifecycleEmail } from '../email/gateway';
import { getWorkspaceAccessPolicy, isEmailAllowedByPolicy } from './access-policy';
import { invalidateWorkspaceRole } from './roles';

export const MAX_BULK_INVITES = 100;

interface InviteContext {
  workspaceName: string;
  inviterName: string;
}

async function getInviteContext(env: Env, workspaceId: string, inviterId: string): Promise<InviteContext> {
  const ws = await env.DB.prepare('SELECT name FROM workspaces WHERE id = ?').bind(workspaceId).first<{ name: string }>();
  const inviter = await env.DB.prepare('SELECT name, email FROM users WHERE id = ?')
    .bind(inviterId).first<{ name: string | null; email: string | null }>();
  return {
    workspaceName: ws?.name || 'a workspace',
    inviterName: inviter?.name || inviter?.email || 'A teammate',
  };
}

type InviteStatus = 'added' | 'invited' | 'updated' | 'skipped';

/**
 * Plain per-email outcome for admins and agents:
 *   invited            — new or not-yet-active person; got an invite link (email_sent says if it went out)
 *   added              — already had an account; added and notified
 *   already_member     — was already in the workspace; nothing changed
 *   invalid_email      — not an email address
 *   domain_not_allowed — outside the workspace's allowed domains/emails
 */
export type InviteCode = 'invited' | 'added' | 'already_member' | 'invalid_email' | 'domain_not_allowed';

export interface InviteResult {
  email: string;
  status: InviteStatus;
  reason?: string;
  code: InviteCode;
  email_sent?: boolean;
  /** Join link, only when the invite email did not go out — share it by hand. */
  invite_url?: string;
}

export interface InviteOptions {
  /** Leave an existing member's role alone (bulk invite). Default: upsert the role. */
  keepRole?: boolean;
  /** Optional note from the inviter, passed to the invite email. */
  message?: string;
}

/** Add an existing user to the workspace, or pre-create + invite a new one. */
export async function inviteOrAddMember(
  env: Env,
  workspaceId: string,
  inviterId: string,
  rawEmail: string,
  role: WorkspaceRole,
  ctx?: InviteContext,
  // External-sharing spine (work/030): a Sharee invite creates an EXTERNAL edge so
  // the human is excluded from seats/internal listings. Applied only when the edge is
  // NEW — an existing internal member added to a Sharee is never downgraded.
  memberClass: 'internal' | 'external' = 'internal',
  opts: InviteOptions = {}
): Promise<InviteResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { email: rawEmail, status: 'skipped', reason: 'invalid_email', code: 'invalid_email' };
  }

  const policy = await getWorkspaceAccessPolicy(env, workspaceId);
  if (policy && !isEmailAllowedByPolicy(policy, email)) {
    return { email, status: 'skipped', reason: 'domain_not_allowed', code: 'domain_not_allowed' };
  }

  let target = await env.DB.prepare('SELECT id, last_login_at FROM users WHERE email = ?')
    .bind(email).first<{ id: string; last_login_at: string | null }>();
  let isNew = false;
  if (!target) {
    const userId = generateId('usr');
    await env.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)')
      .bind(userId, email, email.split('@')[0]).run();
    target = { id: userId, last_login_at: null };
    isNew = true;
  }

  const existing = await env.DB.prepare(
    'SELECT id, role, member_class FROM workspace_members WHERE workspace_id = ? AND user_id = ?'
  ).bind(workspaceId, target.id).first<{ id: string; role: WorkspaceRole; member_class: string }>();

  let status: InviteStatus;
  if (existing) {
    // Two edges an add/invite must never walk over:
    //   - the OWNER's role (remove-member already refuses; add must too, or any admin
    //     can demote the owner by "re-adding" them as a member),
    //   - an existing INTERNAL member's role when the caller is inviting them as an
    //     external Sharee contact (that path always passes role='member').
    const wouldDemoteOwner = existing.role === 'owner';
    const externalTouchingInternal = memberClass === 'external' && existing.member_class === 'internal';
    if (!wouldDemoteOwner && !externalTouchingInternal && !opts.keepRole) {
      await env.DB.prepare(
        'UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?'
      ).bind(role, workspaceId, target.id).run();
    }
    status = 'updated';
  } else {
    await env.DB.prepare(
      'INSERT INTO workspace_members (id, workspace_id, user_id, role, invited_by, member_class) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(generateId('wsm'), workspaceId, target.id, role, inviterId, memberClass).run();
    status = 'added';

    // Tell the workspace owner a member joined — but only when the member is already
    // active. A pre-created invitee hasn't accepted yet, so "joined" would be premature;
    // the inviter hears about them via invite_accepted at claim time instead.
    const ws = await env.DB.prepare('SELECT owner_id, name FROM workspaces WHERE id = ?')
      .bind(workspaceId).first<{ owner_id: string; name: string }>();
    if (ws?.owner_id && ws.owner_id !== target.id && target.last_login_at) {
      const m = await env.DB.prepare('SELECT name, email FROM users WHERE id = ?')
        .bind(target.id).first<{ name: string | null; email: string | null }>();
      const memberName = m?.name || (m?.email ? m.email.split('@')[0] : 'A new member');
      await dispatchLifecycleEmail(env, {
        type: 'member_joined',
        toUserId: ws.owner_id,
        data: { memberName, workspaceName: ws.name },
      }).catch(() => {});
    }
  }

  await invalidateWorkspaceRole(env, workspaceId, target.id);

  let emailSent: boolean | undefined;
  let inviteUrl: string | undefined;
  // Email a claim code to anyone who hasn't activated their account yet; existing
  // active users who were just added get a plain "you've been added" notification.
  if (isNew || !target.last_login_at) {
    try {
      const inviteCtx = ctx ?? await getInviteContext(env, workspaceId, inviterId);
      const claim = await createInviteClaim(env, workspaceId, target.id, email, inviterId);
      // Re-inviting a pending person is a resend: only the newest link works.
      if (existing) await expireOtherInviteClaims(env, workspaceId, target.id, claim.id);
      const sent = await sendInviteEmail(env, {
        email,
        workspaceName: inviteCtx.workspaceName,
        inviterName: inviteCtx.inviterName,
        claimCode: claim.code,
        claimId: claim.id,
        personalMessage: opts.message,
      });
      status = 'invited';
      emailSent = !!sent?.sent;
      if (!emailSent) inviteUrl = `${getPlatformOrigin(env)}/invite/${encodeURIComponent(claim.code)}`;
    } catch {
      // Email/claim failure shouldn't roll back membership; surface as added.
    }
  } else if (status === 'added') {
    try {
      const inviteCtx = ctx ?? await getInviteContext(env, workspaceId, inviterId);
      await dispatchLifecycleEmail(env, {
        type: 'added_to_workspace',
        toUserId: target.id,
        toEmail: email,
        data: { workspaceName: inviteCtx.workspaceName, inviterName: inviteCtx.inviterName },
      }).catch(() => {});
    } catch {
      // Best-effort notification; never block membership.
    }
  }

  const code: InviteCode = status === 'invited' ? 'invited' : status === 'added' ? 'added' : 'already_member';
  return {
    email, status, code,
    ...(emailSent === undefined ? {} : { email_sent: emailSent }),
    ...(inviteUrl ? { invite_url: inviteUrl } : {}),
  };
}

/**
 * Invite everyone in `rawEmails` (array or pasted text — see parseEmails). Existing
 * members keep their role. Shared by the REST endpoint and the chat agent.
 */
export async function inviteMany(
  env: Env,
  workspaceId: string,
  inviterId: string,
  rawEmails: unknown,
  role: WorkspaceRole,
  message?: string
): Promise<{ results: InviteResult[]; summary: Record<InviteCode, number> }> {
  const { emails, invalid } = parseEmails(rawEmails);
  const ctx = await getInviteContext(env, workspaceId, inviterId);
  const results: InviteResult[] = invalid.map((email) => ({ email, status: 'skipped', reason: 'invalid_email', code: 'invalid_email' }));
  // Emails are deduped so invites are independent; run in bounded parallel waves
  // (caps concurrent invite-email sends) instead of one-at-a-time.
  const WAVE = 10;
  for (let i = 0; i < emails.length; i += WAVE) {
    results.push(...await Promise.all(
      emails.slice(i, i + WAVE).map((email) =>
        inviteOrAddMember(env, workspaceId, inviterId, email, role, ctx, 'internal', { keepRole: true, message }))
    ));
  }
  const summary: Record<InviteCode, number> = { invited: 0, added: 0, already_member: 0, invalid_email: 0, domain_not_allowed: 0 };
  for (const r of results) summary[r.code]++;
  return { results, summary };
}

export async function getWorkspaceInviteContext(
  env: Env,
  workspaceId: string,
  inviterId: string
): Promise<InviteContext> {
  return getInviteContext(env, workspaceId, inviterId);
}
