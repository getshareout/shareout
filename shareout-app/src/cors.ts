import type { Env } from './types';
import { getPlatformHostname, getPlatformOrigin } from './config/origins';

const ALLOWED_ORIGINS = [
  'https://shareout.site',
  'https://www.shareout.site',
  'https://claude.ai',
  'https://chatgpt.com',
  'https://gemini.google.com',
];

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.shareout\.site$/,
  // Per-artifact content origins (ADR 30): artifacts served from shareoutcdn.site call
  // the control-plane data API on shareout.site cross-origin with a Bearer token.
  /^https:\/\/[a-z0-9-]+\.shareoutcdn\.site$/,
  /^https:\/\/shareoutcdn\.site$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

/** Escape a hostname for embedding in a RegExp source. */
function escapeForPattern(host: string): string {
  return host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Origins this particular instance serves: its own app origin, its workspace
 * subdomains, and its artifact/content origin when that is a separate host.
 *
 * Without this the allowlist named only the hosted product, so a self-hosted
 * instance refused cross-origin browser calls from its *own* pages — the
 * workspace-subdomain and custom-domain surfaces in particular. Sandboxed
 * artifacts were unaffected (they send `Origin: null` and take the wildcard
 * branch), which is why this stayed invisible.
 */
function instanceOrigins(env: Env): { origins: string[]; patterns: RegExp[] } {
  const origins: string[] = [];
  const patterns: RegExp[] = [];

  const origin = getPlatformOrigin(env);
  const host = getPlatformHostname(env);
  origins.push(origin, `https://www.${host}`);
  patterns.push(new RegExp(`^https://[a-z0-9-]+\\.${escapeForPattern(host)}$`));

  if (env.ARTIFACT_ORIGIN) {
    try {
      const artifactHost = new URL(env.ARTIFACT_ORIGIN).hostname;
      if (artifactHost) {
        origins.push(`https://${artifactHost}`);
        patterns.push(new RegExp(`^https://[a-z0-9-]+\\.${escapeForPattern(artifactHost)}$`));
      }
    } catch {
      // malformed ARTIFACT_ORIGIN — the static lists still apply
    }
  }

  return { origins, patterns };
}

function isAllowedOrigin(origin: string, env?: Env): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))) return true;
  if (!env) return false;
  const instance = instanceOrigins(env);
  if (instance.origins.includes(origin)) return true;
  return instance.patterns.some((pattern) => pattern.test(origin));
}

export function corsHeadersForRequest(request: Request, env?: Env): Headers {
  const origin = request.headers.get('Origin');
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Idempotency-Key',
    'Access-Control-Max-Age': '86400',
  });

  if (origin && origin !== 'null' && isAllowedOrigin(origin, env)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Vary', 'Origin');
  } else if (!origin || origin === 'null') {
    // Sandboxed artifacts run in an opaque origin, so their requests carry
    // `Origin: null`. They authenticate with a Bearer token (no cookies), so a
    // wildcard ACAO is safe and necessary here.
    headers.set('Access-Control-Allow-Origin', '*');
  }

  return headers;
}

export function handleCORS(request: Request, env?: Env): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeadersForRequest(request, env),
  });
}

export function addCORSHeaders(response: Response, request: Request, env?: Env): Response {
  const newResponse = new Response(response.body, response);
  const corsHeaders = corsHeadersForRequest(request, env);
  for (const [key, value] of corsHeaders) {
    newResponse.headers.set(key, value);
  }
  return newResponse;
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized', code: 'UNAUTHORIZED' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
