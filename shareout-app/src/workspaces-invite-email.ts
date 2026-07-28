import type { Env } from './types';
import type { AuthUser } from './api-auth';
import { generateToken, hashToken } from './api-auth';
import { generateId } from './crypto-utils';
import { dispatchLifecycleEmail } from './email/gateway';
import { jsonWithApiErrors } from './http/api-error';

const CLAIM_TTL_DAYS = 7;
// Human-friendly alphabet: no 0/O/1/I/L to avoid transcription errors.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateClaimCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5, 10).join('')}`;
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Mint a one-time claim code, store only its hash, and return the plaintext code.
export async function createInviteClaim(
  env: Env,
  workspaceId: string,
  userId: string,
  email: string,
  invitedBy: string
): Promise<string> {
  const code = generateClaimCode();
  await env.DB.prepare(
    `INSERT INTO workspace_invite_claims (id, workspace_id, user_id, email, code_hash, invited_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now', ?))`
  ).bind(
    generateId('inv'),
    workspaceId,
    userId,
    email,
    await sha256(code),
    invitedBy,
    `+${CLAIM_TTL_DAYS} days`
  ).run();
  return code;
}

export async function sendInviteEmail(
  env: Env,
  args: { email: string; workspaceName: string; inviterName: string; claimCode: string }
): Promise<void> {
  await dispatchLifecycleEmail(env, {
    type: 'workspace_invite',
    toEmail: args.email,
    data: {
      workspaceName: args.workspaceName,
      inviterName: args.inviterName,
      claimCode: args.claimCode,
      claimTtlDays: CLAIM_TTL_DAYS,
    },
  });
}

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

export interface InviteClaim {
  id: string;
  workspace_id: string;
  user_id: string;
  email: string;
  invited_by: string | null;
}

export type ClaimResult =
  | { ok: true; claim: InviteClaim }
  | { ok: false; reason: 'INVALID_CODE' | 'CODE_USED' | 'CODE_EXPIRED' | 'CODE_MISMATCH'; invitedEmail?: string };

// Validate a claim code against the signed-in user. Pure read — does NOT consume the
// code. Shared by the web accept page (/invite/<code>) and the agent claim API so both
// enforce the same rules: exists, unused, unexpired, and owned by this session.
export async function resolveClaim(
  env: Env,
  rawCode: string,
  user: { id: string; email: string | null }
): Promise<ClaimResult> {
  const code = (rawCode || '').trim().toUpperCase();
  if (!code) return { ok: false, reason: 'INVALID_CODE' };

  const claim = await env.DB.prepare(
    `SELECT id, workspace_id, user_id, email, invited_by, claimed_at,
            (expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS expired
     FROM workspace_invite_claims WHERE code_hash = ?`
  ).bind(await sha256(code)).first<{
    id: string;
    workspace_id: string;
    user_id: string;
    email: string;
    invited_by: string | null;
    claimed_at: string | null;
    expired: number;
  }>();

  if (!claim) return { ok: false, reason: 'INVALID_CODE' };
  if (claim.claimed_at) return { ok: false, reason: 'CODE_USED' };
  if (claim.expired) return { ok: false, reason: 'CODE_EXPIRED' };

  // The redeeming session must own the invite (same account or same email).
  const sameUser = user.id === claim.user_id;
  const sameEmail = !!user.email && user.email.toLowerCase() === claim.email.toLowerCase();
  if (!sameUser && !sameEmail) {
    return { ok: false, reason: 'CODE_MISMATCH', invitedEmail: claim.email };
  }

  return {
    ok: true,
    claim: {
      id: claim.id,
      workspace_id: claim.workspace_id,
      user_id: claim.user_id,
      email: claim.email,
      invited_by: claim.invited_by,
    },
  };
}

/** Mark a resolved claim as consumed. Idempotent-safe: single-use is enforced by resolveClaim. */
export async function markClaimClaimed(env: Env, claimId: string): Promise<void> {
  await env.DB.prepare("UPDATE workspace_invite_claims SET claimed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .bind(claimId).run();
}

/** Tell the inviter their invite was accepted — closes the invite loop. Best-effort. */
export async function notifyInviteAccepted(env: Env, claim: InviteClaim): Promise<void> {
  if (!claim.invited_by) return;
  const [ws, member] = await Promise.all([
    env.DB.prepare('SELECT name FROM workspaces WHERE id = ?').bind(claim.workspace_id).first<{ name: string }>(),
    env.DB.prepare('SELECT name, email FROM users WHERE id = ?').bind(claim.user_id).first<{ name: string | null; email: string | null }>(),
  ]);
  const memberName = member?.name || (member?.email ? member.email.split('@')[0] : 'A new member');
  await dispatchLifecycleEmail(env, {
    type: 'invite_accepted',
    toUserId: claim.invited_by,
    data: { memberName, workspaceName: ws?.name || 'your workspace' },
  }).catch(() => {});
}

/** Peek invite metadata without consuming the code — for the unauth join card. */
export async function peekInvite(
  env: Env,
  rawCode: string
): Promise<{ workspaceName: string; inviterName: string } | null> {
  const code = (rawCode || '').trim().toUpperCase();
  if (!code) return null;
  const claim = await env.DB.prepare(
    `SELECT workspace_id, invited_by, claimed_at,
            (expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS expired
     FROM workspace_invite_claims WHERE code_hash = ?`
  ).bind(await sha256(code)).first<{
    workspace_id: string;
    invited_by: string | null;
    claimed_at: string | null;
    expired: number;
  }>();
  if (!claim || claim.claimed_at || claim.expired) return null;

  const [ws, inviter] = await Promise.all([
    env.DB.prepare('SELECT name FROM workspaces WHERE id = ?')
      .bind(claim.workspace_id).first<{ name: string }>(),
    claim.invited_by
      ? env.DB.prepare('SELECT name, email FROM users WHERE id = ?')
          .bind(claim.invited_by).first<{ name: string | null; email: string | null }>()
      : Promise.resolve(null),
  ]);
  if (!ws?.name) return null;
  const inviterName =
    inviter?.name || (inviter?.email ? inviter.email.split('@')[0] : 'A teammate');
  return { workspaceName: ws.name, inviterName };
}

/**
 * Where to drop someone after they accept. Externals → /shared; internals →
 * workspace subdomain /home when on prod apex, else apex /home?workspace=.
 */
export async function inviteLandingUrl(
  env: Env,
  origin: string,
  claim: InviteClaim
): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT w.slug AS slug, wm.member_class AS member_class
     FROM workspaces w
     LEFT JOIN workspace_members wm
       ON wm.workspace_id = w.id AND wm.user_id = ?
     WHERE w.id = ?`
  ).bind(claim.user_id, claim.workspace_id).first<{
    slug: string | null;
    member_class: string | null;
  }>();

  if ((row?.member_class ?? 'internal') === 'external') {
    return new URL('/shared', origin).toString();
  }

  const slug = row?.slug?.trim();
  try {
    const u = new URL(origin);
    const host = u.hostname;
    // Only rewrite on the real prod apex — staging/localhost don't host workspace subs.
    if (slug && (host === 'shareout.site' || host === 'www.shareout.site')) {
      u.hostname = `${slug}.shareout.site`;
      u.pathname = '/home';
      u.search = '';
      u.hash = '';
      return u.toString();
    }
  } catch {
    /* fall through */
  }
  return new URL(`/home?workspace=${encodeURIComponent(claim.workspace_id)}`, origin).toString();
}

// POST /v1/invites/claim { code } — called by the skill on the signed-in user's
// behalf. Validates the code, mints a real API token, returns it exactly once.
export async function handleClaimInvite(request: Request, env: Env, user: AuthUser): Promise<Response> {
  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const result = await resolveClaim(env, body.code || '', user);
  if (!result.ok) {
    const map = {
      INVALID_CODE: { msg: 'Invalid or unknown code', status: 400 },
      CODE_USED: { msg: 'This code has already been used', status: 400 },
      CODE_EXPIRED: { msg: 'This code has expired', status: 400 },
      CODE_MISMATCH: { msg: 'This invite belongs to a different account', status: 403 },
    }[result.reason];
    return json({ error: map.msg, code: result.reason }, map.status);
  }

  const { claim } = result;
  const token = generateToken();
  const tokenHash = await hashToken(token);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES (?, 'user', ?, ?, ?, ?)")
      .bind(generateId('tok'), claim.user_id, claim.user_id, tokenHash, 'invite'),
    env.DB.prepare("UPDATE workspace_invite_claims SET claimed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(claim.id),
  ]);
  await notifyInviteAccepted(env, claim);

  return json({ token, user_id: claim.user_id, workspace_id: claim.workspace_id });
}
