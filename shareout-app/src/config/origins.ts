/**
 * Platform / CDN origin helpers — derive hosts from env so self-hosters are not
 * hardwired to shareout.site / shareoutcdn.site.
 *
 * Unset / invalid SHAREOUT_BASE_URL → founder hosted defaults. Self-host must set
 * SHAREOUT_BASE_URL; /setup and /health both warn while it is missing.
 */
import type { Env } from '../types';

const FOUNDER_HOSTNAME = 'shareout.site';
const FOUNDER_ORIGIN = 'https://shareout.site';

/** Apex hostname from SHAREOUT_BASE_URL (www. stripped). */
export function getPlatformHostname(env: Env): string {
  try {
    const host = new URL(env.SHAREOUT_BASE_URL).hostname.replace(/^www\./, '');
    return host || FOUNDER_HOSTNAME;
  } catch {
    return FOUNDER_HOSTNAME;
  }
}

/** Origin from SHAREOUT_BASE_URL (no trailing slash). */
export function getPlatformOrigin(env: Env): string {
  try {
    return new URL(env.SHAREOUT_BASE_URL).origin;
  } catch {
    return FOUNDER_ORIGIN;
  }
}

/**
 * True when this instance IS the hosted marketing apex.
 *
 * Crawl-discovery files (robots.txt, sitemaps, llms.txt) and IndexNow pings describe
 * a public marketing site. On any other instance they would advertise a domain the
 * instance does not own, so callers branch on this instead of assuming.
 */
export function isMarketingApex(env: Env): boolean {
  return getPlatformOrigin(env) === FOUNDER_ORIGIN;
}

/** Loopback hosts can never be a real separate content domain. */
function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/**
 * Registrable CDN host when ARTIFACT_ORIGIN is a different domain from the app.
 * null ⇒ same-zone serving (self-host default).
 *
 * The loopback check is load-bearing, not defensive trivia. Local dev has no
 * SHAREOUT_BASE_URL, so getPlatformHostname falls back to the hosted apex and the
 * `host === platform` comparison below cannot fire: `ARTIFACT_ORIGIN=http://localhost:55162`
 * — which .dev.vars.example used to set and CLAUDE.md told people to set — then read as a
 * foreign CDN host, so handle-fetch routed EVERY localhost request into the locked-down
 * content dispatcher. The whole app 404s, `/health` included, with nothing in the logs
 * naming the cause.
 */
export function getCdnRegistrable(env: Env): string | null {
  if (!env.ARTIFACT_ORIGIN) return null;
  try {
    const host = new URL(env.ARTIFACT_ORIGIN).hostname.replace(/^www\./, '');
    const platform = getPlatformHostname(env);
    if (!host || isLoopbackHost(host) || host === platform || host.endsWith(`.${platform}`)) return null;
    return host;
  } catch {
    return null;
  }
}
