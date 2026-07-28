/**
 * REST API connection query executor.
 *
 * Builds authenticated requests from connection config + credentials, executes
 * them with a timeout, and maps upstream failures to {@link UpstreamHttpError}.
 * Destinations are checked against the same SSRF blocklist as the secrets proxy.
 */
import { fetchWithTimeout } from '../../fetch-utils';
import { isBlockedDestination } from '../secrets/blocklist';
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

  const response = await fetchWithTimeout(url, { method, headers, body }, CONNECTION_TIMEOUT_MS);

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
