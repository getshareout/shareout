import type { Env } from '../../types';
import { DATA_ERRORS } from '../../types';
import { generateId } from '../../crypto-utils';
import { createLogger, logError } from '../../logging';
import {
  successResponse,
  errorResponse,
  verifyOwner,
  type DataContext,
} from '../middleware';
import { Errors } from '../errors';
import { encryptCredentials, decryptCredentials } from '../connections/credentials';
import { isBlockedDestination, validateAllowedHost } from './blocklist';
import { matchesAllowedPath, validatePathPatterns } from './path-matcher';

const NAME_PATTERN = /^[a-zA-Z0-9_\-]+$/;
const INJECTION_TYPES = ['bearer', 'basic', 'header', 'query'] as const;
type InjectionType = (typeof INJECTION_TYPES)[number];

interface SecretRow {
  id: string;
  artifact_id: string;
  name: string;
  description: string | null;
  allowed_hosts: string;
  allowed_methods: string;
  allowed_paths: string;
  credentials_id: string | null;
  injection_type: string;
  injection_config: string | null;
  rate_limit_rpm: number;
  created_at: string;
  updated_at: string;
}

interface CredentialsRow {
  id: string;
  encrypted_data: string;
  iv: string;
}

interface SecretConfig {
  name: string;
  description?: string;
  allowedHosts: string[];
  allowedMethods: string[];
  allowedPaths: string[];
  injectionType: InjectionType;
  injectionConfig?: {
    headerName?: string;
    queryParam?: string;
    prefix?: string;
  };
  credentials: {
    value: string;
    username?: string;
    password?: string;
  };
  rateLimit?: number;
}

interface ProxyRequest {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

interface RateLimitWindow {
  count: number;
  windowStart: number;
}

const rateLimitCache = new Map<string, RateLimitWindow>();
const WINDOW_SIZE_MS = 60 * 1000;

function checkRateLimit(secretId: string, limitPerMinute: number): boolean {
  const now = Date.now();
  const key = `secret:${secretId}`;
  let window = rateLimitCache.get(key);

  if (!window || now - window.windowStart > WINDOW_SIZE_MS) {
    window = { count: 0, windowStart: now };
    rateLimitCache.set(key, window);
  }

  if (window.count >= limitPerMinute) {
    return false;
  }

  window.count++;
  return true;
}

export async function handleSecrets(
  request: Request,
  ctx: DataContext,
  path: string
): Promise<Response> {
  const parts = path.split('/').filter(Boolean);
  const [name, action] = parts;
  const method = request.method;

  if (!name && method === 'GET') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) return errorResponse(DATA_ERRORS.FORBIDDEN);
    return listSecrets(ctx);
  }

  if (!name && method === 'POST') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) return errorResponse(DATA_ERRORS.FORBIDDEN);
    return createSecret(request, ctx);
  }

  if (name && action === 'proxy' && method === 'POST') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) return errorResponse(DATA_ERRORS.FORBIDDEN);
    return executeProxy(request, ctx, name);
  }

  if (name && action === 'audit' && method === 'GET') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) return errorResponse(DATA_ERRORS.FORBIDDEN);
    return getAuditLog(ctx, name, request);
  }

  if (name && !action && method === 'GET') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) return errorResponse(DATA_ERRORS.FORBIDDEN);
    return getSecret(ctx, name);
  }

  if (name && !action && method === 'PUT') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) return errorResponse(DATA_ERRORS.FORBIDDEN);
    return updateSecret(request, ctx, name);
  }

  if (name && !action && method === 'DELETE') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) return errorResponse(DATA_ERRORS.FORBIDDEN);
    return deleteSecret(ctx, name);
  }

  return errorResponse(DATA_ERRORS.NOT_FOUND);
}

function validateName(name: string): string | null {
  if (!name) return 'Name is required';
  if (name.length > 64) return 'Name too long (max 64 chars)';
  if (!NAME_PATTERN.test(name)) return 'Name contains invalid characters';
  return null;
}

async function listSecrets(ctx: DataContext): Promise<Response> {
  const result = await ctx.env.DB.prepare(
    `SELECT name, description, allowed_hosts, allowed_methods, injection_type, rate_limit_rpm, created_at
     FROM artifact_secrets WHERE artifact_id = ? ORDER BY name`
  ).bind(ctx.artifactId).all<SecretRow>();

  return successResponse({
    secrets: result.results.map(s => ({
      name: s.name,
      description: s.description,
      allowedHosts: JSON.parse(s.allowed_hosts),
      allowedMethods: JSON.parse(s.allowed_methods),
      injectionType: s.injection_type,
      rateLimit: s.rate_limit_rpm,
      createdAt: s.created_at,
    })),
    count: result.results.length,
  });
}

async function getSecret(ctx: DataContext, name: string): Promise<Response> {
  const secret = await ctx.env.DB.prepare(
    `SELECT name, description, allowed_hosts, allowed_methods, allowed_paths,
            injection_type, injection_config, rate_limit_rpm, created_at, updated_at
     FROM artifact_secrets WHERE artifact_id = ? AND name = ?`
  ).bind(ctx.artifactId, name).first<SecretRow>();

  if (!secret) {
    return errorResponse({
      ...DATA_ERRORS.SECRET_NOT_FOUND,
      hint: `No secret named "${name}" exists.`,
      suggestion: 'Use GET /secrets to list all secrets (owner only).',
    }, ctx.origin);
  }

  return successResponse({
    name: secret.name,
    description: secret.description,
    allowedHosts: JSON.parse(secret.allowed_hosts),
    allowedMethods: JSON.parse(secret.allowed_methods),
    allowedPaths: JSON.parse(secret.allowed_paths),
    injectionType: secret.injection_type,
    injectionConfig: secret.injection_config ? JSON.parse(secret.injection_config) : null,
    rateLimit: secret.rate_limit_rpm,
    createdAt: secret.created_at,
    updatedAt: secret.updated_at,
  });
}

async function createSecret(request: Request, ctx: DataContext): Promise<Response> {
  if (!ctx.env.CREDENTIALS_KEY) {
    return errorResponse(Errors.config('CREDENTIALS_KEY'), ctx.origin);
  }

  let body: SecretConfig;
  try {
    body = await request.json();
  } catch {
    return errorResponse(DATA_ERRORS.INVALID_JSON, ctx.origin);
  }

  const {
    name,
    description,
    allowedHosts,
    allowedMethods,
    allowedPaths,
    injectionType,
    injectionConfig,
    credentials,
    rateLimit,
  } = body;

  const nameError = validateName(name);
  if (nameError) {
    return errorResponse({
      ...DATA_ERRORS.INVALID_SECRET_NAME,
      message: nameError,
      hint: `"${name}" is not a valid secret name.`,
    }, ctx.origin);
  }

  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
    return errorResponse({
      ...Errors.missingParam('allowedHosts', '["api.example.com"]'),
      hint: 'Specify which hosts the secret can be used with.',
      suggestion: 'Example: ["api.stripe.com", "api.openai.com"]',
    }, ctx.origin);
  }

  if (!Array.isArray(allowedMethods) || allowedMethods.length === 0) {
    return errorResponse({
      ...Errors.missingParam('allowedMethods', '["GET", "POST"]'),
      hint: 'Specify which HTTP methods are allowed.',
      suggestion: 'Example: ["GET", "POST", "PUT"]',
    }, ctx.origin);
  }

  const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  for (const m of allowedMethods) {
    if (!validMethods.includes(m.toUpperCase())) {
      return errorResponse({
        code: 'INVALID_METHOD',
        message: `Invalid HTTP method: ${m}`,
        status: 400,
        param: 'allowedMethods',
        hint: `"${m}" is not a valid HTTP method.`,
        suggestion: `Valid methods: ${validMethods.join(', ')}`,
      }, ctx.origin);
    }
  }

  const pathValidation = validatePathPatterns(allowedPaths);
  if (!pathValidation.valid) {
    return errorResponse({
      code: 'INVALID_PATH_PATTERN',
      message: pathValidation.error!,
      status: 400,
      param: 'allowedPaths',
      hint: 'Path patterns must be valid glob patterns.',
      suggestion: 'Examples: ["/v1/*"], ["/api/**"], ["/users/:id"]',
    }, ctx.origin);
  }

  if (!INJECTION_TYPES.includes(injectionType)) {
    return errorResponse({
      code: 'INVALID_INJECTION_TYPE',
      message: `Invalid injection type: ${injectionType}`,
      status: 400,
      param: 'injectionType',
      hint: `"${injectionType}" is not a valid injection type.`,
      suggestion: `Valid types: ${INJECTION_TYPES.join(', ')}. Use "bearer" for Bearer tokens, "header" for custom headers.`,
    }, ctx.origin);
  }

  if (!credentials || !credentials.value) {
    return errorResponse({
      ...Errors.missingParam('credentials.value', 'sk-xxx...'),
      hint: 'The secret credential value (API key, token, etc.) is required.',
    }, ctx.origin);
  }

  const existing = await ctx.env.DB.prepare(
    'SELECT id FROM artifact_secrets WHERE artifact_id = ? AND name = ?'
  ).bind(ctx.artifactId, name).first();

  if (existing) {
    return errorResponse({
      ...DATA_ERRORS.SECRET_EXISTS,
      hint: `A secret named "${name}" already exists.`,
      suggestion: 'Use PUT /secrets/{name} to update it, or choose a different name.',
    }, ctx.origin);
  }

  const { encrypted, iv } = await encryptCredentials(credentials, ctx.env.CREDENTIALS_KEY);

  const credId = generateId('scr');
  const secretId = generateId('sec');
  const now = new Date().toISOString();

  await ctx.env.DB.prepare(`
    INSERT INTO artifact_secret_credentials (id, artifact_id, encrypted_data, iv, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(credId, ctx.artifactId, encrypted, iv, now, now).run();

  await ctx.env.DB.prepare(`
    INSERT INTO artifact_secrets (id, artifact_id, name, description, allowed_hosts, allowed_methods, allowed_paths, credentials_id, injection_type, injection_config, rate_limit_rpm, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    secretId,
    ctx.artifactId,
    name,
    description || null,
    JSON.stringify(allowedHosts),
    JSON.stringify(allowedMethods.map((m: string) => m.toUpperCase())),
    JSON.stringify(allowedPaths),
    credId,
    injectionType,
    injectionConfig ? JSON.stringify(injectionConfig) : null,
    rateLimit || 60,
    now,
    now
  ).run();

  return successResponse({ name, createdAt: now }, 201);
}

async function updateSecret(request: Request, ctx: DataContext, name: string): Promise<Response> {
  if (!ctx.env.CREDENTIALS_KEY) {
    return errorResponse(Errors.config('CREDENTIALS_KEY'), ctx.origin);
  }

  const secret = await ctx.env.DB.prepare(
    'SELECT id, credentials_id FROM artifact_secrets WHERE artifact_id = ? AND name = ?'
  ).bind(ctx.artifactId, name).first<{ id: string; credentials_id: string | null }>();

  if (!secret) {
    return errorResponse({
      ...DATA_ERRORS.SECRET_NOT_FOUND,
      hint: `No secret named "${name}" exists.`,
      suggestion: 'Use POST /secrets to create a new secret.',
    }, ctx.origin);
  }

  let body: Partial<SecretConfig>;
  try {
    body = await request.json();
  } catch {
    return errorResponse(DATA_ERRORS.INVALID_JSON, ctx.origin);
  }

  const { description, allowedHosts, allowedMethods, allowedPaths, injectionConfig, credentials, rateLimit } = body;
  const now = new Date().toISOString();
  const updates: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (description !== undefined) {
    updates.push('description = ?');
    values.push(description || null);
  }

  if (allowedHosts !== undefined) {
    if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
      return errorResponse({
        code: 'INVALID_PARAM',
        message: 'allowedHosts must be a non-empty array',
        status: 400,
        param: 'allowedHosts',
        hint: 'Provide at least one host.',
        suggestion: 'Example: ["api.example.com"]',
      }, ctx.origin);
    }
    updates.push('allowed_hosts = ?');
    values.push(JSON.stringify(allowedHosts));
  }

  if (allowedMethods !== undefined) {
    if (!Array.isArray(allowedMethods) || allowedMethods.length === 0) {
      return errorResponse({
        code: 'INVALID_PARAM',
        message: 'allowedMethods must be a non-empty array',
        status: 400,
        param: 'allowedMethods',
        hint: 'Provide at least one HTTP method.',
        suggestion: 'Example: ["GET", "POST"]',
      }, ctx.origin);
    }
    updates.push('allowed_methods = ?');
    values.push(JSON.stringify(allowedMethods.map((m: string) => m.toUpperCase())));
  }

  if (allowedPaths !== undefined) {
    const pathValidation = validatePathPatterns(allowedPaths);
    if (!pathValidation.valid) {
      return errorResponse({
        code: 'INVALID_PATH_PATTERN',
        message: pathValidation.error!,
        status: 400,
        param: 'allowedPaths',
        suggestion: 'Examples: ["/v1/*"], ["/api/**"]',
      }, ctx.origin);
    }
    updates.push('allowed_paths = ?');
    values.push(JSON.stringify(allowedPaths));
  }

  if (injectionConfig !== undefined) {
    updates.push('injection_config = ?');
    values.push(injectionConfig ? JSON.stringify(injectionConfig) : null);
  }

  if (rateLimit !== undefined) {
    updates.push('rate_limit_rpm = ?');
    values.push(rateLimit);
  }

  if (credentials) {
    const { encrypted, iv } = await encryptCredentials(credentials, ctx.env.CREDENTIALS_KEY);

    if (secret.credentials_id) {
      await ctx.env.DB.prepare(`
        UPDATE artifact_secret_credentials SET encrypted_data = ?, iv = ?, updated_at = ?
        WHERE id = ?
      `).bind(encrypted, iv, now, secret.credentials_id).run();
    } else {
      const credId = generateId('scr');
      await ctx.env.DB.prepare(`
        INSERT INTO artifact_secret_credentials (id, artifact_id, encrypted_data, iv, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(credId, ctx.artifactId, encrypted, iv, now, now).run();

      updates.push('credentials_id = ?');
      values.push(credId);
    }
  }

  values.push(secret.id);
  await ctx.env.DB.prepare(
    `UPDATE artifact_secrets SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return successResponse({ name, updatedAt: now });
}

async function deleteSecret(ctx: DataContext, name: string): Promise<Response> {
  const secret = await ctx.env.DB.prepare(
    'SELECT id, credentials_id FROM artifact_secrets WHERE artifact_id = ? AND name = ?'
  ).bind(ctx.artifactId, name).first<{ id: string; credentials_id: string | null }>();

  if (!secret) {
    return errorResponse({
      ...DATA_ERRORS.SECRET_NOT_FOUND,
      hint: `No secret named "${name}" exists or it was already deleted.`,
      suggestion: 'Use GET /secrets to list existing secrets.',
    }, ctx.origin);
  }

  if (secret.credentials_id) {
    await ctx.env.DB.prepare(
      'DELETE FROM artifact_secret_credentials WHERE id = ?'
    ).bind(secret.credentials_id).run();
  }

  await ctx.env.DB.prepare(
    'DELETE FROM artifact_secrets WHERE id = ?'
  ).bind(secret.id).run();

  return successResponse({ deleted: true });
}

async function getAuditLog(ctx: DataContext, name: string, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 1000);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const result = await ctx.env.DB.prepare(`
    SELECT id, method, host, path, status_code, error, execution_time_ms, created_at
    FROM secret_audit_log
    WHERE artifact_id = ? AND secret_name = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(ctx.artifactId, name, limit, offset).all<{
    id: string;
    method: string;
    host: string;
    path: string;
    status_code: number | null;
    error: string | null;
    execution_time_ms: number | null;
    created_at: string;
  }>();

  return successResponse({
    logs: result.results.map(log => ({
      id: log.id,
      method: log.method,
      host: log.host,
      path: log.path,
      statusCode: log.status_code,
      error: log.error,
      executionTimeMs: log.execution_time_ms,
      createdAt: log.created_at,
    })),
    count: result.results.length,
  });
}

async function executeProxy(request: Request, ctx: DataContext, secretName: string): Promise<Response> {
  if (!ctx.env.CREDENTIALS_KEY) {
    return errorResponse(Errors.config('CREDENTIALS_KEY'), ctx.origin);
  }

  const secret = await ctx.env.DB.prepare(`
    SELECT s.*, c.encrypted_data, c.iv
    FROM artifact_secrets s
    LEFT JOIN artifact_secret_credentials c ON s.credentials_id = c.id
    WHERE s.artifact_id = ? AND s.name = ?
  `).bind(ctx.artifactId, secretName).first<SecretRow & {
    encrypted_data: string | null;
    iv: string | null;
  }>();

  if (!secret) {
    return errorResponse({
      ...DATA_ERRORS.SECRET_NOT_FOUND,
      hint: `No secret named "${secretName}" exists.`,
      suggestion: 'Verify the secret name or create it first.',
    }, ctx.origin);
  }

  let body: ProxyRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse(DATA_ERRORS.INVALID_JSON, ctx.origin);
  }

  const { method = 'GET', path, body: requestBody, headers: requestHeaders, query } = body;

  if (!path) {
    return errorResponse({
      ...Errors.missingParam('path', '/v1/chat/completions'),
      hint: 'The API path to call on the target host.',
    }, ctx.origin);
  }

  const allowedMethods: string[] = JSON.parse(secret.allowed_methods);
  if (!allowedMethods.includes(method.toUpperCase())) {
    await logAudit(ctx, secretName, method, '', path, null, 'Method not allowed');
    return errorResponse({
      ...DATA_ERRORS.METHOD_NOT_ALLOWED,
      message: `Method ${method} not allowed for this secret`,
      hint: `Secret "${secretName}" only allows: ${allowedMethods.join(', ')}.`,
      suggestion: 'Update the secret\'s allowedMethods or use a different method.',
    }, ctx.origin);
  }

  const allowedPaths: string[] = JSON.parse(secret.allowed_paths);
  if (!matchesAllowedPath(path, allowedPaths)) {
    await logAudit(ctx, secretName, method, '', path, null, 'Path not allowed');
    return errorResponse({
      ...DATA_ERRORS.PATH_NOT_ALLOWED,
      hint: `Path "${path}" is not in the secret's allowedPaths.`,
      suggestion: `Allowed patterns: ${allowedPaths.join(', ') || '(none configured)'}. Update the secret to allow this path.`,
    }, ctx.origin);
  }

  const allowedHosts: string[] = JSON.parse(secret.allowed_hosts);
  if (allowedHosts.length === 0) {
    return errorResponse({
      code: 'NO_HOSTS_CONFIGURED',
      message: 'No allowed hosts configured for this secret',
      status: 400,
      hint: 'The secret has no allowedHosts defined.',
      suggestion: 'Update the secret to add at least one host.',
    }, ctx.origin);
  }

  const baseHost = allowedHosts[0];
  const targetUrl = buildTargetUrl(baseHost, path, query);

  const blockCheck = isBlockedDestination(targetUrl);
  if (blockCheck.blocked) {
    await logAudit(ctx, secretName, method, baseHost, path, null, blockCheck.reason || 'Blocked destination');
    return errorResponse({
      ...DATA_ERRORS.BLOCKED_DESTINATION,
      hint: blockCheck.reason || 'This destination is on the security blocklist.',
      suggestion: 'Local/internal addresses and certain domains cannot be proxied.',
    }, ctx.origin);
  }

  const parsedUrl = new URL(targetUrl);
  if (!validateAllowedHost(parsedUrl.hostname, allowedHosts)) {
    await logAudit(ctx, secretName, method, parsedUrl.hostname, path, null, 'Host not in allowed list');
    return errorResponse({
      ...DATA_ERRORS.HOST_NOT_ALLOWED,
      hint: `Host "${parsedUrl.hostname}" is not in allowedHosts: ${allowedHosts.join(', ')}.`,
      suggestion: 'Update the secret to include this host.',
    }, ctx.origin);
  }

  if (!checkRateLimit(secret.id, secret.rate_limit_rpm)) {
    await logAudit(ctx, secretName, method, parsedUrl.hostname, path, null, 'Rate limit exceeded');
    return errorResponse({
      ...DATA_ERRORS.SECRET_RATE_LIMITED,
      hint: `Rate limit: ${secret.rate_limit_rpm} requests/minute.`,
      suggestion: 'Wait before retrying, or increase the secret\'s rateLimit setting.',
    }, ctx.origin);
  }

  let credentials: Record<string, unknown> | null = null;
  if (secret.encrypted_data && secret.iv) {
    credentials = await decryptCredentials(secret.encrypted_data, secret.iv, ctx.env.CREDENTIALS_KEY);
  }

  const outboundHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'ShareOut-Proxy/1.0',
  };

  if (requestHeaders) {
    const safeHeaders = ['Accept', 'Accept-Language', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'];
    for (const [key, value] of Object.entries(requestHeaders)) {
      if (safeHeaders.some(h => h.toLowerCase() === key.toLowerCase())) {
        outboundHeaders[key] = value;
      }
    }
  }

  if (credentials) {
    const injectionConfig = secret.injection_config ? JSON.parse(secret.injection_config) : {};

    switch (secret.injection_type) {
      case 'bearer': {
        const prefix = injectionConfig.prefix || 'Bearer ';
        outboundHeaders['Authorization'] = `${prefix}${credentials.value}`;
        break;
      }
      case 'basic': {
        const username = credentials.username || '';
        const password = credentials.password || credentials.value;
        outboundHeaders['Authorization'] = `Basic ${btoa(`${username}:${password}`)}`;
        break;
      }
      case 'header': {
        const headerName = injectionConfig.headerName || 'X-API-Key';
        const prefix = injectionConfig.prefix || '';
        outboundHeaders[headerName] = `${prefix}${credentials.value}`;
        break;
      }
      case 'query': {
        const paramName = injectionConfig.queryParam || 'api_key';
        const url = new URL(targetUrl);
        url.searchParams.set(paramName, credentials.value as string);
        break;
      }
    }
  }

  const start = Date.now();
  let statusCode: number | null = null;
  let errorMsg: string | null = null;

  try {
    const response = await fetch(targetUrl, {
      method: method.toUpperCase(),
      headers: outboundHeaders,
      body: requestBody ? JSON.stringify(requestBody) : undefined,
    });

    statusCode = response.status;
    const executionTimeMs = Date.now() - start;

    await logAudit(ctx, secretName, method, parsedUrl.hostname, path, statusCode, null, executionTimeMs);

    const contentType = response.headers.get('Content-Type') || '';
    let data: unknown;

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return successResponse({
      data,
      status: response.status,
      executionTimeMs,
    });
  } catch (err) {
    const executionTimeMs = Date.now() - start;
    errorMsg = err instanceof Error ? err.message : 'Proxy request failed';

    logError(
      createLogger(ctx.env, {
        scope: 'secrets',
        event: 'secret.proxy_failed',
        artifact_id: ctx.artifactId,
        secret_name: secretName,
        target_host: parsedUrl.hostname,
        target_path: path,
      }),
      'secret proxy upstream fetch failed',
      err,
    );

    await logAudit(ctx, secretName, method, parsedUrl.hostname, path, statusCode, errorMsg, executionTimeMs);

    if (err instanceof Error && err.name === 'AbortError') {
      return errorResponse({
        ...DATA_ERRORS.PROXY_ERROR,
        message: 'Request timed out',
        hint: `Request to ${parsedUrl.hostname} timed out.`,
      }, ctx.origin);
    }

    return errorResponse(
      Errors.proxy(parsedUrl.hostname, statusCode ?? undefined),
      ctx.origin
    );
  }
}

function buildTargetUrl(host: string, path: string, query?: Record<string, string>): string {
  let baseUrl = host;
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }

  let normalizedPath = path;
  if (!normalizedPath.startsWith('/')) {
    normalizedPath = '/' + normalizedPath;
  }

  const url = new URL(normalizedPath, baseUrl);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

async function logAudit(
  ctx: DataContext,
  secretName: string,
  method: string,
  host: string,
  path: string,
  statusCode: number | null,
  error: string | null,
  executionTimeMs?: number
): Promise<void> {
  const id = generateId('aud');
  const now = new Date().toISOString();

  await ctx.env.DB.prepare(`
    INSERT INTO secret_audit_log (id, artifact_id, secret_name, method, host, path, status_code, error, execution_time_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, ctx.artifactId, secretName, method, host, path, statusCode, error, executionTimeMs || null, now).run();
}
