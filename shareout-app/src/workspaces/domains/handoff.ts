/**
 * Sign-in on a custom domain. The session cookie is scoped to the platform apex
 * (`Domain=.<apex>`), which a browser never sends to portal.acme.example — and OAuth /
 * SSO callbacks are registered on the apex only. So a custom domain signs people in
 * by handing off from the apex:
 *
 *   portal.acme.example/auth/login?redirect=/x
 *     → <apex>/auth/handoff?host=portal.acme.example&redirect=/x   (signs in there if needed)
 *     → portal.acme.example/auth/handoff/callback?code=…           (one-time code)
 *     → Set-Cookie (host-only on portal.acme.example) + 302 /x
 *
 * The code is random, stored only as a hash, bound to the hostname it was minted for,
 * valid for HANDOFF_TTL_MS and spent by the first callback that presents it.
 */
import type { Env } from '../../types';
import { getPlatformOrigin } from '../../config/origins';
import { createSessionCookieForUser, getSessionUser } from '../../auth/session';
import { errorPage } from '../../auth/pages';
import { workspaceByHostname } from '../host-cache';
import { normalizeHostname } from './hostname';

export const HANDOFF_TTL_MS = 60_000;
export const HANDOFF_START_PATH = '/auth/handoff';
export const HANDOFF_CALLBACK_PATH = '/auth/handoff/callback';

function safeRedirect(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw.length > 2000 ? '/' : raw;
}

async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomCode(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** On a custom domain: where /auth/login (and the OAuth/SSO starts) send people. */
export function handoffStartUrl(env: Env, hostname: string, redirect: string | null): string {
  const u = new URL(HANDOFF_START_PATH, getPlatformOrigin(env));
  u.searchParams.set('host', hostname);
  u.searchParams.set('redirect', safeRedirect(redirect));
  return u.toString();
}

/** Mint a one-time code for `userId` on `hostname`. Returns the plaintext code. */
export async function mintHandoffCode(env: Env, hostname: string, userId: string, redirectPath: string): Promise<string> {
  const code = randomCode();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO workspace_domain_handoffs (id, code_hash, hostname, user_id, redirect_path, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), await hashCode(code), hostname, userId, safeRedirect(redirectPath),
    new Date(now).toISOString(), new Date(now + HANDOFF_TTL_MS).toISOString(),
  ).run();
  // Spent and expired codes are worthless; keep the table small.
  await env.DB.prepare('DELETE FROM workspace_domain_handoffs WHERE expires_at < ?')
    .bind(new Date(now - 10 * HANDOFF_TTL_MS).toISOString()).run().catch(() => {});
  return code;
}

/** Spend `code` on `hostname`. Null when it is unknown, expired, used, or for another host. */
export async function consumeHandoffCode(
  env: Env,
  hostname: string,
  code: string,
): Promise<{ userId: string; redirectPath: string } | null> {
  if (!/^[0-9a-f]{64}$/.test(code)) return null;
  const codeHash = await hashCode(code);
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    `UPDATE workspace_domain_handoffs SET used_at = ?
      WHERE code_hash = ? AND hostname = ? AND used_at IS NULL AND expires_at > ?`,
  ).bind(now, codeHash, hostname, now).run();
  if (!res.meta?.changes) return null;
  const row = await env.DB.prepare('SELECT user_id, redirect_path FROM workspace_domain_handoffs WHERE code_hash = ?')
    .bind(codeHash).first<{ user_id: string; redirect_path: string }>();
  return row ? { userId: row.user_id, redirectPath: row.redirect_path } : null;
}

/** GET <apex>/auth/handoff?host=&redirect= */
export async function handleHandoffStart(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const host = normalizeHostname(url.searchParams.get('host'));
  const redirect = safeRedirect(url.searchParams.get('redirect'));
  // Only hostnames that are verified and active for some workspace get a code: the
  // code (and with it a session) can never be sent to a host we do not serve.
  if (!host || !(await workspaceByHostname(env, host))) {
    return errorPage('This sign-in link is not for a domain this instance serves.', '/');
  }
  const user = await getSessionUser(request, env);
  if (!user) {
    const back = `${HANDOFF_START_PATH}?host=${encodeURIComponent(host)}&redirect=${encodeURIComponent(redirect)}`;
    return Response.redirect(new URL(`/auth/login?redirect=${encodeURIComponent(back)}`, url.origin).toString(), 302);
  }
  const code = await mintHandoffCode(env, host, user.id, redirect);
  const target = new URL(HANDOFF_CALLBACK_PATH, `https://${host}`);
  target.searchParams.set('code', code);
  return new Response(null, { status: 302, headers: { Location: target.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

/** GET <custom host>/auth/handoff/callback?code= */
export async function handleHandoffCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const host = env.CUSTOM_HOST?.hostname;
  if (!host || host !== url.hostname.toLowerCase()) return new Response('Not Found', { status: 404 });
  const spent = await consumeHandoffCode(env, host, url.searchParams.get('code') || '');
  if (!spent) return errorPage('This sign-in link has expired or was already used. Sign in again.', '/auth/login');
  const user = await env.DB.prepare('SELECT email, disabled FROM users WHERE id = ?')
    .bind(spent.userId).first<{ email: string | null; disabled: number | null }>();
  if (!user || user.disabled) return errorPage('This account cannot sign in.', '/auth/login');
  const cookie = await createSessionCookieForUser(env, url, spent.userId, user.email || '');
  return new Response(null, {
    status: 302,
    headers: { Location: spent.redirectPath, 'Set-Cookie': cookie, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
