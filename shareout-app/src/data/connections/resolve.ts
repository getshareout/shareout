/**
 * Connection resolution, credential loading, and action authorization.
 *
 * Resolution order: artifact-local connection by name, then workspace-shared
 * generic connector from the artifact's workspace. Per-user workspace connectors
 * require the requester's saved credentials.
 */
import type { Env } from '../../types';
import { DATA_ERRORS } from '../../types';
import {
  errorResponse,
  verifyOwner,
  verifyPerUserWorkspaceConnectionQuery,
  type DataContext,
} from '../middleware';
import { decryptCredentials } from './credentials';
import { loadUserConnectionCredentials } from './user-credentials';
import type { ResolvedGenericConnection } from './types';

/** Resolve a generic connection by name: artifact-local first, then workspace-shared. */
export async function resolveGenericConnection(
  env: Env,
  artifactId: string,
  name: string,
): Promise<ResolvedGenericConnection | null> {
  const local = await env.DB.prepare(`
    SELECT id, provider AS type, config, cache_ttl_seconds, rate_limit_rpm,
           encrypted_credentials AS encrypted_data, iv, auth_type AS cred_type
    FROM connections
    WHERE scope_type = 'artifact' AND scope_id = ? AND name = ? AND kind = 'generic'
  `).bind(artifactId, name).first<Omit<ResolvedGenericConnection, 'scope'>>();

  if (local) return { ...local, scope: 'artifact' };

  const ws = await env.DB.prepare(
    'SELECT workspace_id FROM artifacts WHERE id = ?',
  ).bind(artifactId).first<{ workspace_id: string | null }>();

  if (!ws?.workspace_id) return null;

  const shared = await env.DB.prepare(`
    SELECT id, provider AS type, config, cache_ttl_seconds, rate_limit_rpm,
           encrypted_credentials AS encrypted_data, iv, auth_type AS cred_type,
           credential_scope
    FROM connections
    WHERE scope_type = 'workspace' AND scope_id = ? AND name = ? AND kind = 'generic'
  `).bind(ws.workspace_id, name).first<Omit<ResolvedGenericConnection, 'scope'>>();

  if (shared) {
    return {
      ...shared,
      scope: 'workspace',
      workspace_id: ws.workspace_id,
      encrypted_data: shared.credential_scope === 'per_user' ? null : shared.encrypted_data,
      iv: shared.credential_scope === 'per_user' ? null : shared.iv,
    };
  }
  return null;
}

/** Best-effort usage tracking for workspace-shared connectors — never blocks queries. */
export async function recordConnectionUsage(
  env: Env,
  connectionId: string,
  artifactId: string,
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO connection_usage (connection_id, artifact_id)
      VALUES (?, ?)
      ON CONFLICT(connection_id, artifact_id)
      DO UPDATE SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), use_count = use_count + 1
    `).bind(connectionId, artifactId).run();
  } catch (err) {
    console.error('recordConnectionUsage failed', err);
  }
}

/** Owner or per-user workspace access required for query/test/materialize. */
export async function authorizeConnectionAction(
  request: Request,
  ctx: DataContext,
  connectionName: string,
): Promise<Response | null> {
  if (await verifyOwner(request, ctx)) return null;

  const access = await verifyPerUserWorkspaceConnectionQuery(request, ctx, connectionName);
  if (access === 'allowed') return null;

  if (access === 'credentials_required') {
    return errorResponse({
      code: 'CREDENTIALS_REQUIRED',
      message: 'Connect your credentials for this connector before querying',
      status: 403,
      hint: 'Save your token via PUT /v1/workspaces/{workspaceId}/connections/{connectionId}/my-credentials',
    }, ctx.origin);
  }

  return errorResponse(DATA_ERRORS.FORBIDDEN, ctx.origin);
}

export async function resolveConnectionCredentials(
  env: Env,
  conn: ResolvedGenericConnection,
  userId: string | null,
): Promise<{ credentials: Record<string, unknown> | null; credType: string | null }> {
  if (!env.CREDENTIALS_KEY) {
    throw new Error('CREDENTIALS_KEY not configured');
  }

  if (conn.scope === 'workspace' && conn.credential_scope === 'per_user') {
    if (!userId) throw new Error('CREDENTIALS_REQUIRED');
    const credentials = await loadUserConnectionCredentials(env, conn.id, userId, env.CREDENTIALS_KEY);
    return { credentials, credType: conn.cred_type };
  }

  if (conn.encrypted_data && conn.iv) {
    const credentials = await decryptCredentials(conn.encrypted_data, conn.iv, env.CREDENTIALS_KEY);
    return { credentials, credType: conn.cred_type };
  }

  return { credentials: null, credType: conn.cred_type };
}
