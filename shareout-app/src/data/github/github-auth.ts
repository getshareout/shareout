import type { Env } from '../../types';
import { encryptCredentials, decryptCredentials } from '../connections/credentials';

// The artifact's GitHub grant is a `connections` row: scope_type='artifact',
// provider='github'. One row per artifact, so the name is fixed; the GitHub
// identity it belongs to rides in `config`.
const GITHUB_CONNECTION_NAME = 'github';

const GITHUB_OAUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API = 'https://api.github.com';

export interface GitHubUser {
  login: string;
  id: number;
  name?: string;
  email?: string;
}

export interface GitHubTokenInfo {
  token: string;
  username: string;
  userId: number;
}

export function getGitHubAuthUrl(
  env: Env,
  redirectPath: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${env.SHAREOUT_BASE_URL}${redirectPath}`,
    scope: 'repo',
    state,
  });
  return `${GITHUB_OAUTH_URL}?${params}`;
}

export async function exchangeCodeForToken(
  code: string,
  env: Env
): Promise<{ access_token: string; token_type: string; scope: string }> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub token exchange failed: ${error}`);
  }

  const data = await response.json() as {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  if (!data.access_token) {
    throw new Error('No access token received from GitHub');
  }

  return {
    access_token: data.access_token,
    token_type: data.token_type || 'bearer',
    scope: data.scope || '',
  };
}

export async function getGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch(`${GITHUB_API}/user`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'ShareOut/1.0',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get GitHub user: ${error}`);
  }

  const user = await response.json() as GitHubUser;
  return user;
}

function parseConfig(raw: string | null): { github_username: string; github_user_id: number } {
  try {
    const v = JSON.parse(raw || '{}');
    return {
      github_username: (v.github_username as string) || '',
      github_user_id: (v.github_user_id as number) || 0,
    };
  } catch {
    return { github_username: '', github_user_id: 0 };
  }
}

export async function storeArtifactToken(
  env: Env,
  artifactId: string,
  token: string,
  user: GitHubUser
): Promise<void> {
  if (!env.CREDENTIALS_KEY) {
    throw new Error('CREDENTIALS_KEY not configured');
  }

  const { encrypted, iv } = await encryptCredentials(
    { token },
    env.CREDENTIALS_KEY
  );

  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO connections
      (id, scope_type, scope_id, name, kind, provider, auth_type, config,
       encrypted_credentials, iv, created_at, updated_at)
    VALUES (?, 'artifact', ?, ?, 'platform', 'github', 'oauth', ?, ?, ?, ?, ?)
    ON CONFLICT(scope_type, scope_id, name) DO UPDATE SET
      config = excluded.config,
      encrypted_credentials = excluded.encrypted_credentials,
      iv = excluded.iv,
      updated_at = excluded.updated_at
  `).bind(
    `con_github_${artifactId}`,
    artifactId,
    GITHUB_CONNECTION_NAME,
    JSON.stringify({ github_username: user.login, github_user_id: user.id }),
    encrypted,
    iv,
    now,
    now
  ).run();
}

export async function getArtifactToken(
  env: Env,
  artifactId: string
): Promise<GitHubTokenInfo | null> {
  if (!env.CREDENTIALS_KEY) return null;

  const stored = await env.DB.prepare(`
    SELECT encrypted_credentials, iv, config FROM connections
    WHERE scope_type = 'artifact' AND scope_id = ? AND name = ?
  `).bind(artifactId, GITHUB_CONNECTION_NAME).first<{
    encrypted_credentials: string;
    iv: string;
    config: string;
  }>();

  if (!stored?.encrypted_credentials || !stored.iv) return null;

  const decrypted = await decryptCredentials(
    stored.encrypted_credentials,
    stored.iv,
    env.CREDENTIALS_KEY
  );
  const config = parseConfig(stored.config);

  return {
    token: decrypted.token as string,
    username: config.github_username,
    userId: config.github_user_id,
  };
}

export async function getArtifactTokenStatus(
  env: Env,
  artifactId: string
): Promise<{ connected: boolean; username?: string }> {
  const stored = await env.DB.prepare(`
    SELECT config FROM connections
    WHERE scope_type = 'artifact' AND scope_id = ? AND name = ?
  `).bind(artifactId, GITHUB_CONNECTION_NAME).first<{ config: string }>();

  if (!stored) {
    return { connected: false };
  }

  return { connected: true, username: parseConfig(stored.config).github_username };
}

export async function removeArtifactToken(
  env: Env,
  artifactId: string
): Promise<void> {
  await env.DB.prepare(`
    DELETE FROM connections
    WHERE scope_type = 'artifact' AND scope_id = ? AND name = ?
  `).bind(artifactId, GITHUB_CONNECTION_NAME).run();
}
