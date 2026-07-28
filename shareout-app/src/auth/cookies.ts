import { COOKIE_NAME, SESSION_MAX_AGE } from './constants';

export function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
}

export function cookieSecureAttr(url: URL): string {
  // Browsers ignore `Secure` cookies over http:// which breaks local dev.
  // Keep Secure for https and for non-localhost hosts.
  if (url.protocol === 'https:' && !isLocalhost(url.hostname)) return ' Secure;';
  if (url.protocol === 'https:' && isLocalhost(url.hostname)) return ' Secure;';
  return '';
}

/** Naive registrable apex (last two labels). Skip CF preview zones. */
function inferCookieApex(hostname: string): string | null {
  if (hostname.endsWith('.workers.dev') || hostname.endsWith('.pages.dev')) return null;
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  return parts.length === 2 ? hostname : parts.slice(-2).join('.');
}

/**
 * Scope session cookies to the platform apex so one login covers workspace subdomains.
 * Prefer `platformHost` from SHAREOUT_BASE_URL; otherwise infer from the request host.
 */
export function cookieDomainAttr(hostname: string, platformHost?: string): string {
  if (isLocalhost(hostname)) return '';
  const apex = (platformHost || inferCookieApex(hostname) || '').replace(/^www\./, '');
  if (!apex || apex === 'localhost') return '';
  if (hostname === apex || hostname.endsWith(`.${apex}`)) {
    return ` Domain=.${apex};`;
  }
  return '';
}

/** Guard OAuth return targets to same-zone origins (prevents open redirects). */
export function isShareoutOrigin(origin: string | null, platformHost?: string): origin is string {
  if (!origin) return false;
  try {
    const h = new URL(origin).hostname;
    if (isLocalhost(h)) return false;
    const apex = (platformHost || inferCookieApex(h) || '').replace(/^www\./, '');
    if (!apex) return false;
    return h === apex || h.endsWith(`.${apex}`);
  } catch {
    return false;
  }
}

/** Build a `Set-Cookie` header for a signed session token. */
export function buildSessionCookie(
  url: URL,
  sessionToken: string,
  maxAge = SESSION_MAX_AGE,
  platformHost?: string,
): string {
  return `${COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly;${cookieSecureAttr(url)} SameSite=Lax;${cookieDomainAttr(url.hostname, platformHost)} Max-Age=${maxAge}`;
}
