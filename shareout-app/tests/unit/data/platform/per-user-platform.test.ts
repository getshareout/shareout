// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { loadConnection, getDecryptedCredentials, saveCredentials } from '../../../../src/data/platform/core/credentials';
import type { Env } from '../../../../src/types';
import { ARTIFACT_ID, CREDENTIALS_KEY, encryptTestCredentials } from './helpers';

// A per_user workspace platform connection: the shared blob is empty; each member's
// credentials live in connection_user_credentials keyed by user id.
async function perUserEnv(userCreds: Record<string, { access_token: string }>): Promise<{
  env: Env;
  runs: { sql: string; bindings: unknown[] }[];
}> {
  const wsRow = {
    id: 'conn_pu',
    scope_type: 'workspace',
    scope_id: 'wsp_team',
    name: 'Private BigQuery',
    provider: 'bigquery',
    config: JSON.stringify({ projectId: 'proj' }),
    encrypted_credentials: '',
    iv: '',
    preferred_mode: 'auto',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    credential_scope: 'per_user',
  };

  // Pre-encrypt each user's blob.
  const blobs: Record<string, { encrypted_credentials: string; iv: string }> = {};
  for (const [uid, creds] of Object.entries(userCreds)) {
    const { encrypted, iv } = await encryptTestCredentials(creds);
    blobs[uid] = { encrypted_credentials: encrypted, iv };
  }

  const runs: { sql: string; bindings: unknown[] }[] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...bindings: unknown[]) => ({
      first: vi.fn(async () => {
        if (sql.includes("scope_type = 'artifact'")) return null;
        if (sql.includes('workspace_id FROM artifacts')) return { workspace_id: 'wsp_team' };
        if (sql.includes("scope_type = 'workspace'")) return wsRow;
        if (sql.includes('FROM connection_user_credentials')) {
          const userId = bindings[1] as string;
          return blobs[userId] ?? null;
        }
        return null;
      }),
      all: vi.fn(async () => ({ results: [] })),
      run: vi.fn(async () => {
        runs.push({ sql, bindings });
        return { meta: { changes: 1 } };
      }),
    }),
  }));

  return { env: { CREDENTIALS_KEY, DB: { prepare } } as unknown as Env, runs };
}

describe('per-user platform connections', () => {
  it('resolves the requesting user\'s own credentials', async () => {
    const { env } = await perUserEnv({
      userA: { access_token: 'A-token' },
      userB: { access_token: 'B-token' },
    });

    const connA = await loadConnection(env, ARTIFACT_ID, 'conn_pu', 'userA');
    expect(connA.credentialScope).toBe('per_user');
    expect(connA.requesterUserId).toBe('userA');
    const credsA = await getDecryptedCredentials(connA.encryptedCredentials, connA.iv, CREDENTIALS_KEY);
    expect(credsA.access_token).toBe('A-token');
  });

  it('never serves one user\'s credentials to another', async () => {
    const { env } = await perUserEnv({
      userA: { access_token: 'A-token' },
      userB: { access_token: 'B-token' },
    });

    const connB = await loadConnection(env, ARTIFACT_ID, 'conn_pu', 'userB');
    const credsB = await getDecryptedCredentials(connB.encryptedCredentials, connB.iv, CREDENTIALS_KEY);
    expect(credsB.access_token).toBe('B-token');
    expect(credsB.access_token).not.toBe('A-token');
  });

  it('throws CREDENTIALS_REQUIRED when the user has no stored credentials', async () => {
    const { env } = await perUserEnv({ userA: { access_token: 'A-token' } });
    await expect(loadConnection(env, ARTIFACT_ID, 'conn_pu', 'userNoCreds')).rejects.toThrow('CREDENTIALS_REQUIRED');
  });

  it('throws CREDENTIALS_REQUIRED when no user is resolved', async () => {
    const { env } = await perUserEnv({ userA: { access_token: 'A-token' } });
    await expect(loadConnection(env, ARTIFACT_ID, 'conn_pu', null)).rejects.toThrow('CREDENTIALS_REQUIRED');
  });

  it('writes refreshed per-user credentials back to the user row, not the shared blob', async () => {
    const { env, runs } = await perUserEnv({ userA: { access_token: 'A-token' } });
    await saveCredentials(
      env,
      { scope: 'workspace', ownerKey: 'wsp_team', connectionId: 'conn_pu', credentialScope: 'per_user', requesterUserId: 'userA' },
      { access_token: 'refreshed', expires_at: Date.now() + 60_000 },
      CREDENTIALS_KEY,
    );
    const write = runs.find((r) => r.sql.includes('connection_user_credentials'));
    expect(write).toBeTruthy();
    expect(write!.sql).toContain('UPDATE connection_user_credentials');
    expect(write!.bindings[2]).toBe('conn_pu');
    expect(write!.bindings[3]).toBe('userA');
    // It must NOT touch the shared connection blob.
    expect(runs.some((r) => r.sql.includes("UPDATE connections"))).toBe(false);
  });
});
