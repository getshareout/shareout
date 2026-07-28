import type { Env } from '../../types';

// The artifact's Google Sheets OAuth grant is a `connections` row:
// scope_type='artifact', provider='google_sheets', kind='platform'. One row per
// artifact, so the name is fixed.
const SHEETS_CONNECTION_NAME = 'google_sheets';

export async function storeArtifactTokens(
  env: Env,
  artifactId: string,
  tokens: { access_token: string; refresh_token?: string; expires_in: number }
): Promise<void> {
  if (!env.CREDENTIALS_KEY) {
    throw new Error('CREDENTIALS_KEY not configured');
  }

  const { encryptCredentials } = await import('../connections/credentials');

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // A refresh grant only returns refresh_token the first time, so keep the stored
  // one when this exchange did not carry a new one.
  const existing = tokens.refresh_token ? null : await loadTokens(env, artifactId);

  // One blob for the whole credential. Two ciphertexts cannot share one iv.
  const { encrypted, iv } = await encryptCredentials(
    {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || existing?.refresh_token || '',
    },
    env.CREDENTIALS_KEY
  );

  await env.DB.prepare(`
    INSERT INTO connections (id, scope_type, scope_id, name, kind, provider, auth_type,
                             encrypted_credentials, iv, expires_at)
    VALUES (?, 'artifact', ?, ?, 'platform', 'google_sheets', 'oauth', ?, ?, ?)
    ON CONFLICT(scope_type, scope_id, name) DO UPDATE SET
      encrypted_credentials = excluded.encrypted_credentials,
      iv = excluded.iv,
      expires_at = excluded.expires_at,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(
    `con_sheets_${artifactId}`, artifactId, SHEETS_CONNECTION_NAME, encrypted, iv, expiresAt,
  ).run();
}

export async function hasArtifactTokens(env: Env, artifactId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    "SELECT 1 FROM connections WHERE scope_type = 'artifact' AND scope_id = ? AND name = ?"
  ).bind(artifactId, SHEETS_CONNECTION_NAME).first();
  return !!result;
}

// Decrypt the stored credential. A blob encrypted under a previous CREDENTIALS_KEY
// (or a corrupt row) makes decryptCredentials throw. That is unrecoverable without
// re-connecting, so treat it as "no usable token" (caller returns a clean reconnect
// 401) rather than letting it bubble up as an unhandled 500 / 5xx alert.
async function loadTokens(
  env: Env,
  artifactId: string
): Promise<{ access_token: string; refresh_token: string; expires_at: string } | null> {
  if (!env.CREDENTIALS_KEY) return null;

  const stored = await env.DB.prepare(`
    SELECT encrypted_credentials, iv, expires_at FROM connections
    WHERE scope_type = 'artifact' AND scope_id = ? AND name = ?
  `).bind(artifactId, SHEETS_CONNECTION_NAME).first<{
    encrypted_credentials: string;
    iv: string;
    expires_at: string;
  }>();

  if (!stored?.encrypted_credentials || !stored.iv) return null;

  const { decryptCredentials } = await import('../connections/credentials');
  try {
    const creds = await decryptCredentials(stored.encrypted_credentials, stored.iv, env.CREDENTIALS_KEY);
    return {
      access_token: (creds.access_token as string) || '',
      refresh_token: (creds.refresh_token as string) || '',
      expires_at: stored.expires_at,
    };
  } catch (err) {
    console.warn('artifact sheets token decrypt failed', JSON.stringify({
      artifactId,
      message: err instanceof Error ? err.message : String(err),
    }));
    return null;
  }
}

export async function getArtifactAccessToken(env: Env, artifactId: string): Promise<string | null> {
  const stored = await loadTokens(env, artifactId);
  if (!stored) return null;

  if (new Date(stored.expires_at) > new Date(Date.now() + 60000)) {
    return stored.access_token;
  }

  if (!stored.refresh_token) return null;

  const { refreshAccessToken } = await import('./google-auth');
  try {
    const newTokens = await refreshAccessToken(stored.refresh_token, env);
    await storeArtifactTokens(env, artifactId, newTokens);
    return newTokens.access_token;
  } catch {
    return null;
  }
}
