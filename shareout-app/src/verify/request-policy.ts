// What the verify render lets a page fetch. The capture view is served with a relaxed
// CSP and no sandbox (an owner render of a private page loads any https CDN), so on
// its own it would let a CDN that real public viewers are refused pass silently.
// Verify parses the policy the real serving path sends (getSandboxedCSP) and aborts
// what a viewer's browser would refuse. It also keeps the render on the artifact's
// own page: no top-level navigation elsewhere and no private-network hosts.

export type CspPolicy = Map<string, string[]>;

export function parseCsp(header: string): CspPolicy {
  const policy: CspPolicy = new Map();
  for (const part of header.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens[0].toLowerCase();
    if (!policy.has(name)) policy.set(name, tokens.slice(1));
  }
  return policy;
}

// Puppeteer resource type → the fetch directive that governs it. Main-frame
// documents are handled by the navigation rule, not CSP.
const RESOURCE_DIRECTIVE: Record<string, string> = {
  script: 'script-src',
  stylesheet: 'style-src',
  font: 'font-src',
  image: 'img-src',
  media: 'media-src',
  texttrack: 'media-src',
  xhr: 'connect-src',
  fetch: 'connect-src',
  eventsource: 'connect-src',
  websocket: 'connect-src',
  ping: 'connect-src',
  document: 'frame-src',
  manifest: 'manifest-src',
};

export function directiveFor(resourceType: string): string | null {
  return RESOURCE_DIRECTIVE[resourceType] ?? null;
}

const DEFAULT_PORT: Record<string, string> = { http: '80', https: '443', ws: '80', wss: '443' };

// CSP3: an insecure scheme-source also matches its secure upgrade.
function schemeMatches(source: string, actual: string): boolean {
  return source === actual || (source === 'http' && actual === 'https') || (source === 'ws' && actual === 'wss');
}

const HOST_SOURCE = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::(\d+|\*))?(\/[^?#]*)?$/;

export function sourceMatches(source: string, url: URL, selfOrigin: string): boolean {
  const s = source.toLowerCase();
  const scheme = url.protocol.slice(0, -1);
  if (s === "'self'") return url.origin === selfOrigin;
  if (s === '*') return scheme in DEFAULT_PORT;
  if (s.startsWith("'")) return false;
  const schemeOnly = s.match(/^([a-z][a-z0-9+.-]*):$/);
  if (schemeOnly) return schemeMatches(schemeOnly[1], scheme);
  const m = s.match(HOST_SOURCE);
  if (!m) return false;
  const [, srcScheme, host, port, path] = m;
  if (srcScheme ? !schemeMatches(srcScheme, scheme) : !(scheme in DEFAULT_PORT)) return false;
  const hostname = url.hostname.toLowerCase();
  if (host.startsWith('*.')) {
    if (!hostname.endsWith(host.slice(1))) return false;
  } else if (host !== '*' && hostname !== host) {
    return false;
  }
  if (port !== '*') {
    const urlPort = url.port || DEFAULT_PORT[scheme] || '';
    const wanted = port || DEFAULT_PORT[srcScheme ?? scheme] || '';
    if (urlPort !== wanted && !(port === undefined && wanted === '80' && urlPort === '443')) return false;
  }
  if (path && path !== '/') {
    const p = url.pathname;
    if (path.endsWith('/') ? !p.startsWith(path) : p !== path) return false;
  }
  return true;
}

/** Whether `policy` lets a resource of `directive` load from `url`. */
export function cspAllows(policy: CspPolicy, directive: string, url: URL, selfOrigin: string): boolean {
  const sources = policy.get(directive)
    ?? (directive === 'frame-src' ? policy.get('child-src') : undefined)
    ?? policy.get('default-src');
  if (!sources) return true;
  return sources.some((s) => sourceMatches(s, url, selfOrigin));
}

/** Loopback, private, link-local and other non-public hosts (IP literals and reserved names). */
export function isPrivateNetworkHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (h === 'localhost' || /\.(localhost|local|internal|home\.arpa)$/.test(h)) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0))
      || (a === 198 && (b === 18 || b === 19));
  }
  if (h.includes(':')) {
    return h === '::' || h === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h) || h.startsWith('::ffff:');
  }
  return false;
}

export type RequestVerdict =
  | { allow: true }
  | { allow: false; reason: 'navigation' | 'private_network' | 'scheme' | 'csp'; directive?: string };

export interface RequestPolicy {
  /** The one URL the main frame may load. */
  targetUrl: string;
  /** Origin of the rendered page (the 'self' of its CSP). */
  pageOrigin: string;
  /** Hosts that are this instance itself (allowed even when they look private, e.g. local dev). */
  ownHosts: string[];
  csp: CspPolicy;
}

/** Decide one request of the verify render. */
export function decideRequest(
  policy: RequestPolicy,
  req: { url: string; resourceType: string; mainFrameNavigation: boolean },
): RequestVerdict {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return { allow: false, reason: 'scheme' };
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:') return { allow: true };
  if (req.mainFrameNavigation) {
    return url.href === new URL(policy.targetUrl).href ? { allow: true } : { allow: false, reason: 'navigation' };
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return { allow: false, reason: 'scheme' };
  const own = policy.ownHosts.includes(url.hostname.toLowerCase());
  if (!own && isPrivateNetworkHost(url.hostname)) return { allow: false, reason: 'private_network' };
  const directive = directiveFor(req.resourceType);
  if (directive && !cspAllows(policy.csp, directive, url, policy.pageOrigin)) {
    return { allow: false, reason: 'csp', directive };
  }
  return { allow: true };
}
