/**
 * Stored file consents: one per (workspace, member, provider), tokens encrypted with
 * the same AES-GCM helper the data connectors use (CREDENTIALS_KEY). Nothing here ever
 * returns a token to a client — routes only see `ConnectionSummary`.
 */
import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { decryptCredentials, encryptCredentials } from '../data/connections/credentials';
import type { FileImportProvider } from './types';
import { OAuthGrantError, refreshTokens, revokeAtProvider, type TokenSet } from './oauth';
import { AuthExpiredError } from './http';

export interface ConnectionRow {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: FileImportProvider;
  account_email: string | null;
  scopes: string | null;
  encrypted_credentials: string;
  iv: string;
  expires_at: string | null;
  created_at: string;
}

export interface ConnectionSummary {
  id: string;
  provider: FileImportProvider;
  accountEmail: string | null;
  connectedAt: string;
}

const REFRESH_SKEW_MS = 60_000;

export async function saveConnection(
  env: Env, workspaceId: string, userId: string, provider: FileImportProvider, tokens: TokenSet, email: string | null,
): Promise<string> {
  if (!env.CREDENTIALS_KEY) throw new Error('CREDENTIALS_KEY not configured');
  const existing = await env.DB.prepare(
    'SELECT id, encrypted_credentials, iv FROM file_import_connections WHERE workspace_id = ? AND user_id = ? AND provider = ?',
  ).bind(workspaceId, userId, provider).first<{ id: string; encrypted_credentials: string; iv: string }>();
  // A re-consent may come back without a refresh token; keep the one we had.
  let refresh = tokens.refreshToken;
  if (!refresh && existing) {
    const old = await decryptCredentials(existing.encrypted_credentials, existing.iv, env.CREDENTIALS_KEY).catch(() => null);
    refresh = (old?.refresh_token as string) || '';
  }
  const { encrypted, iv } = await encryptCredentials({ access_token: tokens.accessToken, refresh_token: refresh }, env.CREDENTIALS_KEY);
  const now = new Date().toISOString();
  const id = existing?.id || generateId('fic');
  await env.DB.prepare(`
    INSERT INTO file_import_connections (id, workspace_id, user_id, provider, account_email, scopes, encrypted_credentials, iv, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, user_id, provider) DO UPDATE SET
      account_email = COALESCE(excluded.account_email, account_email), scopes = excluded.scopes,
      encrypted_credentials = excluded.encrypted_credentials, iv = excluded.iv,
      expires_at = excluded.expires_at, updated_at = excluded.updated_at
  `).bind(id, workspaceId, userId, provider, email, tokens.scope, encrypted, iv, tokens.expiresAt, now, now).run();
  return id;
}

export async function getConnection(env: Env, id: string): Promise<ConnectionRow | null> {
  return env.DB.prepare('SELECT * FROM file_import_connections WHERE id = ?').bind(id).first<ConnectionRow>();
}

export async function findConnection(env: Env, workspaceId: string, userId: string, provider: FileImportProvider): Promise<ConnectionRow | null> {
  return env.DB.prepare('SELECT * FROM file_import_connections WHERE workspace_id = ? AND user_id = ? AND provider = ?')
    .bind(workspaceId, userId, provider).first<ConnectionRow>();
}

export async function listConnections(env: Env, workspaceId: string, userId: string): Promise<ConnectionSummary[]> {
  const rows = await env.DB.prepare(
    'SELECT id, provider, account_email, created_at FROM file_import_connections WHERE workspace_id = ? AND user_id = ?',
  ).bind(workspaceId, userId).all<{ id: string; provider: FileImportProvider; account_email: string | null; created_at: string }>();
  return (rows.results || []).map((r) => ({ id: r.id, provider: r.provider, accountEmail: r.account_email, connectedAt: r.created_at }));
}

/** A usable access token, refreshed when it is about to expire. Throws AuthExpiredError
 *  when the consent can no longer be used (revoked, undecryptable, refresh refused). */
export async function accessTokenFor(env: Env, conn: ConnectionRow, force = false): Promise<string> {
  if (!env.CREDENTIALS_KEY) throw new AuthExpiredError();
  const creds = await decryptCredentials(conn.encrypted_credentials, conn.iv, env.CREDENTIALS_KEY).catch(() => null);
  if (!creds) throw new AuthExpiredError();
  const access = (creds.access_token as string) || '';
  const refresh = (creds.refresh_token as string) || '';
  const fresh = conn.expires_at && Date.parse(conn.expires_at) > Date.now() + REFRESH_SKEW_MS;
  if (access && fresh && !force) return access;
  if (!refresh) throw new AuthExpiredError();
  let next: TokenSet;
  try {
    next = await refreshTokens(env, conn.provider, refresh);
  } catch (e) {
    if (e instanceof OAuthGrantError && e.code === 'INVALID_GRANT') throw new AuthExpiredError();
    throw e;
  }
  const { encrypted, iv } = await encryptCredentials({ access_token: next.accessToken, refresh_token: next.refreshToken }, env.CREDENTIALS_KEY);
  await env.DB.prepare(
    "UPDATE file_import_connections SET encrypted_credentials = ?, iv = ?, expires_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
  ).bind(encrypted, iv, next.expiresAt, conn.id).run();
  conn.encrypted_credentials = encrypted;
  conn.iv = iv;
  conn.expires_at = next.expiresAt;
  return next.accessToken;
}

/**
 * Forget a consent. Sources that read through it lose their connection (FK SET NULL)
 * and their daily sync, and any run in flight is stopped, so revoking really stops sync.
 */
export async function deleteConnection(env: Env, conn: ConnectionRow): Promise<void> {
  if (env.CREDENTIALS_KEY) {
    const creds = await decryptCredentials(conn.encrypted_credentials, conn.iv, env.CREDENTIALS_KEY).catch(() => null);
    await revokeAtProvider(conn.provider, (creds?.refresh_token as string) || (creds?.access_token as string) || '');
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE file_import_runs SET status = 'stopped', stop_code = 'CONNECTION_REVOKED',
        stop_message = 'The drive was disconnected.', finished_at = ?, updated_at = ?
      WHERE status IN ('queued', 'walking', 'importing')
        AND source_id IN (SELECT id FROM file_import_sources WHERE connection_id = ?)
    `).bind(now, now, conn.id),
    env.DB.prepare('UPDATE file_import_sources SET daily_sync_enabled = 0, connection_id = NULL, updated_at = ? WHERE connection_id = ?')
      .bind(now, conn.id),
    env.DB.prepare('DELETE FROM file_import_connections WHERE id = ?').bind(conn.id),
  ]);
}
