/**
 * Guest comments: people reviewing through a public or password link comment without
 * an account. A guest proves an email with a one-time code and gets a signed,
 * short-lived token bound to ONE artifact (HMAC over artifact id + display name +
 * keyed email hash), held in an HttpOnly cookie. Guests comment and reply; they never
 * resolve, assign, react or approve (those all need a signed-in session).
 *
 * Why an email code and not Turnstile: a Turnstile pass proves "a human", not who it
 * is, so anyone could comment as any name and address. The code binds the guest to an
 * inbox they control, works on every instance (Turnstile is optional), and costs one
 * email behind per-IP and per-address caps.
 *
 * The bar a guest must clear on every write:
 *  - the owner turned guests on (artifact config, or inherited from a folder),
 *  - the artifact is one they can already view without an account (public, or a
 *    password/credentials page they unlocked — the access cookie proves it),
 *  - a valid token for THIS artifact,
 *  - an Origin from this instance (cookie writes are CSRF-checked; the cookie is also
 *    SameSite=Strict).
 */
import { errorResponse, successResponse, type DataContext } from '../middleware';
import { signPayload, verifySignature, verifyAccessToken, extractTokenFromCookie } from '../../token';
import { generateId, sha256 } from '../../crypto-utils';
import { normalizeVisibility } from '../../visibility-config';
import { getPlatformHostname, getPlatformOrigin } from '../../config/origins';
import { cookieSecureAttr, isShareoutOrigin } from '../../auth/cookies';
import { checkKVRateLimit, rateLimitClientKey, rateLimitResponse } from '../../rate-limit';
import { dispatchLifecycleEmail } from '../../email/gateway';
import { isAssetBucketArtifact } from './file-comments';
import type { CommentsConfig } from './types';

export const GUEST_TOKEN_TTL_SEC = 12 * 60 * 60;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RESEND_MS = 30 * 1000;
const CODE_MAX_PER_HOUR = 6;
const CODE_MAX_ATTEMPTS = 5;
const NAME_MAX = 80;
const TOKEN_VERSION = 'guest.v1';

export interface GuestIdentity {
  name: string;
  emailHash: string;
  /** Rate-limit key for this guest on this artifact. */
  key: string;
}

interface GuestTokenPayload { a: string; n: string; h: string; exp: number }

export const guestCookieName = (artifactId: string) => `shareout_guest_${artifactId}`;

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

export function normalizeGuestEmail(raw: unknown): string | null {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

export function normalizeGuestName(raw: unknown): string | null {
  const name = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim() : '';
  return name ? name.slice(0, NAME_MAX) : null;
}

/** Keyed hash of a guest's email: stable per instance, not reversible without the secret. */
export async function hashGuestEmail(secret: string, email: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`guest-email:${email}`));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signGuestToken(secret: string, artifactId: string, name: string, emailHash: string, ttlSec = GUEST_TOKEN_TTL_SEC): Promise<string> {
  const payload: GuestTokenPayload = { a: artifactId, n: name, h: emailHash, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const data = b64url(JSON.stringify(payload));
  return `${data}.${await signPayload(`${TOKEN_VERSION}.${data}`, secret)}`;
}

export async function verifyGuestToken(secret: string, token: string, artifactId: string): Promise<GuestIdentity | null> {
  try {
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    if (!(await verifySignature(`${TOKEN_VERSION}.${data}`, sig, secret))) return null;
    const p = JSON.parse(unb64url(data)) as GuestTokenPayload;
    if (p.a !== artifactId || typeof p.n !== 'string' || typeof p.h !== 'string') return null;
    if (!(p.exp > Date.now() / 1000)) return null;
    return { name: p.n, emailHash: p.h, key: `${artifactId}:${p.h}` };
  } catch {
    return null;
  }
}

/** CSRF gate for cookie-authenticated guest writes (comment guests and space guests): the
 *  request must come from a page on this instance (same origin, the platform origin, or one of its subdomains). A missing
 *  or opaque ("null") Origin — a sandboxed artifact, another site — fails. */
export function isTrustedGuestOrigin(request: Request, ctx: Pick<DataContext, 'env'>): boolean {
  const origin = request.headers.get('Origin');
  if (!origin || origin === 'null') return false;
  try {
    if (origin === new URL(request.url).origin) return true;
  } catch { /* fall through */ }
  if (origin === getPlatformOrigin(ctx.env)) return true;
  return origin.startsWith('https://') && isShareoutOrigin(origin, getPlatformHostname(ctx.env));
}

/** Whether a person with no account can already view this artifact: a public page, or a
 *  password/credentials page whose access token this request carries. */
export async function guestCanView(request: Request, ctx: DataContext): Promise<boolean> {
  const method = ctx.artifact.auth_method;
  if (method === 'password' || method === 'credentials') {
    const auth = request.headers.get('Authorization');
    const token = auth?.startsWith('Bearer ')
      ? auth.slice(7)
      : extractTokenFromCookie(request.headers.get('Cookie'), new RegExp(`shareout_access_${ctx.artifactId}=([^;]+)`));
    if (!token) return false;
    const p = await verifyAccessToken(token, ctx.artifactId, ctx.env);
    return !!p && (p.authType === 'password' || p.authType.startsWith('cred:'));
  }
  return normalizeVisibility(ctx.artifact.visibility) === 'public';
}

/** The folder setting an artifact without its own inherits: on when any ancestor folder has it on. */
export async function folderGuestCommentsEnabled(env: DataContext['env'], artifactId: string): Promise<boolean> {
  const row = await env.DB.prepare(`
    WITH RECURSIVE up(id, parent_id, g, depth) AS (
      SELECT f.id, f.parent_id, f.guest_comments_enabled, 0
        FROM artifacts a JOIN folders f ON f.id = a.folder_id
       WHERE a.id = ? AND a.deleted_at IS NULL
      UNION ALL
      SELECT f.id, f.parent_id, f.guest_comments_enabled, up.depth + 1
        FROM folders f JOIN up ON f.id = up.parent_id
       WHERE up.depth < 32
    )
    SELECT 1 AS on_ FROM up WHERE g = 1 LIMIT 1
  `).bind(artifactId).first<{ on_: number }>();
  return !!row;
}

/** Effective guest setting: the artifact's own value when set, else its folders'. */
export async function isGuestCommentsEnabled(ctx: DataContext, config: CommentsConfig): Promise<boolean> {
  if (await isAssetBucketArtifact(ctx)) return false;
  if (typeof config.guestComments === 'boolean') return config.guestComments;
  return folderGuestCommentsEnabled(ctx.env, ctx.artifactId);
}

/** The verified guest on this request, or null. Applies the Origin check. */
export async function resolveGuest(request: Request, ctx: DataContext): Promise<GuestIdentity | null> {
  const token = extractTokenFromCookie(request.headers.get('Cookie'), new RegExp(`${guestCookieName(ctx.artifactId)}=([^;]+)`));
  if (!token || !ctx.env.SESSION_SECRET) return null;
  if (!isTrustedGuestOrigin(request, ctx)) return null;
  return verifyGuestToken(ctx.env.SESSION_SECRET, token, ctx.artifactId);
}

/** Guests may act here at all: on, viewable without an account. */
export async function guestCommentsOpen(request: Request, ctx: DataContext, config: CommentsConfig): Promise<boolean> {
  return (await isGuestCommentsEnabled(ctx, config)) && (await guestCanView(request, ctx));
}

/** Per-IP and per-guest ceilings on guest comments. Null = allowed. */
export async function guestCommentRateLimit(request: Request, ctx: DataContext, guest: GuestIdentity): Promise<Response | null> {
  const kv = ctx.env.RATE_LIMIT_KV;
  const ip = await checkKVRateLimit(kv, rateLimitClientKey(request), 'guestCommentIp');
  if (!ip.allowed) return rateLimitResponse(ip);
  const tok = await checkKVRateLimit(kv, guest.key, 'guestCommentToken');
  if (!tok.allowed) return rateLimitResponse(tok);
  return null;
}

function guestCookie(request: Request, artifactId: string, value: string, maxAge: number): string {
  return `${guestCookieName(artifactId)}=${value}; Path=/v1/data/; HttpOnly;${cookieSecureAttr(new URL(request.url))} SameSite=Strict; Max-Age=${maxAge}`;
}

const codeKey = (artifactId: string, emailHash: string) => `guest:${artifactId}:${emailHash}`;
const hashCode = (key: string, code: string) => sha256(new TextEncoder().encode(`${key}:${code}`).buffer as ArrayBuffer);

function newCode(): string {
  return (crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).toString().padStart(6, '0');
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const b = await request.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? b as Record<string, unknown> : {};
}

const notOpen = () => errorResponse({ code: 'GUEST_COMMENTS_DISABLED', message: 'Guest comments are not available on this page', status: 403 });
const badOrigin = () => errorResponse({ code: 'FORBIDDEN', message: 'Guest sign-in must come from this page', status: 403 });

async function artifactTitle(ctx: DataContext): Promise<string> {
  return ctx.artifact.name?.trim() || 'a page';
}

/** `/_guest` — GET status, POST `code` (send a code), POST `verify` (code → cookie), DELETE (sign out). */
export async function handleGuest(request: Request, ctx: DataContext, config: CommentsConfig, sub: string | undefined): Promise<Response> {
  const method = request.method.toUpperCase();

  // A space guest with a comment grant is already verified for every page in its space.
  if (!sub && method === 'GET' && ctx.spaceGuest?.capability === 'comment') {
    return successResponse({ enabled: true, guest: { name: ctx.spaceGuest.name }, space: true });
  }

  if (!sub && method === 'GET') {
    const enabled = await guestCommentsOpen(request, ctx, config);
    const guest = enabled ? await resolveGuestForRead(request, ctx) : null;
    return successResponse({ enabled, guest: guest ? { name: guest.name } : null });
  }

  if (!sub && method === 'DELETE') {
    if (!isTrustedGuestOrigin(request, ctx)) return badOrigin();
    const res = successResponse({ signedOut: true });
    res.headers.append('Set-Cookie', guestCookie(request, ctx.artifactId, '', 0));
    return res;
  }

  if (method !== 'POST' || (sub !== 'code' && sub !== 'verify')) {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }
  if (!isTrustedGuestOrigin(request, ctx)) return badOrigin();
  if (!ctx.env.SESSION_SECRET) return notOpen();
  if (!(await guestCommentsOpen(request, ctx, config))) return notOpen();

  const body = await readBody(request);
  const email = normalizeGuestEmail(body.email);
  const name = normalizeGuestName(body.name);
  if (!email) return errorResponse({ code: 'VALIDATION_ERROR', message: 'A valid email is required', status: 400, param: 'email' });
  if (!name) return errorResponse({ code: 'VALIDATION_ERROR', message: 'Your name is required', status: 400, param: 'name' });
  const emailHash = await hashGuestEmail(ctx.env.SESSION_SECRET, email);
  const key = codeKey(ctx.artifactId, emailHash);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  if (sub === 'code') {
    const rl = await checkKVRateLimit(ctx.env.RATE_LIMIT_KV, rateLimitClientKey(request), 'guestCodeStart');
    if (!rl.allowed) return rateLimitResponse(rl);
    const recent = await ctx.env.DB.prepare(
      'SELECT created_at FROM email_otp_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1',
    ).bind(key).first<{ created_at: string }>();
    if (recent && now - Date.parse(recent.created_at) < CODE_RESEND_MS) {
      return errorResponse({ code: 'RATE_LIMIT_EXCEEDED', message: 'A code was just sent. Wait a few seconds before asking again.', status: 429 });
    }
    const count = await ctx.env.DB.prepare(
      'SELECT COUNT(*) AS c FROM email_otp_codes WHERE email = ? AND created_at > ?',
    ).bind(key, new Date(now - 3_600_000).toISOString()).first<{ c: number }>();
    if ((count?.c ?? 0) >= CODE_MAX_PER_HOUR) {
      return errorResponse({ code: 'RATE_LIMIT_EXCEEDED', message: 'Too many codes for this email. Try again later.', status: 429 });
    }
    const code = newCode();
    await ctx.env.DB.batch([
      ctx.env.DB.prepare('UPDATE email_otp_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL').bind(nowIso, key),
      ctx.env.DB.prepare('INSERT INTO email_otp_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(generateId('otp'), key, await hashCode(key, code), new Date(now + CODE_TTL_MS).toISOString(), nowIso),
    ]);
    if (ctx.env.EMAIL) {
      await dispatchLifecycleEmail(ctx.env, {
        type: 'guest_comment_code', toEmail: email, workspaceId: ctx.workspaceId || undefined,
        data: { code, title: await artifactTitle(ctx) },
      }).catch(() => undefined);
    } else {
      console.log(`[guest-comments] code for ${email}: ${code}`);
    }
    return successResponse({ sent: true });
  }

  const rl = await checkKVRateLimit(ctx.env.RATE_LIMIT_KV, rateLimitClientKey(request), 'guestCodeVerify');
  if (!rl.allowed) return rateLimitResponse(rl);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const wrong = () => errorResponse({ code: 'INVALID_CODE', message: 'That code did not match. Ask for a new one if it expired.', status: 400, param: 'code' });
  if (!/^\d{6}$/.test(code)) return wrong();
  const row = await ctx.env.DB.prepare(
    'SELECT id, code_hash, expires_at, attempts FROM email_otp_codes WHERE email = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1',
  ).bind(key).first<{ id: string; code_hash: string; expires_at: string; attempts: number }>();
  if (!row || row.expires_at < nowIso || row.attempts >= CODE_MAX_ATTEMPTS) return wrong();
  if ((await hashCode(key, code)) !== row.code_hash) {
    await ctx.env.DB.prepare('UPDATE email_otp_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    return wrong();
  }
  const consumed = await ctx.env.DB.prepare('UPDATE email_otp_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').bind(nowIso, row.id).run();
  if (!(consumed.meta?.changes ?? 0)) return wrong();

  const token = await signGuestToken(ctx.env.SESSION_SECRET, ctx.artifactId, name, emailHash);
  const res = successResponse({ guest: { name }, expiresIn: GUEST_TOKEN_TTL_SEC });
  res.headers.append('Set-Cookie', guestCookie(request, ctx.artifactId, token, GUEST_TOKEN_TTL_SEC));
  return res;
}

/** Reads (the status probe) need no Origin check: they reveal only the guest's own name. */
async function resolveGuestForRead(request: Request, ctx: DataContext): Promise<GuestIdentity | null> {
  const token = extractTokenFromCookie(request.headers.get('Cookie'), new RegExp(`${guestCookieName(ctx.artifactId)}=([^;]+)`));
  if (!token || !ctx.env.SESSION_SECRET) return null;
  return verifyGuestToken(ctx.env.SESSION_SECRET, token, ctx.artifactId);
}
