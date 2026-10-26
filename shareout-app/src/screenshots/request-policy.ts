import type { HTTPRequest, HTTPResponse, Page } from '@cloudflare/puppeteer';
import type { Env } from '../types';
import { getPlatformHostname, getPlatformOrigin } from '../config/origins';
import { cspAllows, directiveFor, type CspPolicy } from './csp';

// Network policy for every headless capture render (thumbnails, image/PDF renders,
// report captures, Artifact Tests, pilot_verify, slide export). The rendered HTML is
// authored content and the output is stored or sent on (a public thumbnail, an email,
// a chat upload), so a render stays on the public internet:
//   - requests to loopback, private, link-local, CGNAT and metadata addresses, to
//     local-only host names, and to non-web schemes are aborted;
//   - a capture is withheld when a response still came from such an address (a public
//     name that resolves to a private one).
// This instance's own hosts are exempt, so a local instance can render itself.
// A read-only render's data session rides here too: the renderer attaches it to the
// page's requests for that artifact's data, so page scripts never hold it.
// A render can opt into stricter rules (verify, which reports what viewers see): the
// main frame may load only the page itself, and the viewers' CSP is enforced.

const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'home.arpa', 'lan', 'home', 'corp', 'intranet', 'private'];
const LOCAL_NAMES = new Set(['metadata.goog']);
const PASS_SCHEMES = new Set(['data:', 'blob:', 'about:']);
const WEB_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:']);

function isPrivateIpv4(a: number, b: number): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || b === 0))
    || (a === 198 && (b === 18 || b === 19));
}

/** Loopback, private, link-local, CGNAT, multicast and metadata hosts (IP literals),
 *  plus names that only resolve on a local network (single-label, .local, .internal…). */
export function isPrivateNetworkHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) return isPrivateIpv4(Number(v4[1]), Number(v4[2]));
  if (h.includes(':')) {
    // ::, ::1, fc00::/7, fe80::/10 (and the rest of fe/ff), IPv4-mapped, NAT64.
    return h === '::' || h === '::1' || /^f[c-f][0-9a-f]{0,2}:/.test(h) || h.startsWith('::ffff:') || h.startsWith('64:ff9b:');
  }
  if (!h.includes('.') || LOCAL_NAMES.has(h)) return true;
  return LOCAL_SUFFIXES.some((s) => h.endsWith(`.${s}`));
}

export type CaptureRequestVerdict =
  | { allow: true }
  | { allow: false; reason: 'private_network' | 'scheme' | 'navigation' | 'csp'; directive?: string };

/** Stricter rules a render can opt into. */
export interface CaptureRules {
  /** The only URL the main frame may load, so a page cannot take the render elsewhere. */
  mainFrameUrl?: string;
  /** The Content-Security-Policy the page's viewers get, enforced per resource type. */
  csp?: { policy: CspPolicy; selfOrigin: string };
}

/** What a rule needs to know about the request beyond its URL. */
export interface CaptureRequestKind {
  resourceType: string;
  mainFrameNavigation: boolean;
}

/** Decide one request of a capture render. `ownHosts` are lower-case host names. */
export function decideCaptureRequest(
  rawUrl: string,
  ownHosts: ReadonlySet<string>,
  rules: CaptureRules = {},
  kind?: CaptureRequestKind,
): CaptureRequestVerdict {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allow: false, reason: 'scheme' };
  }
  if (kind?.mainFrameNavigation && rules.mainFrameUrl !== undefined && url.href !== new URL(rules.mainFrameUrl).href) {
    return { allow: false, reason: 'navigation' };
  }
  if (PASS_SCHEMES.has(url.protocol)) return { allow: true };
  if (!WEB_SCHEMES.has(url.protocol)) return { allow: false, reason: 'scheme' };
  const host = url.hostname.toLowerCase();
  if (!ownHosts.has(host) && isPrivateNetworkHost(host)) return { allow: false, reason: 'private_network' };
  // CSP governs what a page loads, not the top-level document itself.
  const directive = rules.csp && kind && !kind.mainFrameNavigation ? directiveFor(kind.resourceType) : null;
  if (rules.csp && directive && !cspAllows(rules.csp.policy, directive, url, rules.csp.selfOrigin)) {
    return { allow: false, reason: 'csp', directive };
  }
  return { allow: true };
}

/** This instance's own host names: the capture view and the SDK's API live here. */
export function captureOwnHosts(env: Env): string[] {
  const hosts = [new URL(getPlatformOrigin(env)).hostname, getPlatformHostname(env)];
  if (env.ARTIFACT_ORIGIN) {
    try {
      hosts.push(new URL(env.ARTIFACT_ORIGIN).hostname);
    } catch { /* unset in practice */ }
  }
  return [...new Set(hosts.map((h) => h.toLowerCase()))];
}

export interface CaptureGuard {
  /** Requests aborted so far. */
  blocked(): number;
  /** The private address a response came from, or null. When set, drop the capture. */
  privateResponse(): string | null;
}

/** The read-only session the renderer attaches to one artifact's data requests. */
export interface CaptureDataSession {
  token: string;
  artifactId: string;
  /** Origin of the data API the page calls (the platform origin). */
  origin: string;
}

const noop = () => {};

function isDataRequest(rawUrl: string, session: CaptureDataSession): boolean {
  try {
    const url = new URL(rawUrl);
    return url.origin === session.origin && url.pathname.startsWith(`/v1/data/${session.artifactId}/`);
  } catch {
    return false;
  }
}

/** Headers to continue `req` with: the session on this artifact's data requests, and
 *  stripped from anything else still carrying it (a redirect hop). null = unchanged. */
export function captureRequestHeaders(
  url: string,
  headers: Record<string, string>,
  session: CaptureDataSession | undefined,
): Record<string, string> | null {
  if (!session) return null;
  const bearer = `Bearer ${session.token}`;
  const authKeys = Object.keys(headers).filter((k) => k.toLowerCase() === 'authorization');
  const strip = () => Object.fromEntries(Object.entries(headers).filter(([k]) => !authKeys.includes(k)));
  if (isDataRequest(url, session)) return { ...strip(), authorization: bearer };
  return authKeys.some((k) => headers[k] === bearer) ? strip() : null;
}

function connectedDirectly(url: URL, port: number | undefined): boolean {
  if (port === undefined) return true;
  const expected = url.port || (url.protocol === 'https:' || url.protocol === 'wss:' ? '443' : '80');
  return String(port) === expected;
}

export interface CaptureGuardOptions {
  /** Attached to the page's requests for that artifact's data. */
  dataSession?: CaptureDataSession;
  /** Stricter rules (verify). */
  rules?: CaptureRules;
  /** A new URL for an allowed request, or null to send it as is (verify adds the capture
   *  link to the page's own files). Never applied to the main frame's navigation. */
  rewriteUrl?: (url: string) => string | null;
  /** Sees every decision (verify reports what was refused and counts requests). */
  onRequest?: (req: HTTPRequest, verdict: CaptureRequestVerdict) => void;
}

/**
 * Apply the capture policy to `page`. Call before the first navigation. With
 * `dataSession`, the page's requests for that artifact's data carry the session.
 *
 * The response check counts a private remote address only on a direct connection
 * (remote port = the URL's port) and switches off when one of this instance's own
 * responses also came from a private address: behind an egress proxy every response
 * carries the proxy's address, and a local instance serves itself from loopback, so
 * neither can tell an inward-resolving name apart. Request blocking still applies.
 */
export async function guardCapturePage(
  page: Page,
  ownHosts: readonly string[],
  opts: CaptureGuardOptions = {},
): Promise<CaptureGuard> {
  const own = new Set(ownHosts.map((h) => h.toLowerCase()));
  let blocked = 0;
  let ownFromPrivate = false;
  let privateIp: string | null = null;

  // A service worker could answer requests without them reaching the interception.
  await page.setBypassServiceWorker(true).catch(noop);
  await page.setRequestInterception(true);
  const strict = !!(opts.rules || opts.rewriteUrl);
  page.on('request', (req: HTTPRequest) => {
    if (req.isInterceptResolutionHandled()) return;
    const url = req.url();
    // Only the stricter rules look at what the request is.
    const kind = strict
      ? { resourceType: req.resourceType(), mainFrameNavigation: req.isNavigationRequest() && req.frame() === page.mainFrame() }
      : undefined;
    const verdict = decideCaptureRequest(url, own, opts.rules, kind);
    opts.onRequest?.(req, verdict);
    if (verdict.allow) {
      const headers = captureRequestHeaders(url, req.headers(), opts.dataSession);
      const rewritten = opts.rewriteUrl && !kind?.mainFrameNavigation ? opts.rewriteUrl(url) : null;
      (headers || rewritten
        ? req.continue({ ...(headers ? { headers } : {}), ...(rewritten ? { url: rewritten } : {}) })
        : req.continue()).catch(noop);
      return;
    }
    blocked++;
    req.abort('blockedbyclient').catch(noop);
  });
  page.on('response', (res: HTTPResponse) => {
    let url: URL;
    let remote: { ip?: string; port?: number };
    try {
      url = new URL(res.url());
      remote = res.remoteAddress() ?? {};
    } catch {
      return;
    }
    if (!remote.ip || !isPrivateNetworkHost(remote.ip)) return;
    if (own.has(url.hostname.toLowerCase())) {
      ownFromPrivate = true;
      return;
    }
    if (privateIp === null && connectedDirectly(url, remote.port)) privateIp = remote.ip;
  });

  return {
    blocked: () => blocked,
    privateResponse: () => (ownFromPrivate ? null : privateIp),
  };
}
