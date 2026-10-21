const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
  '100.100.100.200',
]);

const BLOCKED_HOST_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
];

const BLOCKED_PORTS = new Set([22, 23, 25, 445, 3389]);

// IPv6 that must never be reachable: loopback (::1), unspecified (::),
// link-local (fe80:), unique-local (fc/fd). The URL parser normalizes these.
const BLOCKED_IPV6_PATTERNS = [
  /^::1$/,
  /^::$/,
  /^fe80:/i,
  /^f[cd][0-9a-f]{2}:/i,
];

// Decode an IPv4-mapped IPv6 host (::ffff:7f00:1 or ::ffff:127.0.0.1) to its
// embedded dotted-quad so the IPv4 private-range checks apply. Returns null if
// the host is not a mapped address. The WHATWG parser normalizes the dotted
// form to hex, so the hex branch is the one that fires in practice.
function ipv6MappedV4(host: string): string | null {
  const dotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (dotted) return dotted[1];
  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return null;
}

export function isBlockedDestination(url: string): { blocked: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { blocked: true, reason: 'Invalid URL' };
  }

  // URL.hostname keeps IPv6 in brackets ([::1]); strip them so set/pattern
  // checks see the bare address.
  const rawHost = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  const hostname = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;

  if (BLOCKED_HOSTS.has(hostname)) {
    return { blocked: true, reason: `Blocked host: ${hostname}` };
  }

  for (const pattern of BLOCKED_IPV6_PATTERNS) {
    if (pattern.test(hostname)) {
      return { blocked: true, reason: `Blocked internal IPv6: ${hostname}` };
    }
  }

  // IPv4-mapped IPv6 (::ffff:127.0.0.1) tunnels straight to a private v4 — check
  // the embedded address against the v4 rules below.
  const mappedV4 = ipv6MappedV4(hostname);
  const checkHost = mappedV4 ?? hostname;
  if (mappedV4 && BLOCKED_HOSTS.has(mappedV4)) {
    return { blocked: true, reason: `Blocked host: ${mappedV4}` };
  }

  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(checkHost)) {
      return { blocked: true, reason: `Blocked private/internal IP: ${checkHost}` };
    }
  }

  if (hostname.endsWith('.internal') || hostname.endsWith('.local')) {
    return { blocked: true, reason: `Blocked internal domain: ${hostname}` };
  }

  const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
  if (BLOCKED_PORTS.has(port)) {
    return { blocked: true, reason: `Blocked port: ${port}` };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { blocked: true, reason: `Blocked protocol: ${parsed.protocol}` };
  }

  return { blocked: false };
}

export function validateAllowedHost(requestHost: string, allowedHosts: string[]): boolean {
  const normalizedRequest = requestHost.toLowerCase();

  for (const allowed of allowedHosts) {
    const normalizedAllowed = allowed.toLowerCase();

    if (normalizedAllowed.startsWith('*.')) {
      const suffix = normalizedAllowed.slice(1);
      if (normalizedRequest.endsWith(suffix) || normalizedRequest === normalizedAllowed.slice(2)) {
        return true;
      }
    } else if (normalizedRequest === normalizedAllowed) {
      return true;
    }
  }

  return false;
}

export class BlockedRedirectError extends Error {
  constructor(reason: string) {
    super(`Blocked redirect: ${reason}`);
    this.name = 'BlockedRedirectError';
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const CROSS_ORIGIN_SAFE_HEADERS = new Set(['accept', 'accept-language', 'content-type', 'user-agent']);

/**
 * fetch() that follows redirects itself so every hop is re-checked against the SSRF
 * blocklist plus the caller's own allowlist (`checkHop` returns a refusal reason or null).
 * With `stripCredentialsCrossOrigin`, a hop to a different origin drops every header
 * except a small safe set, so injected credentials never leave the original origin.
 */
export async function fetchCheckingRedirects(
  url: string,
  init: RequestInit,
  checkHop: (next: URL) => string | null,
  opts: { stripCredentialsCrossOrigin?: boolean; fetcher?: (url: string, init: RequestInit) => Promise<Response> } = {},
): Promise<Response> {
  const fetcher = opts.fetcher ?? fetch;
  const origin = new URL(url).origin;
  let current = url;
  let method = (init.method || 'GET').toUpperCase();
  let body = init.body;
  let headers = init.headers;

  for (let hop = 0; ; hop++) {
    const response = await fetcher(current, { ...init, method, body, headers, redirect: 'manual' });
    const location = response.headers.get('Location');
    if (!REDIRECT_STATUSES.has(response.status) || !location) return response;
    await response.body?.cancel();
    if (hop >= MAX_REDIRECTS) throw new BlockedRedirectError('too many redirects');

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new BlockedRedirectError('invalid redirect location');
    }
    const blocked = isBlockedDestination(next.toString());
    if (blocked.blocked) throw new BlockedRedirectError(blocked.reason || 'blocked destination');
    const refusal = checkHop(next);
    if (refusal) throw new BlockedRedirectError(refusal);

    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      method = 'GET';
      body = undefined;
    }
    if (opts.stripCredentialsCrossOrigin && next.origin !== origin) {
      headers = [...new Headers(headers)].filter(([k]) => CROSS_ORIGIN_SAFE_HEADERS.has(k.toLowerCase()));
    }
    current = next.toString();
  }
}
