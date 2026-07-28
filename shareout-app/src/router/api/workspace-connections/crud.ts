/**
 * Workspace connection CRUD — create, read, update, delete, and probe connectors.
 */
import type { Env } from '../../../types';
import type { AuthUser } from '../../../api-auth';
import { createLogger, logError } from '../../../logging';
import { generateId } from '../../../crypto-utils';
import { logAudit } from '../../../audit';
import { encryptCredentials, decryptCredentials } from '../../../data/connections/credentials';
import { getProvider, hasProvider, listProviders } from '../../../data/platform';
import { seedCatalogForConnection } from '../../../catalog';
import { buildProbeCredentials, summarizeCredentials } from './credentials';
import {
  GENERIC_TYPES,
  STATIC_AUTH_TYPES,
  json,
  requireAdmin,
  validateName,
  type CredentialScope,
} from './shared';

// Auto-seed the workspace catalog from a just-created connection (B14). Best-effort:
// seedCatalogForConnection never throws, but the scheduling itself must never let a
// slow/odd waitUntil failure surface as a create-request error either. Runs past the
// response when a waitUntil context is available (the normal Worker fetch path);
// with no executionCtx (direct/unit-test calls, matching scheduleSeedStarterKit's
// convention), seeding is skipped rather than blocking the caller.
function scheduleCatalogSeed(
  env: Env,
  workspaceId: string,
  connectionId: string,
  executionCtx?: ExecutionContext
): void {
  if (!executionCtx?.waitUntil) return;
  executionCtx.waitUntil(seedCatalogForConnection(env, workspaceId, connectionId).catch(() => null));
}

// POST /v1/workspaces/{id}/connections/test — probe credentials WITHOUT saving
export async function handleTestWorkspaceConnection(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  if (!(await requireAdmin(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  let body: { provider?: string; config?: Record<string, unknown>; credentials?: { type: string; data?: Record<string, unknown> } };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400);
  }
  if (!body.provider || !hasProvider(body.provider)) {
    return json({ error: 'Unknown or unregistered provider', code: 'PROVIDER_NOT_FOUND' }, 400);
  }
  const provider = getProvider(body.provider)!;
  if (!provider.verifyConnection) {
    return json({ testable: false, message: 'No test available for this connector' });
  }
  try {
    const result = await provider.verifyConnection(env, body.config || {}, buildProbeCredentials(body.credentials));
    return json(result);
  } catch (err) {
    logError(
      createLogger(env, {
        scope: 'workspace-connections',
        event: 'connection.test.failed',
        workspace_id: workspaceId,
        provider: body.provider,
      }),
      'workspace connection test failed',
      err,
    );
    return json({ ok: false, message: 'Connection test failed' });
  }
}

// GET /v1/workspaces/{id}/connections/{connId} — full detail for admins
export async function handleGetWorkspaceConnection(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  connectionId: string
): Promise<Response> {
  if (!(await requireAdmin(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const row = await env.DB.prepare(`
    SELECT c.id, c.name, c.kind, c.provider, c.auth_type, c.config, c.preferred_mode,
           c.cache_ttl_seconds, c.rate_limit_rpm, c.created_by, c.created_at, c.updated_at,
           c.encrypted_credentials, c.iv, c.credential_scope, u.email AS creator_email
    FROM connections c
    LEFT JOIN users u ON u.id = c.created_by
    WHERE c.id = ? AND c.scope_type = 'workspace' AND c.scope_id = ?
  `).bind(connectionId, workspaceId).first<{
    id: string; name: string; kind: string; provider: string; auth_type: string;
    config: string; preferred_mode: string; cache_ttl_seconds: number; rate_limit_rpm: number;
    created_by: string | null; created_at: string; updated_at: string;
    encrypted_credentials: string; iv: string; credential_scope: CredentialScope;
    creator_email: string | null;
  }>();

  if (!row) {
    return json({ error: 'Connection not found', code: 'NOT_FOUND' }, 404);
  }

  let credential: { authType: string; identifiers: Record<string, unknown>; secretsConfigured: string[] } = {
    authType: row.auth_type, identifiers: {}, secretsConfigured: [],
  };
  if (row.credential_scope !== 'per_user' && env.CREDENTIALS_KEY) {
    try {
      const decrypted = await decryptCredentials(row.encrypted_credentials, row.iv, env.CREDENTIALS_KEY);
      const { identifiers, secretsConfigured } = summarizeCredentials(decrypted);
      credential = { authType: row.auth_type, identifiers, secretsConfigured };
    } catch {
      // Leave the summary empty if the blob can't be read.
    }
  }

  return json({
    id: row.id,
    name: row.name,
    kind: row.kind,
    provider: row.provider,
    authType: row.auth_type,
    credentialScope: row.credential_scope,
    config: JSON.parse(row.config),
    preferredMode: row.preferred_mode,
    cacheTtl: row.cache_ttl_seconds,
    rateLimit: row.rate_limit_rpm,
    createdBy: row.created_by,
    createdByEmail: row.creator_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    credential,
  });
}

// POST /v1/workspaces/{id}/connections — create a static-credential (generic) connector
export async function handleCreateWorkspaceConnection(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  executionCtx?: ExecutionContext
): Promise<Response> {
  if (!(await requireAdmin(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  if (!env.CREDENTIALS_KEY) {
    return json({ error: 'CREDENTIALS_KEY not configured', code: 'CONFIG_ERROR' }, 500);
  }

  let body: {
    name: string;
    kind?: string;
    type: string;
    provider?: string;
    config?: Record<string, unknown>;
    credentials?: { type: string; data?: Record<string, unknown> };
    authType?: string;
    credentialScope?: string;
    preferredMode?: string;
    cacheTtl?: number;
    rateLimit?: number;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400);
  }

  const nameError = validateName(body.name);
  if (nameError) {
    return json({ error: nameError, code: 'VALIDATION_ERROR' }, 400);
  }

  if (body.kind === 'platform') {
    return createPlatformConnection(env, workspaceId, user.id, body, executionCtx);
  }

  if (!GENERIC_TYPES.includes(body.type as (typeof GENERIC_TYPES)[number])) {
    return json({ error: `Type must be one of: ${GENERIC_TYPES.join(', ')}`, code: 'VALIDATION_ERROR' }, 400);
  }

  const credentialScope: CredentialScope = body.credentialScope === 'per_user' ? 'per_user' : 'shared';
  const authType = body.credentials?.type || body.authType;

  if (credentialScope === 'per_user') {
    if (!authType || !STATIC_AUTH_TYPES.includes(authType as (typeof STATIC_AUTH_TYPES)[number])) {
      return json({
        error: `authType (or credentials.type) must be one of: ${STATIC_AUTH_TYPES.join(', ')} for per-user connectors`,
        code: 'VALIDATION_ERROR',
      }, 400);
    }
    if (body.credentials?.data && Object.keys(body.credentials.data).length > 0) {
      return json({
        error: 'Do not send credential values when credentialScope is per_user; members save their own via my-credentials',
        code: 'VALIDATION_ERROR',
      }, 400);
    }
  } else {
    if (!body.credentials?.data) {
      return json({ error: 'credentials is required for a shared connector', code: 'VALIDATION_ERROR' }, 400);
    }
    if (!authType || !STATIC_AUTH_TYPES.includes(authType as (typeof STATIC_AUTH_TYPES)[number])) {
      return json({ error: `credentials.type must be one of: ${STATIC_AUTH_TYPES.join(', ')}`, code: 'VALIDATION_ERROR' }, 400);
    }
  }

  const existing = await env.DB.prepare(
    "SELECT id FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND name = ?"
  ).bind(workspaceId, body.name).first();
  if (existing) {
    return json({ error: 'Connection already exists', code: 'CONFLICT' }, 409);
  }

  const credentialPayload = credentialScope === 'per_user'
    ? {}
    : (body.credentials!.data as Record<string, unknown>);
  const { encrypted, iv } = await encryptCredentials(credentialPayload, env.CREDENTIALS_KEY);
  const id = generateId('conn');

  await env.DB.prepare(`
    INSERT INTO connections (
      id, scope_type, scope_id, name, kind, provider, auth_type, config,
      encrypted_credentials, iv, cache_ttl_seconds, rate_limit_rpm, created_by, credential_scope
    ) VALUES (?, 'workspace', ?, ?, 'generic', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, workspaceId, body.name, body.type, authType,
    JSON.stringify(body.config || {}), encrypted, iv,
    body.cacheTtl || 300, body.rateLimit || 60, user.id, credentialScope
  ).run();

  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: 'connection.create', targetType: 'connection', targetId: id,
    detail: { kind: 'generic', type: body.type, credentialScope },
  });

  scheduleCatalogSeed(env, workspaceId, id, executionCtx);

  return json({ id, name: body.name, kind: 'generic', type: body.type, credentialScope }, 201);
}

/** Create a platform (OAuth) connection from supplied tokens, bypassing interactive OAuth. */
async function createPlatformConnection(
  env: Env,
  workspaceId: string,
  userId: string,
  body: {
    name: string;
    provider?: string;
    config?: Record<string, unknown>;
    credentials?: { type: string; data?: Record<string, unknown> };
    credentialScope?: string;
    preferredMode?: string;
  },
  executionCtx?: ExecutionContext
): Promise<Response> {
  if (!body.provider || !hasProvider(body.provider)) {
    return json({
      error: 'Unknown or unregistered provider',
      code: 'PROVIDER_NOT_FOUND',
      available: listProviders().map((p) => p.id),
    }, 400);
  }

  const credentialScope: CredentialScope = body.credentialScope === 'per_user' ? 'per_user' : 'shared';

  let credentialPayload: Record<string, unknown>;
  let authType: string;

  if (credentialScope === 'per_user') {
    const perUserType = body.credentials?.type;
    if (perUserType !== 'service_account' && perUserType !== 'authorized_user') {
      return json({ error: "per_user platform connections support credentials.type 'service_account' or 'authorized_user' (each member adds their own)", code: 'VALIDATION_ERROR' }, 400);
    }
    if (body.credentials?.data && Object.keys(body.credentials.data).length > 0) {
      return json({ error: 'Do not send credential values when credentialScope is per_user; members save their own via my-credentials', code: 'VALIDATION_ERROR' }, 400);
    }
    authType = perUserType;
    credentialPayload = {};
  } else {
    if (!body.credentials || !['oauth', 'service_account', 'authorized_user', 'key_pair'].includes(body.credentials.type)) {
      return json({ error: "credentials.type must be 'oauth', 'service_account', 'authorized_user', or 'key_pair' for a platform connection", code: 'VALIDATION_ERROR' }, 400);
    }
    const creds = body.credentials;
    const data = creds.data || {};

    if (creds.type === 'key_pair') {
      if (!data.private_key) {
        return json({ error: 'key_pair credentials require private_key', code: 'VALIDATION_ERROR' }, 400);
      }
      authType = 'key_pair';
      credentialPayload = {
        access_token: '',
        extra: {
          private_key: data.private_key,
          ...(data.user ? { user: data.user } : {}),
          ...(data.account ? { account: data.account } : {}),
          ...(data.public_key_fingerprint ? { public_key_fingerprint: data.public_key_fingerprint } : {}),
        },
      };
    } else if (creds.type === 'service_account') {
      if (!data.client_email || !data.private_key) {
        return json({ error: 'service_account credentials require client_email and private_key', code: 'VALIDATION_ERROR' }, 400);
      }
      authType = 'service_account';
      credentialPayload = {
        access_token: '',
        extra: { service_account: data },
      };
    } else if (creds.type === 'authorized_user') {
      if (!data.client_id || !data.client_secret || !data.refresh_token) {
        return json({ error: 'authorized_user credentials require client_id, client_secret, and refresh_token', code: 'VALIDATION_ERROR' }, 400);
      }
      authType = 'authorized_user';
      credentialPayload = {
        access_token: '',
        extra: {
          authorized_user: { client_id: data.client_id, client_secret: data.client_secret, refresh_token: data.refresh_token },
          ...(data.developer_token ? { developer_token: data.developer_token } : {}),
        },
      };
    } else {
      if (!data.access_token) {
        return json({ error: 'credentials.data.access_token is required', code: 'VALIDATION_ERROR' }, 400);
      }
      authType = 'oauth2';
      credentialPayload = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at,
        extra: data.extra,
      };
    }
  }

  const preferredMode = body.preferredMode || 'auto';
  if (!['direct', 'proxy', 'auto'].includes(preferredMode)) {
    return json({ error: "preferredMode must be one of: direct, proxy, auto", code: 'VALIDATION_ERROR' }, 400);
  }

  const existing = await env.DB.prepare(
    "SELECT id FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND name = ?"
  ).bind(workspaceId, body.name).first();
  if (existing) {
    return json({ error: 'Connection already exists', code: 'CONFLICT' }, 409);
  }

  const { encrypted, iv } = await encryptCredentials(credentialPayload, env.CREDENTIALS_KEY!);
  const id = generateId('conn');

  await env.DB.prepare(`
    INSERT INTO connections (
      id, scope_type, scope_id, name, kind, provider, auth_type, config,
      encrypted_credentials, iv, preferred_mode, created_by, credential_scope
    ) VALUES (?, 'workspace', ?, ?, 'platform', ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, workspaceId, body.name, body.provider, authType,
    JSON.stringify(body.config || {}), encrypted, iv, preferredMode, userId, credentialScope
  ).run();

  await logAudit(env, {
    workspaceId, actorId: userId,
    action: 'connection.create', targetType: 'connection', targetId: id,
    detail: { kind: 'platform', provider: body.provider, credentialScope },
  });

  scheduleCatalogSeed(env, workspaceId, id, executionCtx);

  return json({ id, name: body.name, kind: 'platform', provider: body.provider, credentialScope }, 201);
}

// DELETE /v1/workspaces/{id}/connections/{connId}
export async function handleDeleteWorkspaceConnection(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  connectionId: string
): Promise<Response> {
  if (!(await requireAdmin(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const conn = await env.DB.prepare(
    "SELECT id FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND id = ?"
  ).bind(workspaceId, connectionId).first();
  if (!conn) {
    return json({ error: 'Connection not found', code: 'NOT_FOUND' }, 404);
  }

  await env.DB.prepare(
    "DELETE FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND id = ?"
  ).bind(workspaceId, connectionId).run();

  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: 'connection.delete', targetType: 'connection', targetId: connectionId,
  });

  return json({ deleted: true });
}

// PATCH /v1/workspaces/{id}/connections/{connId} — toggle agent_query_enabled
export async function handleUpdateWorkspaceConnection(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  connectionId: string
): Promise<Response> {
  if (!(await requireAdmin(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const conn = await env.DB.prepare(
    "SELECT id FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND id = ?"
  ).bind(workspaceId, connectionId).first();
  if (!conn) {
    return json({ error: 'Connection not found', code: 'NOT_FOUND' }, 404);
  }

  const body = await request.json().catch(() => ({})) as { agent_query_enabled?: boolean };
  if (typeof body.agent_query_enabled !== 'boolean') {
    return json({ error: 'agent_query_enabled (boolean) required', code: 'BAD_REQUEST' }, 400);
  }

  await env.DB.prepare(
    "UPDATE connections SET agent_query_enabled = ? WHERE scope_type = 'workspace' AND scope_id = ? AND id = ?"
  ).bind(body.agent_query_enabled ? 1 : 0, workspaceId, connectionId).run();

  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: 'connection.update', targetType: 'connection', targetId: connectionId,
  });

  return json({ updated: true, agent_query_enabled: body.agent_query_enabled });
}
