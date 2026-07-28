/**
 * Artifact-scoped connection CRUD handlers.
 *
 * Owners manage artifact-local connections. Workspace-shared connectors are
 * listed alongside locals but created/managed at the workspace level.
 */
import { DATA_ERRORS } from '../../types';
import { generateId } from '../../crypto-utils';
import { successResponse, errorResponse, type DataContext } from '../middleware';
import { encryptCredentials } from './credentials';
import type { WorkspaceCredentialScope } from './user-credentials';
import {
  CONNECTION_TYPES,
  NAME_PATTERN,
  type ConnectionConfig,
  type ConnectionRow,
  type ListedConnection,
} from './types';
import { validateRestBaseUrl } from './rest-query';

/** Validate a connection name — returns an error message or null if valid. */
export function validateName(name: string): string | null {
  if (!name) return 'Name is required';
  if (name.length > 64) return 'Name too long (max 64 chars)';
  if (!NAME_PATTERN.test(name)) return 'Name contains invalid characters';
  return null;
}

export async function listConnections(ctx: DataContext): Promise<Response> {
  const result = await ctx.env.DB.prepare(
    "SELECT name, provider AS type, cache_ttl_seconds, rate_limit_rpm, created_at FROM connections\n     WHERE scope_type = 'artifact' AND scope_id = ? AND kind = 'generic' ORDER BY name",
  ).bind(ctx.artifactId).all<ConnectionRow>();

  const local: ListedConnection[] = result.results.map(c => ({
    name: c.name,
    type: c.type,
    cacheTtl: c.cache_ttl_seconds,
    rateLimit: c.rate_limit_rpm,
    createdAt: c.created_at,
    scope: 'artifact',
  }));

  const ws = await ctx.env.DB.prepare(
    'SELECT workspace_id FROM artifacts WHERE id = ?',
  ).bind(ctx.artifactId).first<{ workspace_id: string | null }>();

  let shared: ListedConnection[] = [];
  if (ws?.workspace_id) {
    const sharedRows = await ctx.env.DB.prepare(
      `SELECT name, provider AS type, cache_ttl_seconds, rate_limit_rpm, created_at, credential_scope
       FROM connections
       WHERE scope_type = 'workspace' AND scope_id = ? AND kind = 'generic' ORDER BY name`,
    ).bind(ws.workspace_id).all<{
      name: string;
      type: string;
      cache_ttl_seconds: number;
      rate_limit_rpm: number;
      created_at: string;
      credential_scope: WorkspaceCredentialScope;
    }>();

    shared = sharedRows.results.map(c => ({
      name: c.name,
      type: c.type,
      cacheTtl: c.cache_ttl_seconds,
      rateLimit: c.rate_limit_rpm,
      createdAt: c.created_at,
      scope: 'workspace',
      credentialScope: c.credential_scope,
    }));
  }

  const connections = [...local, ...shared];
  return successResponse({ connections, count: connections.length });
}

export async function getConnection(ctx: DataContext, name: string): Promise<Response> {
  const conn = await ctx.env.DB.prepare(
    "SELECT name, provider AS type, config, cache_ttl_seconds, rate_limit_rpm, created_at, updated_at FROM connections\n     WHERE scope_type = 'artifact' AND scope_id = ? AND kind = 'generic' AND name = ?",
  ).bind(ctx.artifactId, name).first<ConnectionRow>();

  if (!conn) {
    return errorResponse({ ...DATA_ERRORS.NOT_FOUND, message: 'Connection not found' });
  }

  return successResponse({
    name: conn.name,
    type: conn.type,
    config: JSON.parse(conn.config),
    cacheTtl: conn.cache_ttl_seconds,
    rateLimit: conn.rate_limit_rpm,
    createdAt: conn.created_at,
    updatedAt: conn.updated_at,
  });
}

export async function createConnection(
  request: Request,
  ctx: DataContext,
): Promise<Response> {
  if (!ctx.env.CREDENTIALS_KEY) {
    return errorResponse({
      code: 'CONFIG_ERROR',
      message: 'CREDENTIALS_KEY not configured',
      status: 500,
    });
  }

  let body: ConnectionConfig;
  try {
    body = await request.json();
  } catch {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid JSON body' });
  }

  const { name, type, config, credentials, cacheTtl, rateLimit } = body;

  const nameError = validateName(name);
  if (nameError) {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: nameError });
  }

  if (!CONNECTION_TYPES.includes(type)) {
    return errorResponse({
      ...DATA_ERRORS.INVALID_REQUEST,
      message: `Type must be one of: ${CONNECTION_TYPES.join(', ')}`,
    });
  }

  if (type === 'rest_api') {
    const baseErr = validateRestBaseUrl((config || {}).baseUrl);
    if (baseErr) {
      return errorResponse({
        ...DATA_ERRORS.INVALID_REQUEST,
        message: baseErr,
        param: 'config.baseUrl',
        hint: 'Use a public https URL. Private, loopback, and cloud-metadata hosts are blocked.',
      });
    }
  }

  const existing = await ctx.env.DB.prepare(
    "SELECT id FROM connections WHERE scope_type = 'artifact' AND scope_id = ? AND name = ?",
  ).bind(ctx.artifactId, name).first();

  if (existing) {
    return errorResponse({ ...DATA_ERRORS.CONFLICT, message: 'Connection already exists' });
  }

  let encryptedCredentials: string | null = null;
  let credentialsIv: string | null = null;
  if (credentials) {
    const { encrypted, iv } = await encryptCredentials(
      credentials.data,
      ctx.env.CREDENTIALS_KEY,
    );
    encryptedCredentials = encrypted;
    credentialsIv = iv;
  }

  const connId = generateId('con');
  const now = new Date().toISOString();

  await ctx.env.DB.prepare(`
    INSERT INTO connections (id, scope_type, scope_id, name, kind, provider, auth_type, config,
                             encrypted_credentials, iv, cache_ttl_seconds, rate_limit_rpm, created_at, updated_at)
    VALUES (?, 'artifact', ?, ?, 'generic', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    connId, ctx.artifactId, name, type, credentials?.type ?? null, JSON.stringify(config || {}),
    encryptedCredentials, credentialsIv, cacheTtl || 300, rateLimit || 60, now, now,
  ).run();

  return successResponse({
    name,
    type,
    hasCredentials: !!credentials,
    createdAt: now,
  }, 201);
}

export async function updateConnection(
  request: Request,
  ctx: DataContext,
  name: string,
): Promise<Response> {
  if (!ctx.env.CREDENTIALS_KEY) {
    return errorResponse({
      code: 'CONFIG_ERROR',
      message: 'CREDENTIALS_KEY not configured',
      status: 500,
    });
  }

  const conn = await ctx.env.DB.prepare(
    "SELECT id FROM connections WHERE scope_type = 'artifact' AND scope_id = ? AND name = ?",
  ).bind(ctx.artifactId, name).first<{ id: string }>();

  if (!conn) {
    return errorResponse({ ...DATA_ERRORS.NOT_FOUND, message: 'Connection not found' });
  }

  let body: Partial<ConnectionConfig>;
  try {
    body = await request.json();
  } catch {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid JSON body' });
  }

  const { config, credentials, cacheTtl, rateLimit } = body;
  const now = new Date().toISOString();
  const updates: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (config !== undefined) {
    // When updating a rest_api connection, re-check baseUrl against the SSRF blocklist.
    const provider = await ctx.env.DB.prepare(
      "SELECT provider FROM connections WHERE id = ?",
    ).bind(conn.id).first<{ provider: string }>();
    if (provider?.provider === 'rest_api') {
      const baseErr = validateRestBaseUrl((config as Record<string, unknown>).baseUrl);
      if (baseErr) {
        return errorResponse({
          ...DATA_ERRORS.INVALID_REQUEST,
          message: baseErr,
          param: 'config.baseUrl',
          hint: 'Use a public https URL. Private, loopback, and cloud-metadata hosts are blocked.',
        });
      }
    }
    updates.push('config = ?');
    values.push(JSON.stringify(config));
  }

  if (cacheTtl !== undefined) {
    updates.push('cache_ttl_seconds = ?');
    values.push(cacheTtl);
  }

  if (rateLimit !== undefined) {
    updates.push('rate_limit_rpm = ?');
    values.push(rateLimit);
  }

  if (credentials) {
    const { encrypted, iv } = await encryptCredentials(
      credentials.data,
      ctx.env.CREDENTIALS_KEY,
    );

    updates.push('auth_type = ?', 'encrypted_credentials = ?', 'iv = ?');
    values.push(credentials.type, encrypted, iv);
  }

  values.push(conn.id);
  await ctx.env.DB.prepare(
    `UPDATE connections SET ${updates.join(', ')} WHERE id = ?`,
  ).bind(...values).run();

  return successResponse({ name, updatedAt: now });
}

export async function deleteConnection(ctx: DataContext, name: string): Promise<Response> {
  const conn = await ctx.env.DB.prepare(
    "SELECT id FROM connections WHERE scope_type = 'artifact' AND scope_id = ? AND name = ?",
  ).bind(ctx.artifactId, name).first<{ id: string }>();

  if (!conn) {
    return errorResponse({ ...DATA_ERRORS.NOT_FOUND, message: 'Connection not found' });
  }

  await ctx.env.DB.prepare(
    'DELETE FROM connection_cache WHERE connection_id = ?',
  ).bind(conn.id).run();

  await ctx.env.DB.prepare(
    'DELETE FROM connections WHERE id = ?',
  ).bind(conn.id).run();

  return successResponse({ deleted: true });
}
