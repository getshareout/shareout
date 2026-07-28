import type { Env } from './types';
import { DATA_ERRORS } from './types';
import type { DataContext } from './data/middleware';
import { errorResponse, successResponse, verifyOwner } from './data/middleware';
import { createLogger, logError } from './logging';
import { getClientIp } from './rate-limit';
import { isBlockedDestination } from './data/secrets/blocklist';

const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10 MB
const DEFAULT_TIMEOUT = 10000; // 10 seconds
const DEFAULT_CACHE_TTL = 300; // 5 minutes
const DEFAULT_RATE_LIMIT = 100; // per minute

interface ProxyConfig {
  enabled: boolean;
  allowed_hosts: string[] | null;
  blocked_hosts: string[] | null;
  cache_ttl: number;
  max_requests_per_minute: number;
}

const STRIPPED_RESPONSE_HEADERS = [
  'set-cookie',
  'set-cookie2',
  'www-authenticate',
  'proxy-authenticate',
];

function isValidUrl(urlStr: string): { valid: boolean; url?: URL; error?: string } {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
  const blocked = isBlockedDestination(urlStr);
  if (blocked.blocked) {
    return { valid: false, error: blocked.reason || 'Blocked destination' };
  }
  return { valid: true, url };
}

function isHostAllowed(hostname: string, config: ProxyConfig): boolean {
  const lower = hostname.toLowerCase();
  if (config.blocked_hosts?.some(h => lower === h.toLowerCase() || lower.endsWith('.' + h.toLowerCase()))) {
    return false;
  }
  if (config.allowed_hosts && config.allowed_hosts.length > 0) {
    return config.allowed_hosts.some(h => lower === h.toLowerCase() || lower.endsWith('.' + h.toLowerCase()));
  }
  return true;
}

function sanitizeHeaders(headers: Headers): Headers {
  const sanitized = new Headers();
  for (const [key, value] of headers) {
    if (!STRIPPED_RESPONSE_HEADERS.includes(key.toLowerCase())) {
      sanitized.set(key, value);
    }
  }
  return sanitized;
}

async function checkProxyRateLimit(
  kv: KVNamespace | undefined,
  artifactId: string,
  limit: number
): Promise<{ allowed: boolean; remaining: number }> {
  if (!kv) return { allowed: true, remaining: limit };

  const windowStart = Math.floor(Date.now() / 60000) * 60000;
  const key = `proxy:${artifactId}:${windowStart}`;
  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  await kv.put(key, String(count + 1), { expirationTtl: 120 });
  return { allowed: true, remaining: Math.max(0, limit - count - 1) };
}

async function getProxyConfig(env: Env, artifactId: string): Promise<ProxyConfig> {
  const row = await env.DB.prepare(
    'SELECT enabled, allowed_hosts, blocked_hosts, cache_ttl, max_requests_per_minute FROM artifact_proxy_config WHERE artifact_id = ?'
  ).bind(artifactId).first<{
    enabled: number;
    allowed_hosts: string | null;
    blocked_hosts: string | null;
    cache_ttl: number;
    max_requests_per_minute: number;
  }>();

  if (!row) {
    return {
      enabled: true,
      allowed_hosts: null,
      blocked_hosts: null,
      cache_ttl: DEFAULT_CACHE_TTL,
      max_requests_per_minute: DEFAULT_RATE_LIMIT,
    };
  }

  return {
    enabled: row.enabled === 1,
    allowed_hosts: row.allowed_hosts ? JSON.parse(row.allowed_hosts) : null,
    blocked_hosts: row.blocked_hosts ? JSON.parse(row.blocked_hosts) : null,
    cache_ttl: row.cache_ttl || DEFAULT_CACHE_TTL,
    max_requests_per_minute: row.max_requests_per_minute || DEFAULT_RATE_LIMIT,
  };
}

function getCacheKey(artifactId: string, url: string): string {
  return `proxy:cache:${artifactId}:${url}`;
}

/** Safe user-facing proxy failure text — never leak fetch/network/D1 internals. */
function userFacingProxyError(err: unknown): string {
  if (err instanceof Error && err.name === 'AbortError') {
    return 'Request timed out';
  }
  return DATA_ERRORS.PROXY_ERROR.message;
}

function logProxyFailure(
  env: Env,
  err: unknown,
  fields: { targetUrl: string; artifactId?: string; scope: 'artifact' | 'global' },
): void {
  logError(
    createLogger(env, {
      scope: 'proxy',
      event: 'proxy.fetch_failed',
      proxy_scope: fields.scope,
      artifact_id: fields.artifactId,
      target_url: fields.targetUrl,
    }),
    'proxy upstream fetch failed',
    err,
  );
}

export async function handleProxy(
  request: Request,
  ctx: DataContext,
  subPath: string
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse({ ...DATA_ERRORS.METHOD_NOT_ALLOWED, message: 'Proxy only supports GET' }, ctx.origin);
  }

  const targetUrl = new URL(request.url).searchParams.get('url');
  if (!targetUrl) {
    return errorResponse({
      ...DATA_ERRORS.INVALID_REQUEST,
      message: 'Missing url parameter',
      hint: 'Provide the target URL as ?url=<encoded-url>',
    }, ctx.origin);
  }

  const validation = isValidUrl(targetUrl);
  if (!validation.valid || !validation.url) {
    return errorResponse({
      ...DATA_ERRORS.BLOCKED_DESTINATION,
      message: validation.error || 'Invalid URL',
    }, ctx.origin);
  }

  const config = await getProxyConfig(ctx.env, ctx.artifactId);
  if (!config.enabled) {
    return errorResponse({
      ...DATA_ERRORS.FORBIDDEN,
      message: 'Proxy disabled for this artifact',
    }, ctx.origin);
  }

  if (!isHostAllowed(validation.url.hostname, config)) {
    return errorResponse({
      ...DATA_ERRORS.HOST_NOT_ALLOWED,
      message: `Host ${validation.url.hostname} not allowed`,
    }, ctx.origin);
  }

  const rateLimit = await checkProxyRateLimit(
    ctx.env.PROXY_CACHE,
    ctx.artifactId,
    config.max_requests_per_minute
  );

  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Rate limit exceeded',
      code: 'PROXY_RATE_LIMITED',
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': String(config.max_requests_per_minute),
        'X-RateLimit-Remaining': '0',
        'Retry-After': '60',
      },
    });
  }

  const cacheKey = getCacheKey(ctx.artifactId, targetUrl);
  if (ctx.env.PROXY_CACHE) {
    const cached = await ctx.env.PROXY_CACHE.get(cacheKey, 'arrayBuffer');
    if (cached) {
      const metaKey = cacheKey + ':meta';
      const meta = await ctx.env.PROXY_CACHE.get<{ contentType: string; status: number }>(metaKey, 'json');
      return new Response(cached, {
        status: meta?.status || 200,
        headers: {
          'Content-Type': meta?.contentType || 'application/octet-stream',
          'X-Proxy-Cache': 'HIT',
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'Access-Control-Allow-Origin': ctx.origin || '*',
        },
      });
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const proxyResponse = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'ShareOut-Proxy/1.0',
        'Accept': request.headers.get('Accept') || '*/*',
        'Accept-Language': request.headers.get('Accept-Language') || 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const contentLength = proxyResponse.headers.get('Content-Length');
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
      return errorResponse({
        ...DATA_ERRORS.FILE_TOO_LARGE,
        message: `Response exceeds ${MAX_RESPONSE_SIZE / 1024 / 1024}MB limit`,
      }, ctx.origin);
    }

    const body = await proxyResponse.arrayBuffer();
    if (body.byteLength > MAX_RESPONSE_SIZE) {
      return errorResponse({
        ...DATA_ERRORS.FILE_TOO_LARGE,
        message: `Response exceeds ${MAX_RESPONSE_SIZE / 1024 / 1024}MB limit`,
      }, ctx.origin);
    }

    const contentType = proxyResponse.headers.get('Content-Type') || 'application/octet-stream';

    if (ctx.env.PROXY_CACHE && proxyResponse.ok) {
      await Promise.all([
        ctx.env.PROXY_CACHE.put(cacheKey, body, { expirationTtl: config.cache_ttl }),
        ctx.env.PROXY_CACHE.put(cacheKey + ':meta', JSON.stringify({
          contentType,
          status: proxyResponse.status,
        }), { expirationTtl: config.cache_ttl }),
      ]);
    }

    const responseHeaders = sanitizeHeaders(proxyResponse.headers);
    responseHeaders.set('X-Proxy-Cache', 'MISS');
    responseHeaders.set('X-RateLimit-Remaining', String(rateLimit.remaining));
    responseHeaders.set('Access-Control-Allow-Origin', ctx.origin || '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    return new Response(body, {
      status: proxyResponse.status,
      headers: responseHeaders,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    logProxyFailure(ctx.env, err, {
      targetUrl,
      artifactId: ctx.artifactId,
      scope: 'artifact',
    });
    if (err instanceof Error && err.name === 'AbortError') {
      return errorResponse({
        ...DATA_ERRORS.PROXY_ERROR,
        message: 'Request timed out',
      }, ctx.origin);
    }
    return errorResponse({
      ...DATA_ERRORS.PROXY_ERROR,
      message: userFacingProxyError(err),
    }, ctx.origin);
  }
}

export async function handleGlobalProxy(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (request.method !== 'GET') {
    return Response.json({ success: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, { status: 405 });
  }

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    return Response.json({
      success: false,
      error: 'Missing url parameter',
      code: 'INVALID_REQUEST',
    }, { status: 400 });
  }

  const validation = isValidUrl(targetUrl);
  if (!validation.valid || !validation.url) {
    return Response.json({
      success: false,
      error: validation.error || 'Invalid URL',
      code: 'BLOCKED_DESTINATION',
    }, { status: 403 });
  }

  const ip = getClientIp(request);
  const windowStart = Math.floor(Date.now() / 60000) * 60000;
  const rateLimitKey = `proxy:global:${ip}:${windowStart}`;

  if (env.PROXY_CACHE) {
    const current = await env.PROXY_CACHE.get(rateLimitKey);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= DEFAULT_RATE_LIMIT) {
      return Response.json({
        success: false,
        error: 'Rate limit exceeded',
        code: 'RATE_LIMITED',
      }, {
        status: 429,
        headers: { 'Retry-After': '60' },
      });
    }
    await env.PROXY_CACHE.put(rateLimitKey, String(count + 1), { expirationTtl: 120 });
  }

  const cacheKey = `proxy:global:cache:${targetUrl}`;
  if (env.PROXY_CACHE) {
    const cached = await env.PROXY_CACHE.get(cacheKey, 'arrayBuffer');
    if (cached) {
      const meta = await env.PROXY_CACHE.get<{ contentType: string; status: number }>(cacheKey + ':meta', 'json');
      return new Response(cached, {
        status: meta?.status || 200,
        headers: {
          'Content-Type': meta?.contentType || 'application/octet-stream',
          'X-Proxy-Cache': 'HIT',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const proxyResponse = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'ShareOut-Proxy/1.0',
        'Accept': request.headers.get('Accept') || '*/*',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const contentLength = proxyResponse.headers.get('Content-Length');
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
      return Response.json({
        success: false,
        error: `Response exceeds ${MAX_RESPONSE_SIZE / 1024 / 1024}MB limit`,
        code: 'FILE_TOO_LARGE',
      }, { status: 413 });
    }

    const body = await proxyResponse.arrayBuffer();
    if (body.byteLength > MAX_RESPONSE_SIZE) {
      return Response.json({
        success: false,
        error: `Response exceeds ${MAX_RESPONSE_SIZE / 1024 / 1024}MB limit`,
        code: 'FILE_TOO_LARGE',
      }, { status: 413 });
    }

    const contentType = proxyResponse.headers.get('Content-Type') || 'application/octet-stream';

    if (env.PROXY_CACHE && proxyResponse.ok) {
      await Promise.all([
        env.PROXY_CACHE.put(cacheKey, body, { expirationTtl: DEFAULT_CACHE_TTL }),
        env.PROXY_CACHE.put(cacheKey + ':meta', JSON.stringify({
          contentType,
          status: proxyResponse.status,
        }), { expirationTtl: DEFAULT_CACHE_TTL }),
      ]);
    }

    const responseHeaders = sanitizeHeaders(proxyResponse.headers);
    responseHeaders.set('X-Proxy-Cache', 'MISS');
    responseHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(body, {
      status: proxyResponse.status,
      headers: responseHeaders,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    logProxyFailure(env, err, { targetUrl, scope: 'global' });
    if (err instanceof Error && err.name === 'AbortError') {
      return Response.json({ success: false, error: 'Request timed out', code: 'PROXY_ERROR' }, { status: 504 });
    }
    return Response.json({
      success: false,
      error: userFacingProxyError(err),
      code: 'PROXY_ERROR',
    }, { status: 502 });
  }
}

export async function handleProxyConfig(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  if (request.method === 'GET') {
    const config = await getProxyConfig(ctx.env, ctx.artifactId);
    return successResponse(config, 200, ctx.origin);
  }

  if (request.method === 'PUT' || request.method === 'PATCH') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) {
      return errorResponse({ ...DATA_ERRORS.FORBIDDEN, message: 'Only artifact owner can modify proxy config' }, ctx.origin);
    }

    let body: Partial<ProxyConfig>;
    try {
      body = await request.json();
    } catch {
      return errorResponse({ ...DATA_ERRORS.INVALID_JSON }, ctx.origin);
    }

    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (typeof body.enabled === 'boolean') {
      updates.push('enabled = ?');
      values.push(body.enabled ? 1 : 0);
    }
    if (body.allowed_hosts !== undefined) {
      updates.push('allowed_hosts = ?');
      values.push(body.allowed_hosts ? JSON.stringify(body.allowed_hosts) : '');
    }
    if (body.blocked_hosts !== undefined) {
      updates.push('blocked_hosts = ?');
      values.push(body.blocked_hosts ? JSON.stringify(body.blocked_hosts) : '');
    }
    if (typeof body.cache_ttl === 'number') {
      updates.push('cache_ttl = ?');
      values.push(Math.max(0, Math.min(3600, body.cache_ttl)));
    }
    if (typeof body.max_requests_per_minute === 'number') {
      updates.push('max_requests_per_minute = ?');
      values.push(Math.max(1, Math.min(1000, body.max_requests_per_minute)));
    }

    if (updates.length === 0) {
      return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'No valid fields to update' }, ctx.origin);
    }

    updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(ctx.artifactId);

    await ctx.env.DB.prepare(`
      INSERT INTO artifact_proxy_config (artifact_id, ${updates.map(u => u.split(' = ')[0]).join(', ')}, updated_at)
      VALUES (?, ${updates.map(() => '?').join(', ')}, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(artifact_id) DO UPDATE SET ${updates.join(', ')}
    `).bind(ctx.artifactId, ...values.slice(0, -1)).run();

    const config = await getProxyConfig(ctx.env, ctx.artifactId);
    return successResponse(config, 200, ctx.origin);
  }

  return errorResponse(DATA_ERRORS.METHOD_NOT_ALLOWED, ctx.origin);
}
