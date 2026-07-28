import type { Env } from './types';
import { parseSubdomainFromEnv } from './subdomain';

function envFlagOn(v: string | undefined): boolean {
  const s = (v || '').toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/** When truthy (1|true|yes|on), block US visitors on the apex marketing homepage only. */
export function marketingUsBlocked(env: Env): boolean {
  return envFlagOn(env.MARKETING_US_BLOCKED);
}

/** When truthy, hide the public marketing site (landing, pricing, and all Pages proxy). */
export function marketingPagesDisabled(env: Env): boolean {
  return envFlagOn(env.MARKETING_PAGES_DISABLED);
}

function notAvailable(): Response {
  return new Response('Not Available', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// Workspace subdomains and localhost are unaffected — only the configured apex `/`.
export function blockUsMarketingHomepage(
  request: Request,
  env: Env,
  hostname: string,
  path: string,
): Response | null {
  if (!marketingUsBlocked(env)) return null;
  if (path !== '/' && path !== '') return null;
  if (hostname === 'localhost' || hostname.includes('127.0.0.1')) return null;

  const { isSubdomain } = parseSubdomainFromEnv(hostname, env);
  if (isSubdomain) return null;

  const country =
    request.headers.get('CF-IPCountry') ??
    (request as Request & { cf?: { country?: string } }).cf?.country;
  if (country !== 'US') return null;

  return notAvailable();
}

/** Apex looks dead: no marketing Pages, landing, pricing, or related public funnels. */
export function blockDisabledMarketingPages(
  env: Env,
  hostname: string,
  _path?: string,
): Response | null {
  if (!marketingPagesDisabled(env)) return null;
  if (hostname === 'localhost' || hostname.includes('127.0.0.1')) return null;
  const { isSubdomain } = parseSubdomainFromEnv(hostname, env);
  if (isSubdomain) return null;
  return notAvailable();
}
