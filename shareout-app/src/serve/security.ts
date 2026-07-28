import type { Env } from '../types';
import { getCdnRegistrable, getPlatformHostname } from '../config/origins';

// allow-same-origin is deliberately NOT granted: combined with allow-scripts it lets
// framed untrusted artifact code reach back into its own origin and remove the sandbox
// (ADR 30 / architecture_plan_optimized.md §14.4). The iframe therefore runs in an
// opaque origin, so getSandboxedCSP() names the artifact origin explicitly instead of
// relying on 'self' (which never matches an opaque origin).
export const SANDBOX_PERMISSIONS =
  'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads';

// Single configured artifact-serving origin so moving to a dedicated content domain
// (shareoutcdn.site) is a config flip, not a refactor (ADR 30).
export function getArtifactOrigin(env: Env): string {
  const raw = env.ARTIFACT_ORIGIN || env.SHAREOUT_BASE_URL;
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/$/, '');
  }
}

// Founder default CDN apex. Prefer getCdnRegistrable(env) (from ARTIFACT_ORIGIN).
// Kept for allowlist checks that lack Env (publish-time host scan).
export const CDN_REGISTRABLE = 'shareoutcdn.site';
const DEFAULT_LOCAL_DEV_ORIGIN = 'http://localhost:55162';

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]';
}

function loopbackOriginFromEnv(env: Env): string | null {
  try {
    const url = new URL(env.SHAREOUT_BASE_URL);
    return isLoopbackHostname(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
}

function loopbackRequestOrigin(env: Env, request?: Request): string | null {
  if (!request) return null;
  try {
    const url = new URL(request.url);
    if (!isLoopbackHostname(url.hostname)) return null;

    const host = request.headers.get('Host');
    if (host) {
      try {
        const hostUrl = new URL(`${url.protocol}//${host}`);
        if (isLoopbackHostname(hostUrl.hostname) && hostUrl.port) return hostUrl.origin;
      } catch {
        // Fall back to request.url below.
      }
    }

    const envOrigin = loopbackOriginFromEnv(env);
    if (envOrigin) return envOrigin;

    if (url.protocol === 'http:' && url.hostname === 'localhost' && !url.port) {
      return DEFAULT_LOCAL_DEV_ORIGIN;
    }

    return url.origin;
  } catch {
    return null;
  }
}

// True once ARTIFACT_ORIGIN points at the content domain (the cutover is live).
// Until then everything stays same-origin on shareout.site (dev / pre-flip).
export function isCdnArtifactOrigin(env: Env): boolean {
  const cdn = getCdnRegistrable(env);
  if (!cdn) return false;
  try {
    const host = new URL(getArtifactOrigin(env)).host;
    return host === cdn || host.endsWith(`.${cdn}`);
  } catch {
    return false;
  }
}

// Artifact ids are `art_<hex>`; the underscore is not a valid DNS label, so the
// subdomain label is the immutable hex suffix. Reverse with `art_` + label.
export function artifactIdToCdnLabel(artifactId: string): string {
  return artifactId.startsWith('art_') ? artifactId.slice(4) : artifactId;
}

// Per-artifact content host (`<hex>.shareoutcdn.site`) when the cutover is live,
// else null (same-origin serving).
export function artifactContentHost(env: Env, artifactId: string, request?: Request): string | null {
  if (loopbackRequestOrigin(env, request)) return null;
  if (!isCdnArtifactOrigin(env)) return null;
  const cdn = getCdnRegistrable(env);
  if (!cdn) return null;
  return `${artifactIdToCdnLabel(artifactId)}.${cdn}`;
}

// URL the sandbox iframe loads the untrusted artifact from. On the content domain,
// private artifacts carry a path-prefix capability token (`/c/<ct>/`) so the
// artifact's relative asset requests inherit it without cookies. Pre-flip / dev
// falls back to the legacy same-origin raw URL so nothing changes before cutover.
export function artifactContentUrl(
  env: Env,
  artifactId: string,
  slug: string,
  path = '',
  ct?: string,
  request?: Request,
): string {
  const cleanPath = path.replace(/^\//, '');
  const loopbackOrigin = loopbackRequestOrigin(env, request);
  const host = artifactContentHost(env, artifactId, request);
  if (host) {
    const prefix = ct ? `/c/${encodeURIComponent(ct)}` : '';
    return `https://${host}${prefix}/${cleanPath}`;
  }
  const baseUrl = loopbackOrigin || env.SHAREOUT_BASE_URL.replace(/\/$/, '');
  return `${baseUrl}/a/${slug}/${cleanPath}?_raw`;
}

// CSP source for sandboxed artifact bytes. The iframe runs in an opaque origin so
// 'self' never matches; on the content domain we must name `https://*.shareoutcdn.site`
// (the bare registrable origin would not match a per-artifact subdomain).
export function getArtifactCspOrigin(env: Env, request?: Request): string {
  const loopbackOrigin = loopbackRequestOrigin(env, request);
  if (loopbackOrigin) return loopbackOrigin;
  const cdn = getCdnRegistrable(env);
  return cdn && isCdnArtifactOrigin(env) ? `https://*.${cdn}` : getArtifactOrigin(env);
}


/** CSP frame-ancestors sources for the configured platform apex. */
export function platformFrameAncestors(env: Env): string {
  const host = getPlatformHostname(env);
  if (!host || host === 'localhost') return "'self'";
  return `'self' ${host} *.${host}`;
}

export function getSecurityHeaders(isSandboxedContent: boolean, env?: Env): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  };

  if (isSandboxedContent) {
    headers['X-Frame-Options'] = 'SAMEORIGIN';
    headers['Cross-Origin-Opener-Policy'] = 'same-origin';
    headers['Cross-Origin-Embedder-Policy'] = 'credentialless';
  } else {
    // The trusted artifact-viewer wrapper (and type viewers). Framable ONLY by our
    // own app origins — the workspace Studio embeds an artifact as a tab — while
    // external sites remain blocked. CSP frame-ancestors supersedes X-Frame-Options
    // in modern browsers, so we name our origins instead of a blanket DENY (which
    // also blocked our own Studio iframe). 'self' covers local dev (same-origin).
    headers['Content-Security-Policy'] = env
      ? `frame-ancestors ${platformFrameAncestors(env)}`
      : "frame-ancestors 'self'";
  }

  return headers;
}

// Third-party CDN hosts a public artifact may load <script> from. Single
// source of truth: getSandboxedCSP builds the tight script-src from it, and the
// publish path (findBlockedOpenScriptHosts) rejects an open transition that loads any
// host outside it. Private/workspace pages bypass both (relax=true).
export const ALLOWED_ARTIFACT_SCRIPT_HOSTS = [
  // General-purpose package CDNs — these alone cover the vast majority of npm/GitHub
  // libraries (React, Vue, Chart.js, Alpine, GSAP, three.js, Leaflet, …).
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'esm.sh',
  'cdn.skypack.dev',
  'ga.jspm.io',
  // Google-hosted libraries + Charts/loader.
  'ajax.googleapis.com',
  'www.gstatic.com',
  // Popular first-party library domains people hardcode by habit.
  'code.jquery.com',
  'cdn.plot.ly',
  'd3js.org',
  'code.highcharts.com',
  'cdn.datatables.net',
  'cdn.tailwindcss.com',
  'maxcdn.bootstrapcdn.com',
  'stackpath.bootstrapcdn.com',
  'cdn.ckeditor.com',
  'cdn.tiny.cloud',
  'cdn.quilljs.com',
  'cdn.babylonjs.com',
  'cdn.socket.io',
  // ShareOut + infra the wrapper/beacons/checkout require.
  // Platform apex is added dynamically via env in findBlockedOpenHosts / getSandboxedCSP.
  'static.cloudflareinsights.com',
] as const;

// Extra hosts allowed for stylesheets/fonts on top of the script CDNs (Google Fonts,
// Fontshare) — mirrors the tight style-src/font-src in getSandboxedCSP.
const ALLOWED_ARTIFACT_STYLE_HOSTS = [
  ...ALLOWED_ARTIFACT_SCRIPT_HOSTS,
  'fonts.googleapis.com',
  'api.fontshare.com',
  'fonts.gstatic.com',
  'cdn.fontshare.com',
] as const;

// Hosts that would be CSP-blocked on a public page. Relative refs never reach
// here (they aren't absolute URLs); the content domain and localhost are always fine.
function findBlockedOpenHosts(hosts: string[], allowed: Set<string>, env?: Env): string[] {
  const platform = env ? getPlatformHostname(env) : null;
  const cdn = (env && getCdnRegistrable(env)) || CDN_REGISTRABLE;
  return hosts.filter((raw) => {
    const host = raw.toLowerCase().replace(/:\d+$/, '');
    if (host === 'localhost' || host === '127.0.0.1') return false;
    if (host === cdn || host.endsWith(`.${cdn}`)) return false;
    if (platform && (host === platform || host.endsWith(`.${platform}`))) return false;
    return !allowed.has(host);
  });
}

/** External <script src> hosts a public page can't load. */
export function findBlockedOpenScriptHosts(externalScriptHosts: string[], env?: Env): string[] {
  return findBlockedOpenHosts(externalScriptHosts, new Set<string>(ALLOWED_ARTIFACT_SCRIPT_HOSTS), env);
}

/** External stylesheet <link href> hosts a public page can't load. */
export function findBlockedOpenStyleHosts(externalStyleHosts: string[], env?: Env): string[] {
  return findBlockedOpenHosts(externalStyleHosts, new Set<string>(ALLOWED_ARTIFACT_STYLE_HOSTS), env);
}

export function getSandboxedCSP(artifactOrigin: string, relax = false, env?: Env): string {
  // relax: private / authed-only artifacts (never reachable by anonymous visitors,
  // served no-store so never edge-cached). The public phishing/malware threat model
  // doesn't apply, so we let the owner load scripts, styles and fonts from any https
  // host — Tailwind Play CDN, arbitrary CDNs, etc. Public keep the tight
  // allowlist below + the publish-time moderation classifier.
  // Same reputable-CDN allowlist backs script/style/font on tight pages so a library's
  // CSS and fonts load from the same host as its JS, not just the script.
  const tightCdns = ALLOWED_ARTIFACT_SCRIPT_HOSTS.map((h) => `https://${h}`).join(' ');
  const platform = env ? getPlatformHostname(env) : null;
  const platformHttps = platform && platform !== 'localhost' ? ` https://${platform}` : '';
  const ancestors = env ? platformFrameAncestors(env) : "'self'";
  return [
    `default-src 'self' ${artifactOrigin} data: blob:`,
    relax
      ? `script-src 'self' ${artifactOrigin} 'unsafe-inline' 'unsafe-eval' https:`
      : `script-src 'self' ${artifactOrigin} 'unsafe-inline' 'unsafe-eval' ${tightCdns}${platformHttps} http://localhost:55162 https://localhost:55162`,
    relax
      ? `style-src 'self' ${artifactOrigin} 'unsafe-inline' https:`
      : `style-src 'self' ${artifactOrigin} 'unsafe-inline' ${tightCdns}${platformHttps} https://fonts.googleapis.com https://api.fontshare.com http://localhost:55162 https://localhost:55162`,
    "img-src 'self' data: blob: https:",
    relax
      ? `font-src 'self' ${artifactOrigin} data: https:`
      : `font-src 'self' ${artifactOrigin} data: ${tightCdns} https://fonts.gstatic.com https://cdn.fontshare.com`,
    "media-src 'self' blob: data: https:",
    "connect-src 'self' https: http:",
    "frame-src 'self' https: http:",
    // Trusted shell frames this artifact from the platform apex / workspace subdomains.
    `frame-ancestors ${ancestors}`,
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function getEmbedCSP(allowedOrigins: string[] | null, env?: Env): string {
  const frameAncestors =
    allowedOrigins && allowedOrigins.length > 0
      ? `frame-ancestors ${allowedOrigins.join(' ')}`
      : 'frame-ancestors *';
  const platform = env ? getPlatformHostname(env) : null;
  const platformHttps = platform && platform !== 'localhost' ? ` https://${platform}` : '';

  return [
    "default-src 'self' data: blob:",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com https://esm.sh https://cdn.plot.ly${platformHttps} http://localhost:55162 https://localhost:55162 https://static.cloudflareinsights.com`,
    `style-src 'self' 'unsafe-inline'${platformHttps} https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com https://api.fontshare.com https://unpkg.com`,
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.fontshare.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
    "media-src 'self' blob: data: https:",
    "connect-src 'self' https: http:",
    "frame-src 'self' https: http:",
    frameAncestors,
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function getEmbedSecurityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  };
}
