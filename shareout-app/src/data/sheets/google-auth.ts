import type { Env } from '../../types';
import { encryptCredentials, decryptCredentials } from '../connections/credentials';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export function getGoogleAuthUrl(env: Env, redirectPath: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID || "",
    redirect_uri: `${env.SHAREOUT_BASE_URL}${redirectPath}`,
    response_type: 'code',
    scope: GOOGLE_SHEETS_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectPath: string,
  env: Env
): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID || "",
      client_secret: env.GOOGLE_CLIENT_SECRET || "",
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${env.SHAREOUT_BASE_URL}${redirectPath}`,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

export async function refreshAccessToken(
  refreshToken: string,
  env: Env
): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID || "",
      client_secret: env.GOOGLE_CLIENT_SECRET || "",
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  return response.json();
}

export async function storeUserTokens(
  env: Env,
  userId: string,
  tokens: TokenResponse
): Promise<void> {
  if (!env.CREDENTIALS_KEY) {
    throw new Error('CREDENTIALS_KEY not configured');
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Google only returns refresh_token on the first consent, so carry the stored one
  // forward when this exchange did not include one.
  const existing = tokens.refresh_token ? null : await loadUserTokens(env, userId);

  // One blob for the whole credential: two ciphertexts cannot share one iv, and
  // that is exactly how the refresh token used to become undecryptable.
  const { encrypted, iv } = await encryptCredentials(
    {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || existing?.refresh_token || '',
    },
    env.CREDENTIALS_KEY
  );

  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO google_oauth_tokens (user_id, encrypted_credentials, iv, expires_at, scopes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      encrypted_credentials = excluded.encrypted_credentials,
      iv = excluded.iv,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).bind(
    userId,
    encrypted,
    iv,
    expiresAt,
    tokens.scope,
    now,
    now
  ).run();
}

// Decrypt the stored credential, or null when there is none / it is unreadable
// (a blob written under a previous CREDENTIALS_KEY). Unreadable means reconnect,
// not a 500.
async function loadUserTokens(
  env: Env,
  userId: string
): Promise<{ access_token: string; refresh_token: string; expires_at: string } | null> {
  if (!env.CREDENTIALS_KEY) return null;

  const stored = await env.DB.prepare(`
    SELECT encrypted_credentials, iv, expires_at
    FROM google_oauth_tokens WHERE user_id = ?
  `).bind(userId).first<{
    encrypted_credentials: string;
    iv: string;
    expires_at: string;
  }>();

  if (!stored) return null;

  try {
    const creds = await decryptCredentials(stored.encrypted_credentials, stored.iv, env.CREDENTIALS_KEY);
    return {
      access_token: (creds.access_token as string) || '',
      refresh_token: (creds.refresh_token as string) || '',
      expires_at: stored.expires_at,
    };
  } catch (err) {
    console.warn('google oauth token decrypt failed', JSON.stringify({
      userId,
      message: err instanceof Error ? err.message : String(err),
    }));
    return null;
  }
}

export async function getValidAccessToken(
  env: Env,
  userId: string
): Promise<string | null> {
  const stored = await loadUserTokens(env, userId);
  if (!stored) return null;

  if (new Date(stored.expires_at) > new Date(Date.now() + 60000)) {
    return stored.access_token;
  }

  const refreshToken = stored.refresh_token;
  if (!refreshToken) return null;

  try {
    const newTokens = await refreshAccessToken(refreshToken, env);
    await storeUserTokens(env, userId, newTokens);
    return newTokens.access_token;
  } catch {
    return null;
  }
}

export async function hasGoogleConnection(env: Env, userId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    'SELECT 1 FROM google_oauth_tokens WHERE user_id = ?'
  ).bind(userId).first();
  return !!result;
}

export async function revokeGoogleConnection(env: Env, userId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM google_oauth_tokens WHERE user_id = ?').bind(userId).run();
}
