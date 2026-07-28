/**
 * Per-user credential routes — members save their own secrets for
 * connectors with credentialScope = per_user.
 */
import type { Env } from '../../../types';
import type { AuthUser } from '../../../api-auth';
import {
  deleteUserConnectionCredentials,
  getUserCredentialMeta,
  hasUserConnectionCredentials,
  saveUserConnectionCredentials,
} from '../../../data/connections/user-credentials';
import { json, requireMember, type CredentialScope } from './shared';

// GET /v1/workspaces/{id}/connections/{connId}/my-credentials
export async function handleGetMyConnectionCredentials(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  connectionId: string
): Promise<Response> {
  if (!(await requireMember(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const conn = await env.DB.prepare(`
    SELECT id, auth_type, credential_scope FROM connections
    WHERE scope_type = 'workspace' AND scope_id = ? AND id = ?
  `).bind(workspaceId, connectionId).first<{ id: string; auth_type: string; credential_scope: CredentialScope }>();

  if (!conn) {
    return json({ error: 'Connection not found', code: 'NOT_FOUND' }, 404);
  }
  if (conn.credential_scope !== 'per_user') {
    return json({ error: 'This connector uses shared workspace credentials', code: 'NOT_PER_USER' }, 400);
  }

  const configured = await hasUserConnectionCredentials(env, connectionId, user.id);
  const meta = configured ? await getUserCredentialMeta(env, connectionId, user.id) : null;

  return json({
    configured,
    authType: conn.auth_type,
    updatedAt: meta?.updatedAt ?? null,
  });
}

// PUT /v1/workspaces/{id}/connections/{connId}/my-credentials
export async function handlePutMyConnectionCredentials(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  connectionId: string
): Promise<Response> {
  if (!(await requireMember(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  if (!env.CREDENTIALS_KEY) {
    return json({ error: 'CREDENTIALS_KEY not configured', code: 'CONFIG_ERROR' }, 500);
  }

  const conn = await env.DB.prepare(`
    SELECT id, kind, auth_type, credential_scope FROM connections
    WHERE scope_type = 'workspace' AND scope_id = ? AND id = ?
  `).bind(workspaceId, connectionId).first<{ id: string; kind: string; auth_type: string; credential_scope: CredentialScope }>();

  if (!conn) {
    return json({ error: 'Connection not found', code: 'NOT_FOUND' }, 404);
  }
  if (conn.credential_scope !== 'per_user') {
    return json({ error: 'This connector uses shared workspace credentials', code: 'NOT_PER_USER' }, 400);
  }

  let body: { credentials?: { type: string; data: Record<string, unknown> } };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400);
  }

  if (!body.credentials?.data) {
    return json({ error: 'credentials.data is required', code: 'VALIDATION_ERROR' }, 400);
  }
  if (body.credentials.type !== conn.auth_type) {
    return json({
      error: `credentials.type must be '${conn.auth_type}' for this connector`,
      code: 'VALIDATION_ERROR',
    }, 400);
  }

  // Platform connectors are read by the platform engine, which expects the
  // { access_token, extra } envelope. Generic connectors store the raw data.
  let payload: Record<string, unknown> = body.credentials.data;
  if (conn.kind === 'platform') {
    const d = body.credentials.data;
    if (conn.auth_type === 'service_account') {
      if (!d.client_email || !d.private_key) {
        return json({ error: 'service_account credentials require client_email and private_key', code: 'VALIDATION_ERROR' }, 400);
      }
      payload = { access_token: '', extra: { service_account: d } };
    } else if (conn.auth_type === 'authorized_user') {
      if (!d.client_id || !d.client_secret || !d.refresh_token) {
        return json({ error: 'authorized_user credentials require client_id, client_secret, and refresh_token', code: 'VALIDATION_ERROR' }, 400);
      }
      payload = { access_token: '', extra: { authorized_user: { client_id: d.client_id, client_secret: d.client_secret, refresh_token: d.refresh_token } } };
    } else {
      return json({ error: `Per-user credentials for '${conn.auth_type}' platform connectors are not supported yet`, code: 'VALIDATION_ERROR' }, 400);
    }
  }

  await saveUserConnectionCredentials(env, connectionId, user.id, payload, env.CREDENTIALS_KEY);

  return json({ configured: true, authType: conn.auth_type }, 200);
}

// DELETE /v1/workspaces/{id}/connections/{connId}/my-credentials
export async function handleDeleteMyConnectionCredentials(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  connectionId: string
): Promise<Response> {
  if (!(await requireMember(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const conn = await env.DB.prepare(
    "SELECT credential_scope FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND id = ?"
  ).bind(workspaceId, connectionId).first<{ credential_scope: CredentialScope }>();

  if (!conn) {
    return json({ error: 'Connection not found', code: 'NOT_FOUND' }, 404);
  }
  if (conn.credential_scope !== 'per_user') {
    return json({ error: 'This connector uses shared workspace credentials', code: 'NOT_PER_USER' }, 400);
  }

  await deleteUserConnectionCredentials(env, connectionId, user.id);
  return json({ deleted: true });
}
