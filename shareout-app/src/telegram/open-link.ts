// One-tap "open this page" from Telegram for a linked member who has no browser session.
//
// The button is a Telegram `login_url` button: when tapped, Telegram itself appends the
// TAPPING user's id + auth_date, signed with the bot token. We sign the rest (which
// ShareOut user, which page, until when). The route signs the member in only when all of
// it holds:
//   - our signature is valid and not expired (binds user + target page, 24 h),
//   - Telegram's signature is valid and fresh (auth_date ≤ 5 min),
//   - the tapping Telegram account is the chat linked to that same ShareOut user,
//   - the signed URL was not used before (single use),
//   - the account is enabled and its email is not under an SSO-only policy.
// A forwarded button is signed by Telegram for whoever taps it, so it never matches.
// Every failure falls back to a plain redirect to the page, whose own gate shows sign-in.
//
// Off unless TELEGRAM_LOGIN_LINKS=1: Telegram refuses login_url buttons until the bot's
// domain is set with BotFather (/setdomain → the instance's apex host).
import type { Env } from '../types';
import { getPlatformOrigin } from '../config/origins';
import { signPayload, verifySignature } from '../token';
import { createSessionCookieForUser } from '../auth/session';
import { ssoRequiredFor } from '../auth/sso-config';
import type { InlineButton } from './client';

export const OPEN_PATH = '/auth/telegram/open';
const BUTTON_TTL_S = 24 * 3600;
const TAP_TTL_S = 300;
const USED_PREFIX = 'tg:open:';
const TELEGRAM_FIELDS = ['auth_date', 'first_name', 'id', 'last_name', 'photo_url', 'username'];

export function telegramLoginLinksEnabled(env: Env): boolean {
  return env.TELEGRAM_LOGIN_LINKS === '1' && !!env.TELEGRAM_BOT_TOKEN && !!env.SESSION_SECRET;
}

/** Path + query of an artifact link on this instance's apex, or null for anything else. */
export function ownArtifactPath(env: Env, url: string): string | null {
  try {
    const u = new URL(url);
    if (u.origin !== getPlatformOrigin(env) || !u.pathname.startsWith('/a/')) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

function safeTarget(to: string | null): string | null {
  return to && to.startsWith('/a/') && !to.startsWith('//') && !/[\\\r\n]/.test(to) ? to : null;
}

const signed = (userId: string, to: string, exp: number) => `tgopen|${userId}|${to}|${exp}`;

/** The login_url target for one member + page. */
export async function signedOpenUrl(env: Env, userId: string, to: string, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + BUTTON_TTL_S;
  const sig = await signPayload(signed(userId, to, exp), env.SESSION_SECRET);
  const q = new URLSearchParams({ to, u: userId, exp: String(exp), sig });
  return `${getPlatformOrigin(env)}${OPEN_PATH}?${q}`;
}

/** An "open" button for a page link: a one-tap sign-in button when enabled, else a plain URL button. */
export async function openPageButton(env: Env, userId: string | null, text: string, url: string): Promise<InlineButton> {
  const to = ownArtifactPath(env, url);
  if (!userId || !to || !telegramLoginLinksEnabled(env)) return { text, url };
  return { text, login_url: { url: await signedOpenUrl(env, userId, to), request_write_access: false } };
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Telegram's login data check: HMAC-SHA256(data_check_string, SHA256(bot_token)). */
export async function verifyTelegramLogin(params: URLSearchParams, botToken: string, now = Date.now()): Promise<string | null> {
  const hash = params.get('hash');
  const id = params.get('id');
  const authDate = Number(params.get('auth_date'));
  if (!hash || !id || !Number.isFinite(authDate)) return null;
  const age = Math.floor(now / 1000) - authDate;
  if (age > TAP_TTL_S || age < -60) return null;
  const check = TELEGRAM_FIELDS.filter((k) => params.has(k)).map((k) => `${k}=${params.get(k)}`).join('\n');
  const secret = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(botToken));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(check)));
  return sameHex(mac, hash.toLowerCase()) ? id : null;
}

async function verifiedUser(env: Env, params: URLSearchParams, to: string, now: number): Promise<{ id: string; email: string } | null> {
  const userId = params.get('u');
  const exp = Number(params.get('exp'));
  const sig = params.get('sig');
  if (!userId || !sig || !Number.isFinite(exp) || exp < Math.floor(now / 1000)) return null;
  if (!(await verifySignature(signed(userId, to, exp), sig, env.SESSION_SECRET).catch(() => false))) return null;
  const tgId = await verifyTelegramLogin(params, env.TELEGRAM_BOT_TOKEN!, now);
  if (!tgId) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.disabled FROM messaging_links m JOIN users u ON u.id = m.user_id
      WHERE m.platform = 'telegram' AND m.platform_user_id = ? AND m.user_id = ? LIMIT 1`,
  ).bind(tgId, userId).first<{ id: string; email: string | null; disabled: number | null }>();
  if (!row?.email || row.disabled) return null;
  if (await ssoRequiredFor(env, row.email)) return null;
  // Single use is required: without the store to record it, refuse rather than allow replays.
  if (!env.RATE_LIMIT_KV) return null;
  const used = USED_PREFIX + params.get('hash');
  if (await env.RATE_LIMIT_KV.get(used)) return null;
  await env.RATE_LIMIT_KV.put(used, '1', { expirationTtl: TAP_TTL_S * 2 });
  return { id: row.id, email: row.email };
}

/** GET /auth/telegram/open — sign the linked member in (when every check holds) and land on the page. */
export async function handleTelegramOpen(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const to = safeTarget(url.searchParams.get('to'));
  if (!to) return new Response('Not found', { status: 404 });
  const headers = new Headers({ Location: to, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  if (telegramLoginLinksEnabled(env)) {
    const user = await verifiedUser(env, url.searchParams, to, now).catch(() => null);
    if (user) headers.set('Set-Cookie', await createSessionCookieForUser(env, url, user.id, user.email));
  }
  return new Response(null, { status: 302, headers });
}
