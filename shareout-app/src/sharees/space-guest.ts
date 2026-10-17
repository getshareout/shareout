/**
 * Space guests: an outside person invited to ONE folder (a "space") who views it — and,
 * with a comment grant, comments — without a ShareOut account. No user row, no workspace
 * membership, no password, no workspace picker.
 *
 * The grant is the whole identity: a `grants` row with subject_type 'guest', subject_id =
 * the guest's normalized email, on one folder, capability view|comment, optional expiry.
 * The guest proves the inbox (the invite link, or an email code on the portal) and gets a
 * space-guest session: an HMAC token bound to workspace + grant id + folder + keyed email
 * hash, with an expiry, in an HttpOnly, Secure, SameSite=Lax cookie named per grant.
 *
 * The token is only a pointer. Every request re-reads the grant (no cache): a revoked
 * grant (hard DELETE), an expired grant or a deleted folder ends the session on the next
 * request. The capability is read live too, so a downgrade applies at once.
 *
 * What a session reaches: the folder's subtree — its artifacts (not deleted), its
 * non-private files, their comments — up to the grant's capability. Nothing else: there
 * is no session user, so /home, search, members, the workspace agent and MCP all see an
 * anonymous caller, and the data API refuses every tier but the read paths a viewer needs.
 */
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { signPayload, verifySignature } from '../token';
import { generateId, sha256 } from '../crypto-utils';
import { capabilitySatisfies, type Capability } from '../access/can-access';
import { cookieSecureAttr } from '../auth/cookies';
import { getPlatformOrigin } from '../config/origins';
import { checkKVRateLimit, rateLimitClientKey, rateLimitResponse } from '../rate-limit';
import { dispatchLifecycleEmail } from '../email/gateway';
import { hashGuestEmail, isTrustedGuestOrigin, normalizeGuestEmail, normalizeGuestName } from '../data/comments/guest';
import { logAudit } from '../audit';
import { apiErrorResponse } from '../http/api-error';

export const SPACE_GUEST_TTL_SEC = 7 * 24 * 60 * 60;
export const SPACE_GUEST_INVITE_TTL_SEC = 14 * 24 * 60 * 60;
const SESSION_VERSION = 'space-guest.v1';
const INVITE_VERSION = 'space-guest-invite.v1';
const COOKIE_PREFIX = 'shareout_sg_';
const MAX_COOKIES = 8;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RESEND_MS = 30 * 1000;
const CODE_MAX_PER_HOUR = 6;
const CODE_MAX_ATTEMPTS = 5;
const NOW_ISO = () => new Date().toISOString();

export interface SpaceGuest {
  grantId: string;
  workspaceId: string;
  folderId: string;
  capability: Capability;
  email: string;
  emailHash: string;
  name: string;
  expiresAt: string | null;
}

interface SessionPayload { w: string; g: string; f: string; h: string; n: string; exp: number }
interface InvitePayload { g: string; f: string; h: string; exp: number }

interface GrantRow {
  id: string; workspace_id: string; resource_id: string; capability: string;
  subject_id: string; expires_at: string | null;
}

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

async function sign(version: string, payload: object, secret: string): Promise<string> {
  const data = b64url(JSON.stringify(payload));
  const sig = (await signPayload(`${version}.${data}`, secret)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${data}.${sig}`;
}

async function open<T>(version: string, token: string, secret: string): Promise<T | null> {
  try {
    const [data, sig, extra] = token.split('.');
    if (!data || !sig || extra !== undefined) return null;
    const std = sig.replace(/-/g, '+').replace(/_/g, '/');
    const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
    if (!(await verifySignature(`${version}.${data}`, padded, secret))) return null;
    const p = JSON.parse(unb64url(data)) as T & { exp?: unknown };
    if (typeof p.exp !== 'number' || !(p.exp > Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

export const spaceGuestCookieName = (grantId: string) => `${COOKIE_PREFIX}${grantId}`;

export function signSpaceGuestToken(secret: string, p: Omit<SessionPayload, 'exp'>, ttlSec = SPACE_GUEST_TTL_SEC): Promise<string> {
  return sign(SESSION_VERSION, { ...p, exp: Math.floor(Date.now() / 1000) + ttlSec }, secret);
}

export async function verifySpaceGuestToken(secret: string, token: string): Promise<SessionPayload | null> {
  const p = await open<SessionPayload>(SESSION_VERSION, token, secret);
  if (!p || typeof p.w !== 'string' || typeof p.g !== 'string' || typeof p.f !== 'string' || typeof p.h !== 'string') return null;
  return { ...p, n: typeof p.n === 'string' ? p.n : '' };
}

export function signSpaceGuestInvite(secret: string, p: Omit<InvitePayload, 'exp'>, ttlSec = SPACE_GUEST_INVITE_TTL_SEC): Promise<string> {
  return sign(INVITE_VERSION, { ...p, exp: Math.floor(Date.now() / 1000) + ttlSec }, secret);
}

async function verifySpaceGuestInvite(secret: string, token: string): Promise<InvitePayload | null> {
  const p = await open<InvitePayload>(INVITE_VERSION, token, secret);
  return p && typeof p.g === 'string' && typeof p.f === 'string' && typeof p.h === 'string' ? p : null;
}

/** Unverified folder id carried by an invite token, for the "link expired" fallback page. */
function inviteFolderHint(token: string): string | null {
  try {
    const f = (JSON.parse(unb64url(token.split('.')[0] ?? '')) as { f?: unknown }).f;
    return typeof f === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(f) ? f : null;
  } catch { return null; }
}

/** The live guest grant behind a session, or null when revoked, expired or its folder is gone. */
async function liveGuestGrant(env: Env, grantId: string): Promise<GrantRow | null> {
  const row = await env.DB.prepare(`
    SELECT g.id, g.workspace_id, g.resource_id, g.capability, g.subject_id, g.expires_at
      FROM grants g
      JOIN folders f ON f.id = g.resource_id AND f.workspace_id = g.workspace_id
     WHERE g.id = ? AND g.subject_type = 'guest' AND g.resource_type = 'folder'
  `).bind(grantId).first<GrantRow>();
  if (!row) return null;
  if (row.expires_at && row.expires_at <= NOW_ISO()) return null;
  if (row.capability !== 'view' && row.capability !== 'comment') return null;
  return row;
}

function defaultName(email: string): string {
  return email.split('@')[0] || 'Guest';
}

/** Re-checks a decoded session against the live grant: every bound field must still match. */
async function bindSession(env: Env, p: SessionPayload, grantIdFromCookie?: string): Promise<SpaceGuest | null> {
  if (grantIdFromCookie && grantIdFromCookie !== p.g) return null;
  const g = await liveGuestGrant(env, p.g);
  if (!g || g.workspace_id !== p.w || g.resource_id !== p.f) return null;
  const h = await hashGuestEmail(env.SESSION_SECRET, g.subject_id);
  if (h !== p.h) return null;
  return {
    grantId: g.id, workspaceId: g.workspace_id, folderId: g.resource_id,
    capability: g.capability as Capability, email: g.subject_id, emailHash: h,
    name: normalizeGuestName(p.n) || defaultName(g.subject_id), expiresAt: g.expires_at,
  };
}

/** Every live space-guest session on this request (one cookie per granted space). */
export async function resolveSpaceGuests(request: Request, env: Env): Promise<SpaceGuest[]> {
  const cookie = request.headers.get('Cookie');
  if (!cookie || !env.SESSION_SECRET || !cookie.includes(COOKIE_PREFIX)) return [];
  const found: Array<[string, string]> = [];
  for (const part of cookie.split(';')) {
    const i = part.indexOf('=');
    const name = part.slice(0, i).trim();
    if (i > 0 && name.startsWith(COOKIE_PREFIX)) found.push([name.slice(COOKIE_PREFIX.length), part.slice(i + 1).trim()]);
    if (found.length >= MAX_COOKIES) break;
  }
  const out: SpaceGuest[] = [];
  for (const [grantId, token] of found) {
    const p = await verifySpaceGuestToken(env.SESSION_SECRET, token);
    const guest = p ? await bindSession(env, p, grantId) : null;
    if (guest) out.push(guest);
  }
  return out;
}

/** A space guest from its grant id alone (the sandboxed artifact's bearer token). */
export async function spaceGuestFromGrant(env: Env, grantId: string, name?: string): Promise<SpaceGuest | null> {
  const g = await liveGuestGrant(env, grantId);
  if (!g) return null;
  return {
    grantId: g.id, workspaceId: g.workspace_id, folderId: g.resource_id,
    capability: g.capability as Capability, email: g.subject_id,
    emailHash: await hashGuestEmail(env.SESSION_SECRET, g.subject_id),
    name: normalizeGuestName(name) || defaultName(g.subject_id), expiresAt: g.expires_at,
  };
}

export type SpaceResource = 'artifact' | 'folder' | 'file';

/** True when `resourceId` sits inside the guest's granted folder subtree, in its workspace. */
export async function spaceGuestCovers(env: Env, guest: SpaceGuest, type: SpaceResource, resourceId: string): Promise<boolean> {
  const seed = type === 'artifact'
    ? 'SELECT a.folder_id AS id, 0 AS depth FROM artifacts a WHERE a.id = ? AND a.workspace_id = ? AND a.deleted_at IS NULL AND a.folder_id IS NOT NULL'
    : type === 'file'
      ? "SELECT d.folder_id AS id, 0 AS depth FROM asset_deliverables d WHERE d.id = ? AND d.workspace_id = ? AND d.deleted_at IS NULL AND d.folder_id IS NOT NULL AND d.visibility NOT IN ('private', 'team')"
      : 'SELECT f.id AS id, 0 AS depth FROM folders f WHERE f.id = ? AND f.workspace_id = ?';
  const row = await env.DB.prepare(`
    WITH RECURSIVE chain(id, depth) AS (
      ${seed}
      UNION
      SELECT f.parent_id, c.depth + 1 FROM folders f JOIN chain c ON f.id = c.id
       WHERE f.parent_id IS NOT NULL AND f.workspace_id = ? AND c.depth < 32
    )
    SELECT 1 AS ok FROM chain WHERE id = ? LIMIT 1
  `).bind(resourceId, guest.workspaceId, guest.workspaceId, guest.folderId).first<{ ok: number }>();
  return !!row;
}

/** The first live session on this request that reaches `resourceId` with `capability`. */
export async function spaceGuestFor(
  request: Request, env: Env, type: SpaceResource, resourceId: string, capability: Capability,
): Promise<SpaceGuest | null> {
  for (const g of await resolveSpaceGuests(request, env)) {
    if (capabilitySatisfies(g.capability, capability) && (await spaceGuestCovers(env, g, type, resourceId))) return g;
  }
  return null;
}

/** CSRF gate for cookie-authenticated guest writes: Origin must be this instance. */
export const isTrustedInstanceOrigin = (request: Request, env: Env): boolean => isTrustedGuestOrigin(request, { env });

/** Bearer token the sandboxed artifact uses for data calls: names the grant, re-checked per call. */
export const SPACE_GUEST_AUTH_PREFIX = 'sg:';

/** The artifact-scoped access token handed to the sandboxed page for a guest viewer. Same
 *  format as createAccessToken; authType `sg:<grant>` makes every data call re-check it. */
export async function mintSpaceGuestAccessToken(env: Env, artifactId: string, guest: SpaceGuest, ttlSec = 2 * 60 * 60): Promise<string> {
  const payload = {
    artifactId, authType: `${SPACE_GUEST_AUTH_PREFIX}${guest.grantId}`,
    exp: Math.floor(Date.now() / 1000) + ttlSec, n: encodeURIComponent(guest.name),
  };
  const data = btoa(JSON.stringify(payload));
  return `${data}.${await signPayload(data, env.SESSION_SECRET)}`;
}

/** Decode the guest name riding on a `sg:` access token (see mintSpaceGuestAccessToken). */
export function spaceGuestTokenName(payload: object): string | undefined {
  const n = (payload as { n?: unknown }).n;
  try { return typeof n === 'string' ? decodeURIComponent(n) : undefined; } catch { return undefined; }
}

export function spaceGuestCookie(request: Request, grantId: string, value: string, maxAge: number): string {
  return `${spaceGuestCookieName(grantId)}=${value}; Path=/; HttpOnly;${cookieSecureAttr(new URL(request.url))} SameSite=Lax; Max-Age=${maxAge}`;
}

async function mintSession(request: Request, env: Env, g: GrantRow, name: string): Promise<string> {
  const capSec = g.expires_at ? Math.floor((Date.parse(g.expires_at) - Date.now()) / 1000) : SPACE_GUEST_TTL_SEC;
  const ttl = Math.max(60, Math.min(SPACE_GUEST_TTL_SEC, capSec));
  const token = await signSpaceGuestToken(env.SESSION_SECRET, {
    w: g.workspace_id, g: g.id, f: g.resource_id, h: await hashGuestEmail(env.SESSION_SECRET, g.subject_id), n: name,
  }, ttl);
  return spaceGuestCookie(request, g.id, token, ttl);
}

/** "Who opened what": a guest's view, deduped per grant + resource per hour. Never throws. */
export async function recordSpaceGuestView(env: Env, guest: SpaceGuest, type: SpaceResource, resourceId: string): Promise<void> {
  try {
    const key = `sgactivity:${guest.grantId}:${type}:${resourceId}`;
    if (env.SLUGS) {
      try { if (await env.SLUGS.get(key)) return; } catch { /* log anyway */ }
    }
    await logAudit(env, {
      workspaceId: guest.workspaceId, actorEmail: guest.email, action: 'space_guest.view',
      targetType: type, targetId: resourceId, detail: { grant_id: guest.grantId },
    });
    if (env.SLUGS) {
      try { await env.SLUGS.put(key, '1', { expirationTtl: 3600 }); } catch { /* best-effort */ }
    }
  } catch { /* never break serving */ }
}

// --- Sharing ------------------------------------------------------------------

/** Email the invite link (a signed, expiring pointer to the grant). Best-effort. */
export async function sendSpaceGuestInvite(env: Env, grantId: string, sharer: AuthUser): Promise<boolean> {
  const g = await liveGuestGrant(env, grantId);
  if (!g || !env.SESSION_SECRET) return false;
  const meta = await env.DB.prepare(
    'SELECT f.name AS folder_name, w.name AS workspace_name FROM folders f JOIN workspaces w ON w.id = f.workspace_id WHERE f.id = ?',
  ).bind(g.resource_id).first<{ folder_name: string | null; workspace_name: string | null }>();
  const sharerRow = await env.DB.prepare('SELECT name, email FROM users WHERE id = ?').bind(sharer.id).first<{ name: string | null; email: string | null }>();
  const ttl = g.expires_at
    ? Math.max(60, Math.min(SPACE_GUEST_INVITE_TTL_SEC, Math.floor((Date.parse(g.expires_at) - Date.now()) / 1000)))
    : SPACE_GUEST_INVITE_TTL_SEC;
  const t = await signSpaceGuestInvite(env.SESSION_SECRET, {
    g: g.id, f: g.resource_id, h: await hashGuestEmail(env.SESSION_SECRET, g.subject_id),
  }, ttl);
  const url = `${getPlatformOrigin(env)}/shared/guest/accept?t=${encodeURIComponent(t)}`;
  const data = {
    sharerName: sharerRow?.name || sharerRow?.email || 'Someone',
    folderName: meta?.folder_name || 'a shared space',
    workspaceName: meta?.workspace_name || 'ShareOut',
    url,
  };
  if (!env.EMAIL) {
    console.log(`[space-guest] invite for ${g.subject_id}: ${url}`);
    return false;
  }
  const res = await dispatchLifecycleEmail(env, { type: 'space_guest_invite', toEmail: g.subject_id, workspaceId: g.workspace_id, data })
    .catch(() => ({ sent: false }));
  return !!res.sent;
}

// --- Portal sign-in ------------------------------------------------------------

/** Folder ids from `folderId` up to its root (the grants that may cover it). */
async function folderChain(env: Env, folderId: string): Promise<{ ids: string[]; workspaceId: string | null }> {
  const { results } = await env.DB.prepare(`
    WITH RECURSIVE chain(id, ws, depth) AS (
      SELECT id, workspace_id, 0 FROM folders WHERE id = ?
      UNION
      SELECT f.parent_id, f.workspace_id, c.depth + 1 FROM folders f JOIN chain c ON f.id = c.id
       WHERE f.parent_id IS NOT NULL AND c.depth < 32
    )
    SELECT id, ws FROM chain
  `).bind(folderId).all<{ id: string; ws: string | null }>();
  const rows = results || [];
  return { ids: rows.map((r) => r.id), workspaceId: rows[0]?.ws ?? null };
}

/** The live guest grant for `email` on `folderId` or an ancestor (nearest first), or null. */
async function guestGrantFor(env: Env, email: string, folderId: string): Promise<GrantRow | null> {
  const { ids, workspaceId } = await folderChain(env, folderId);
  if (!ids.length || !workspaceId) return null;
  const { results } = await env.DB.prepare(`
    SELECT id FROM grants
     WHERE workspace_id = ? AND subject_type = 'guest' AND subject_id = ? AND resource_type = 'folder'
       AND resource_id IN (SELECT value FROM json_each(?))
  `).bind(workspaceId, email, JSON.stringify(ids)).all<{ id: string }>();
  const live: GrantRow[] = [];
  for (const r of results || []) {
    const g = await liveGuestGrant(env, r.id);
    if (g) live.push(g);
  }
  live.sort((a, b) => ids.indexOf(a.resource_id) - ids.indexOf(b.resource_id) || (a.capability === 'comment' ? -1 : 1));
  return live[0] ?? null;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const b = await request.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? b as Record<string, unknown> : {};
}

const codeKey = (emailHash: string) => `sguest:${emailHash}`;
const hashCode = (key: string, code: string) => sha256(new TextEncoder().encode(`${key}:${code}`).buffer as ArrayBuffer);
const newCode = () => (crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).toString().padStart(6, '0');
const err = (status: number, code: string, message: string, param?: string) =>
  apiErrorResponse({ status, code, message, ...(param ? { param } : {}) });
const ok = (data: Record<string, unknown>) =>
  new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/**
 * POST /shared/guest/code `{ folder, email }` — email a code when that address holds a live
 * guest grant on the folder (or above). The answer is the same either way (no oracle), and
 * a code row is stored either way so the per-address caps and timing do not tell.
 */
export async function handleSpaceGuestCode(request: Request, env: Env): Promise<Response> {
  if (!isTrustedInstanceOrigin(request, env)) return err(403, 'FORBIDDEN', 'Sign-in must come from this page');
  if (!env.SESSION_SECRET) return err(503, 'UNAVAILABLE', 'Guest access is not configured');
  const body = await readBody(request);
  const email = normalizeGuestEmail(body.email);
  const folder = typeof body.folder === 'string' ? body.folder : '';
  if (!email) return err(400, 'VALIDATION_ERROR', 'A valid email is required', 'email');
  if (!folder) return err(400, 'VALIDATION_ERROR', 'folder is required', 'folder');

  const rl = await checkKVRateLimit(env.RATE_LIMIT_KV, rateLimitClientKey(request), 'guestCodeStart');
  if (!rl.allowed) return rateLimitResponse(rl);
  const emailHash = await hashGuestEmail(env.SESSION_SECRET, email);
  const key = codeKey(emailHash);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const recent = await env.DB.prepare('SELECT created_at FROM email_otp_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1')
    .bind(key).first<{ created_at: string }>();
  if (recent && now - Date.parse(recent.created_at) < CODE_RESEND_MS) {
    return err(429, 'RATE_LIMIT_EXCEEDED', 'A code was just sent. Wait a few seconds before asking again.');
  }
  const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM email_otp_codes WHERE email = ? AND created_at > ?')
    .bind(key, new Date(now - 3_600_000).toISOString()).first<{ c: number }>();
  if ((count?.c ?? 0) >= CODE_MAX_PER_HOUR) {
    return err(429, 'RATE_LIMIT_EXCEEDED', 'Too many codes for this email. Try again later.');
  }

  const code = newCode();
  await env.DB.batch([
    env.DB.prepare('UPDATE email_otp_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL').bind(nowIso, key),
    env.DB.prepare('INSERT INTO email_otp_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(generateId('otp'), key, await hashCode(key, code), new Date(now + CODE_TTL_MS).toISOString(), nowIso),
  ]);
  const grant = await guestGrantFor(env, email, folder);
  if (grant) {
    const name = await env.DB.prepare('SELECT f.name AS folder_name, w.name AS workspace_name FROM folders f JOIN workspaces w ON w.id = f.workspace_id WHERE f.id = ?')
      .bind(grant.resource_id).first<{ folder_name: string | null; workspace_name: string | null }>();
    if (env.EMAIL) {
      await dispatchLifecycleEmail(env, {
        type: 'space_guest_code', toEmail: email, workspaceId: grant.workspace_id,
        data: { code, folderName: name?.folder_name || 'a shared space', workspaceName: name?.workspace_name || 'ShareOut' },
      }).catch(() => undefined);
    } else {
      console.log(`[space-guest] code for ${email}: ${code}`);
    }
  }
  return ok({ sent: true });
}

/** POST /shared/guest/verify `{ folder, email, code, name? }` — a right code mints the session cookie. */
export async function handleSpaceGuestVerify(request: Request, env: Env): Promise<Response> {
  if (!isTrustedInstanceOrigin(request, env)) return err(403, 'FORBIDDEN', 'Sign-in must come from this page');
  if (!env.SESSION_SECRET) return err(503, 'UNAVAILABLE', 'Guest access is not configured');
  const rl = await checkKVRateLimit(env.RATE_LIMIT_KV, rateLimitClientKey(request), 'guestCodeVerify');
  if (!rl.allowed) return rateLimitResponse(rl);
  const body = await readBody(request);
  const email = normalizeGuestEmail(body.email);
  const folder = typeof body.folder === 'string' ? body.folder : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const wrong = () => err(400, 'INVALID_CODE', 'That code did not match. Ask for a new one if it expired.', 'code');
  if (!email || !folder || !/^\d{6}$/.test(code)) return wrong();

  const key = codeKey(await hashGuestEmail(env.SESSION_SECRET, email));
  const nowIso = NOW_ISO();
  const row = await env.DB.prepare(
    'SELECT id, code_hash, expires_at, attempts FROM email_otp_codes WHERE email = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1',
  ).bind(key).first<{ id: string; code_hash: string; expires_at: string; attempts: number }>();
  if (!row || row.expires_at < nowIso || row.attempts >= CODE_MAX_ATTEMPTS) return wrong();
  if ((await hashCode(key, code)) !== row.code_hash) {
    await env.DB.prepare('UPDATE email_otp_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    return wrong();
  }
  const grant = await guestGrantFor(env, email, folder);
  if (!grant) return wrong();
  const consumed = await env.DB.prepare('UPDATE email_otp_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').bind(nowIso, row.id).run();
  if (!(consumed.meta?.changes ?? 0)) return wrong();

  const name = normalizeGuestName(body.name) || defaultName(email);
  const res = ok({ guest: { name }, redirect: `/shared?folder=${encodeURIComponent(folder)}` });
  res.headers.append('Set-Cookie', await mintSession(request, env, grant, name));
  await logAudit(env, { workspaceId: grant.workspace_id, actorEmail: email, action: 'space_guest.sign_in', targetType: 'folder', targetId: grant.resource_id, detail: { grant_id: grant.id, via: 'code' } });
  return res;
}

/** GET /shared/guest/accept?t= — the invite link: a valid token for a live grant signs the guest in. */
export async function handleSpaceGuestAccept(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const t = url.searchParams.get('t') || '';
  const p = env.SESSION_SECRET ? await verifySpaceGuestInvite(env.SESSION_SECRET, t) : null;
  const g = p ? await liveGuestGrant(env, p.g) : null;
  const valid = !!(p && g && g.resource_id === p.f && (await hashGuestEmail(env.SESSION_SECRET, g.subject_id)) === p.h);
  const folder = valid ? g!.resource_id : inviteFolderHint(t);
  const dest = new URL(folder ? `/shared?folder=${encodeURIComponent(folder)}${valid ? '' : '&link=expired'}` : '/shared', url.origin).toString();
  const headers = new Headers({ Location: dest, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  if (valid) {
    headers.append('Set-Cookie', await mintSession(request, env, g!, defaultName(g!.subject_id)));
    await logAudit(env, { workspaceId: g!.workspace_id, actorEmail: g!.subject_id, action: 'space_guest.sign_in', targetType: 'folder', targetId: g!.resource_id, detail: { grant_id: g!.id, via: 'link' } });
  }
  return new Response(null, { status: 302, headers });
}

/** POST /shared/guest/signout — clears every space-guest cookie on this browser. */
export async function handleSpaceGuestSignOut(request: Request, env: Env): Promise<Response> {
  if (!isTrustedInstanceOrigin(request, env)) return err(403, 'FORBIDDEN', 'Sign-out must come from this page');
  const headers = new Headers({ Location: new URL('/shared', request.url).toString(), 'Cache-Control': 'no-store' });
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const name = part.split('=')[0].trim();
    if (name.startsWith(COOKIE_PREFIX)) headers.append('Set-Cookie', spaceGuestCookie(request, name.slice(COOKIE_PREFIX.length), '', 0));
  }
  return new Response(null, { status: 303, headers });
}
