import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { createSessionToken } from '../token';
import { autoJoinWorkspacesByDomain } from '../workspaces';
import { COOKIE_NAME } from './constants';
import { cookieDomainAttr, cookieSecureAttr, isLocalhost } from './cookies';
import { getPlatformHostname } from '../config/origins';
import { resolveSessionMaxAge } from './session';

/**
 * Local development helper: set a ShareOut session cookie without OAuth.
 *
 * GET /auth/dev?email=you@example.com&redirect=/a/<slug>/edit
 *
 * Only enabled on localhost/127.0.0.1.
 */
export async function handleDevLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isLoopbackIp =
    request.headers.get('cf-connecting-ip') === '127.0.0.1' ||
    request.headers.get('cf-connecting-ip') === '::1';
  if (!isLocalhost(url.hostname) && !isLoopbackIp) {
    return new Response('Not found', { status: 404 });
  }

  const emailRaw = url.searchParams.get('email') || '';
  const redirectTo = url.searchParams.get('redirect') || '/';
  const email = emailRaw.toLowerCase().trim();
  if (!email) {
    return new Response('Missing email', { status: 400 });
  }

  let user = await env.DB.prepare(
    'SELECT id, email FROM users WHERE email = ?'
  ).bind(email).first<{ id: string; email: string }>();

  if (!user) {
    const id = generateId('usr');
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, last_login_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    ).bind(id, email, email.split('@')[0] || 'Dev User').run();
    user = { id, email };
  } else {
    await env.DB.prepare(
      `UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).bind(user.id).run();
  }

  await autoJoinWorkspacesByDomain(env, user.id, user.email);
  const maxAge = await resolveSessionMaxAge(env, user.id);
  const sessionToken = await createSessionToken(user.id, user.email, env, maxAge);

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectTo,
      'Set-Cookie': `${COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly;${cookieSecureAttr(url)} SameSite=Lax;${cookieDomainAttr(url.hostname, getPlatformHostname(env))} Max-Age=${maxAge}`,
    },
  });
}
