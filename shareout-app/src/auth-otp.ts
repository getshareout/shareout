import type { Env } from './types';
import type { FetchContext } from './router/context';
import { generateId, sha256 } from './crypto-utils';
import { dispatchLifecycleEmail } from './email/gateway';
import { createSessionCookieForUser, upsertUserByEmail, getSessionUser } from './auth';
import { SIGNUPS_PAUSED_MSG } from './signup-gate';
import { autoJoinWorkspacesByDomain } from './workspaces';
import { linkIdentity, getLinkedAccounts, unlinkIdentity } from './account-links';
import { getTokenOrSessionUser } from './router/helpers/auth-guard';
import { verifyTurnstile } from './turnstile';
import {
  checkEmailOtpStartLimit,
  checkEmailOtpVerifyLimit,
  getClientIp,
  rateLimitResponse,
} from './rate-limit';
import { scheduleSeedStarterKit } from './starter-kit';
import { scheduleWelcomeEmail, scheduleWorkspaceWelcome } from './onboarding/welcome-email';
import { jsonWithApiErrors } from './http/api-error';

const OTP_TTL_MS = 10 * 60 * 1000; // codes valid for 10 minutes
const OTP_RESEND_WINDOW_MS = 30 * 1000; // min gap between sends to one email
const OTP_MAX_PER_HOUR = 6;
const OTP_MAX_ATTEMPTS = 5;

function normalizeEmail(email: string): string {
  return (email || '').toLowerCase().trim();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return n.toString().padStart(6, '0');
}

async function hashCode(email: string, code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${email}:${code}`);
  return sha256(bytes.buffer as ArrayBuffer);
}

interface StartResult {
  ok: boolean;
  error?: string;
}

export async function startEmailOtp(env: Env, emailRaw: string): Promise<StartResult> {
  const email = normalizeEmail(emailRaw);
  if (!isValidEmail(email)) return { ok: false, error: 'That doesn’t look like a valid email — mind checking it?' };

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const recent = await env.DB.prepare(
    'SELECT created_at FROM email_otp_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(email).first<{ created_at: string }>();
  if (recent && now - Date.parse(recent.created_at) < OTP_RESEND_WINDOW_MS) {
    return { ok: false, error: 'Just sent one — give it a few seconds before requesting another.' };
  }

  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM email_otp_codes WHERE email = ? AND created_at > ?'
  ).bind(email, new Date(now - 60 * 60 * 1000).toISOString()).first<{ c: number }>();
  if (count && count.c >= OTP_MAX_PER_HOUR) {
    return { ok: false, error: 'Too many codes for this email today. Try again later.' };
  }

  const code = generateOtp();

  // Retire any outstanding codes so only the newest one verifies.
  await env.DB.prepare(
    'UPDATE email_otp_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL'
  ).bind(nowIso, email).run();

  await env.DB.prepare(
    'INSERT INTO email_otp_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(
    generateId('otp'),
    email,
    await hashCode(email, code),
    new Date(now + OTP_TTL_MS).toISOString(),
    nowIso,
  ).run();

  if (env.EMAIL) {
    await dispatchLifecycleEmail(env, { type: 'otp', toEmail: email, data: { code } });
  } else {
    // No email binding (local dev): surface the code in logs so the flow is testable.
    console.log(`[auth-otp] code for ${email}: ${code}`);
  }

  return { ok: true };
}

interface VerifyResult {
  ok: boolean;
  error?: string;
  user?: { id: string; email: string; isNew: boolean; firstActivation: boolean };
}

export async function verifyEmailOtp(env: Env, emailRaw: string, codeRaw: string): Promise<VerifyResult> {
  const email = normalizeEmail(emailRaw);
  const code = (codeRaw || '').trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: 'Enter the 6-digit code from your email.' };

  const nowIso = new Date().toISOString();
  const row = await env.DB.prepare(
    'SELECT id, code_hash, expires_at, attempts FROM email_otp_codes WHERE email = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1'
  ).bind(email).first<{ id: string; code_hash: string; expires_at: string; attempts: number }>();

  if (!row) return { ok: false, error: 'No active code — request a fresh one.' };
  if (row.expires_at < nowIso) return { ok: false, error: 'That code expired. Request a new one.' };
  if (row.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, error: 'Too many tries. Request a new code.' };

  const candidate = await hashCode(email, code);
  if (candidate !== row.code_hash) {
    await env.DB.prepare('UPDATE email_otp_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    return { ok: false, error: 'That code didn’t match. Try again.' };
  }

  await env.DB.prepare('UPDATE email_otp_codes SET consumed_at = ? WHERE id = ?').bind(nowIso, row.id).run();

  let user: { id: string; email: string; isNew: boolean; firstActivation: boolean };
  try {
    user = await upsertUserByEmail(env, email);
  } catch (e: any) {
    if (e?.message === SIGNUPS_PAUSED_MSG) return { ok: false, error: SIGNUPS_PAUSED_MSG };
    throw e;
  }
  await autoJoinWorkspacesByDomain(env, user.id, user.email);
  return { ok: true, user };
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return jsonWithApiErrors(data, status, headers);
}

export async function handleEmailOtpStart(ctx: FetchContext): Promise<Response> {
  const body = await ctx.request.json().catch(() => ({})) as { email?: string; turnstileToken?: string };
  const rl = await checkEmailOtpStartLimit(ctx.env, ctx.request);
  if (!rl.allowed) return rateLimitResponse(rl);
  // Anti-Sybil (Workstream F): a Turnstile challenge gates the OTP send so scripts
  // can't mass-create accounts or email-bomb an address. No-ops when Turnstile is
  // not configured. Fail closed (verifier outage) on this protected endpoint.
  const human = await verifyTurnstile(ctx.env, body.turnstileToken, getClientIp(ctx.request));
  if (!human) {
    return json({ ok: false, error: 'Bot check failed. Please retry.', code: 'TURNSTILE_FAILED' }, 403);
  }
  const result = await startEmailOtp(ctx.env, body.email || '');
  return json(result, result.ok ? 200 : 400);
}

export async function handleEmailOtpVerify(ctx: FetchContext): Promise<Response> {
  const body = await ctx.request.json().catch(() => ({})) as { email?: string; code?: string };
  const rl = await checkEmailOtpVerifyLimit(ctx.env, ctx.request);
  if (!rl.allowed) return rateLimitResponse(rl);
  const result = await verifyEmailOtp(ctx.env, body.email || '', body.code || '');
  if (!result.ok || !result.user) {
    return json({ ok: false, error: result.error }, 400);
  }
  // First-ever activation (parity with Google OAuth). Self-signup gets personal kit;
  // pre-created invitee gets a workspace-scoped welcome instead.
  if (result.user.firstActivation) {
    if (result.user.isNew) {
      scheduleSeedStarterKit(ctx.env, { id: result.user.id, email: result.user.email, username: null }, { workspaceId: null, tier: 'personal' }, ctx.executionCtx);
      scheduleWelcomeEmail(ctx.env, result.user.email, ctx.executionCtx);
    } else {
      scheduleWorkspaceWelcome(ctx.env, result.user.id, result.user.email, ctx.executionCtx);
    }
  }
  const cookie = await createSessionCookieForUser(ctx.env, ctx.url, result.user.id, result.user.email);
  return json({ ok: true, user: { email: result.user.email } }, 200, { 'Set-Cookie': cookie });
}

export async function handleSessionInfo(ctx: FetchContext): Promise<Response> {
  const user = await getSessionUser(ctx.request, ctx.env);
  return json({ user: user ? { email: user.email } : null });
}

// ── Linking a second email to the signed-in account (account linking) ──────────
// Same OTP transport as sign-in, but on verify we fold the verified account into
// the current user's identity group instead of minting a new session.

export async function handleLinkEmailOtpStart(ctx: FetchContext): Promise<Response> {
  const user = await getTokenOrSessionUser(ctx);
  if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
  const rl = await checkEmailOtpStartLimit(ctx.env, ctx.request);
  if (!rl.allowed) return rateLimitResponse(rl);
  const body = await ctx.request.json().catch(() => ({})) as { email?: string };
  const email = normalizeEmail(body.email || '');
  if (user.email && email === normalizeEmail(user.email)) {
    return json({ ok: false, error: "That's the account you're already signed in as." }, 400);
  }
  const result = await startEmailOtp(ctx.env, email);
  return json(result, result.ok ? 200 : 400);
}

export async function handleLinkEmailOtpVerify(ctx: FetchContext): Promise<Response> {
  const user = await getTokenOrSessionUser(ctx);
  if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
  const rl = await checkEmailOtpVerifyLimit(ctx.env, ctx.request);
  if (!rl.allowed) return rateLimitResponse(rl);
  const body = await ctx.request.json().catch(() => ({})) as { email?: string; code?: string };
  const result = await verifyEmailOtp(ctx.env, body.email || '', body.code || '');
  if (!result.ok || !result.user) {
    return json({ ok: false, error: result.error }, 400);
  }
  const link = await linkIdentity(ctx.env, user.id, result.user.id);
  if (!link.success) return json({ ok: false, error: link.error }, 400);
  return json({ ok: true, email: result.user.email });
}

export async function handleListLinkedAccounts(ctx: FetchContext): Promise<Response> {
  const user = await getTokenOrSessionUser(ctx);
  if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
  const accounts = await getLinkedAccounts(ctx.env, user.id);
  return json({ ok: true, accounts });
}

export async function handleUnlinkAccount(ctx: FetchContext, targetUserId: string): Promise<Response> {
  const user = await getTokenOrSessionUser(ctx);
  if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
  const result = await unlinkIdentity(ctx.env, user.id, targetUserId);
  if (!result.success) return json({ ok: false, error: result.error }, 400);
  return json({ ok: true });
}
