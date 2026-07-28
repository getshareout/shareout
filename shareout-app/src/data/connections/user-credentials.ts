import type { Env } from '../../types';
import { encryptCredentials, decryptCredentials } from './credentials';

export type WorkspaceCredentialScope = 'shared' | 'per_user';

export interface WorkspaceGenericConnectionRow {
  id: string;
  workspace_id: string;
  name: string;
  type: string;
  config: string;
  auth_type: string;
  credential_scope: WorkspaceCredentialScope;
  encrypted_credentials: string;
  iv: string;
  cache_ttl_seconds: number;
  rate_limit_rpm: number;
}

export async function hasUserConnectionCredentials(
  env: Env,
  connectionId: string,
  userId: string
): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 FROM connection_user_credentials WHERE connection_id = ? AND user_id = ?'
  ).bind(connectionId, userId).first();
  return !!row;
}

export async function loadUserConnectionCredentials(
  env: Env,
  connectionId: string,
  userId: string,
  secretKey: string
): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare(`
    SELECT encrypted_credentials, iv
    FROM connection_user_credentials
    WHERE connection_id = ? AND user_id = ?
  `).bind(connectionId, userId).first<{ encrypted_credentials: string; iv: string }>();

  if (!row) {
    throw new Error('CREDENTIALS_REQUIRED');
  }

  return decryptCredentials(row.encrypted_credentials, row.iv, secretKey);
}

export async function saveUserConnectionCredentials(
  env: Env,
  connectionId: string,
  userId: string,
  data: Record<string, unknown>,
  secretKey: string
): Promise<void> {
  const { encrypted, iv } = await encryptCredentials(data, secretKey);
  await env.DB.prepare(`
    INSERT INTO connection_user_credentials (
      connection_id, user_id, encrypted_credentials, iv, created_at, updated_at
    ) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(connection_id, user_id) DO UPDATE SET
      encrypted_credentials = excluded.encrypted_credentials,
      iv = excluded.iv,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(connectionId, userId, encrypted, iv).run();
}

export async function deleteUserConnectionCredentials(
  env: Env,
  connectionId: string,
  userId: string
): Promise<boolean> {
  const result = await env.DB.prepare(
    'DELETE FROM connection_user_credentials WHERE connection_id = ? AND user_id = ?'
  ).bind(connectionId, userId).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function getUserCredentialMeta(
  env: Env,
  connectionId: string,
  userId: string
): Promise<{ updatedAt: string } | null> {
  return env.DB.prepare(`
    SELECT updated_at AS updatedAt
    FROM connection_user_credentials
    WHERE connection_id = ? AND user_id = ?
  `).bind(connectionId, userId).first<{ updatedAt: string }>();
}

/** Cache partition for per-user connectors — never share cached responses across users. */
export function connectionCacheKey(connectionId: string, userId: string | null, credentialScope: WorkspaceCredentialScope): string {
  if (credentialScope === 'per_user' && userId) {
    return `${connectionId}:${userId}`;
  }
  return connectionId;
}
