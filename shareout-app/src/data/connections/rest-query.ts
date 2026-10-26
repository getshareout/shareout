/**
 * REST API connection query executor.
 *
 * Builds authenticated requests from connection config + credentials, executes
 * them with a timeout, and maps upstream failures to {@link UpstreamHttpError}.
 * Destinations are checked against the same SSRF blocklist as the secrets proxy.
 */
import { fetchWithTimeout } from '../../fetch-utils';
import { selfFetch } from '../../http/self-fetch';
import { fetchCheckingRedirects, isBlockedDestination } from '../secrets/blocklist';
import type { Env } from '../../types';
import { UpstreamHttpError } from './errors';
import { CONNECTION_TIMEOUT_MS } from './types';

/** Validate a rest_api base URL is absolute and not an internal/private destination. */
export function validateRestBaseUrl(baseUrl: unknown): string | null {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    return 'baseUrl is required for rest_api connections';
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return 'baseUrl must be an absolute http(s) URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'baseUrl must use http or https';
  }
  const block = isBlockedDestination(baseUrl);
  if (block.blocked) {
    return block.reason || 'baseUrl targets a blocked internal destination';
  }
  return null;
}

/** Execute a REST API connection query and return parsed JSON or text. */
export async function executeRestApiQuery(
  config: Record<string, unknown>,
  credentials: Record<string, unknown> | null,
  credType: string | null,
  query: string | Record<string, unknown>,
  params?: Record<string, unknown>,
  fetcher?: (url: string, init: RequestInit) => Promise<Response>,
): Promise<unknown> {
  const baseUrl = config.baseUrl as string;
  if (!baseUrl) {
    throw new Error('baseUrl not configured');
  }
  const baseErr = validateRestBaseUrl(baseUrl);
  if (baseErr) {
    throw new Error(baseErr);
  }

  let endpoint: string;
  let method = 'GET';
  let body: string | undefined;

  if (typeof query === 'string') {
    endpoint = query;
  } else {
    endpoint = (query.endpoint as string) || '';
    method = ((query.method as string) || 'GET').toUpperCase();
    if (query.body) {
      body = JSON.stringify(query.body);
    }
  }

  // Reject absolute endpoints that would override baseUrl to an internal host.
  if (/^https?:\/\//i.test(endpoint)) {
    const absBlock = isBlockedDestination(endpoint);
    if (absBlock.blocked) {
      throw new Error(absBlock.reason || 'Endpoint targets a blocked internal destination');
    }
  }

  let url = `${baseUrl.replace(/\/$/, '')}${endpoint.startsWith('/') || endpoint === '' ? endpoint : `/${endpoint}`}`;

  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      searchParams.set(key, String(value));
    }
    url += (url.includes('?') ? '&' : '?') + searchParams.toString();
  }

  const destBlock = isBlockedDestination(url);
  if (destBlock.blocked) {
    throw new Error(destBlock.reason || 'Request targets a blocked internal destination');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...staticHeaders(config),
  };

  if (credType === 'api_key' && credentials) {
    const headerName = (config.apiKeyHeader as string) || 'Authorization';
    const prefix = (config.apiKeyPrefix as string | undefined) ?? 'Bearer ';
    headers[headerName] = `${prefix}${credentials.apiKey}`;
  } else if (credType === 'basic_auth' && credentials) {
    const auth = btoa(`${credentials.username}:${credentials.password}`);
    headers['Authorization'] = `Basic ${auth}`;
  }

  const response = await fetchCheckingRedirects(url, { method, headers, body }, () => null, {
    stripCredentialsCrossOrigin: true,
    fetcher: (u, init) => (fetcher ?? ((x, i) => fetchWithTimeout(x, i, CONNECTION_TIMEOUT_MS)))(u, init),
  });

  if (!response.ok) {
    const errBody = (await response.text().catch(() => '')).slice(0, 500);
    console.error('rest_api query failed', JSON.stringify({
      method,
      url: redactUrl(url),
      status: response.status,
      statusText: response.statusText,
      body: errBody,
    }));
    throw new UpstreamHttpError(
      response.status,
      `HTTP ${response.status}: ${response.statusText}${errBody ? ` — ${errBody}` : ''}`,
    );
  }

  const contentType = response.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

/** Static headers declared on a generic connection's config (string values only). */
export function staticHeaders(config: Record<string, unknown>): Record<string, string> {
  const raw = config.headers;
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/** Strip query-string values that may carry secrets before logging. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of u.searchParams.keys()) {
      if (/secret|token|key|password|sig/i.test(key)) u.searchParams.set(key, '***');
    }
    return u.toString();
  } catch {
    return url.split('?')[0];
  }
}

// Headers a self-routed call may carry. Allowlist, not blocklist: connection headers are
// user-controlled and in-worker nothing overwrites cf-connecting-ip / host / cookie, which
// dev-login, rate limiters and abuse controls trust.
const SELF_HEADERS = ['authorization', 'content-type', 'accept'];

/**
 * Fetcher for REST connections whose target is this deployment itself. A Worker
 * subrequest to its own zone fails with Cloudflare 522, so those calls are handed
 * to the in-worker handler instead. Returns undefined for any other host.
 *
 * Only `/v1/` API paths are routed (checked on every redirect hop too, since the
 * fetcher runs per hop); headers are rebuilt from an allowlist and cf-connecting-ip
 * is a non-loopback per-caller marker, so a connection can never pass as a local or
 * spoofed-IP request.
 */
export function selfFetcher(env: Env, url?: unknown, callerId?: string | null): ((url: string, init: RequestInit) => Promise<Response>) | undefined {
  try {
    const own = new URL(env.SHAREOUT_BASE_URL).hostname;
    if (new URL(String(url)).hostname !== own) return undefined;
  } catch {
    return undefined;
  }
  return async (u, init) => {
    const target = new URL(u);
    if (target.hostname !== new URL(env.SHAREOUT_BASE_URL).hostname || !target.pathname.startsWith('/v1/')) {
      throw new Error('Connections to this instance may only call /v1/ API paths.');
    }
    const src = new Headers(init.headers);
    const headers = new Headers();
    for (const name of SELF_HEADERS) {
      const v = src.get(name);
      if (v) headers.set(name, v);
    }
    // Per-caller marker: not an IP, never loopback; keeps per-IP limiters from sharing one bucket.
    headers.set('cf-connecting-ip', `crew-self:${callerId || 'unknown'}`);
    return selfFetch(new Request(target.toString(), { ...init, headers }), env);
  };
}
