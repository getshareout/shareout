import type { Env } from '../types';
import { COOKIE_NAME } from './constants';
import { cookieDomainAttr, cookieSecureAttr } from './cookies';
import { getPlatformHostname } from '../config/origins';

/** Clear the zone-wide session cookie and redirect. */
export async function handleLogout(request: Request, env?: Env): Promise<Response> {
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get('redirect') || '/';

  const headers = new Headers({ Location: redirectTo });
  const base = `${COOKIE_NAME}=; Path=/; HttpOnly;${cookieSecureAttr(url)} SameSite=Lax;`;
  // A Domain= delete won't match a host-only cookie of the same name, so expire
  // both: the domain-scoped cookie (current scheme) AND the legacy host-only one
  // set before cross-subdomain auth. Otherwise a stale host-only cookie survives
  // logout and keeps the user signed in.
  const domainAttr = cookieDomainAttr(url.hostname, env ? getPlatformHostname(env) : undefined);
  if (domainAttr) {
    headers.append('Set-Cookie', `${base}${domainAttr} Max-Age=0`);
  }
  headers.append('Set-Cookie', `${base} Max-Age=0`);

  return new Response(null, { status: 302, headers });
}
