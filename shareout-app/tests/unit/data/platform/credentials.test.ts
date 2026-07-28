// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConnection,
  deleteConnection,
  getDecryptedCredentials,
  listConnections,
  loadConnection,
  loadConnectionByName,
  prepareCredentialsForRequest,
  saveCredentials,
  verifyProxyToken,
} from '../../../../src/data/platform/core/credentials';
import { googleSheetsProvider } from '../../../../src/data/platform/providers/google-sheets';
import type { Env } from '../../../../src/types';
import {
  ARTIFACT_ID,
  CREDENTIALS_KEY,
  encryptTestCredentials,
  mockPlatformDb,
  publicArtifactEnv,
} from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

const sampleRow = {
  id: 'conn_abc123',
  scope_type: 'artifact',
    scope_id: ARTIFACT_ID,
  name: 'My Sheets',
  provider: 'google-sheets',
  config: JSON.stringify({ spreadsheetId: 'sheet-1' }),
  encrypted_credentials: '',
  iv: '',
  preferred_mode: 'auto',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

async function rowWithCredentials(credentials: {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}) {
  const { encrypted, iv } = await encryptTestCredentials(credentials);
  return { ...sampleRow, encrypted_credentials: encrypted, iv };
}

describe('platform credentials', () => {
  it('loads a connection by id and by name', async () => {
    const row = await rowWithCredentials({ access_token: 'tok_1' });
    const env = publicArtifactEnv({}, {
      first: (sql, bindings) => {
        if (sql.includes("scope_type = 'artifact'") && bindings[1] === 'conn_abc123') {
          return row;
        }
        if (sql.includes('AND name = ?') && bindings[1] === 'My Sheets') {
          return row;
        }
        return null;
      },
    });

    const byId = await loadConnection(env, ARTIFACT_ID, 'conn_abc123');
    expect(byId).toMatchObject({
      id: 'conn_abc123',
      name: 'My Sheets',
      provider: 'google-sheets',
      config: { spreadsheetId: 'sheet-1' },
    });

    const byName = await loadConnectionByName(env, ARTIFACT_ID, 'My Sheets');
    expect(byName.id).toBe('conn_abc123');
  });

  it('throws when a connection is missing', async () => {
    const env = publicArtifactEnv();
    await expect(loadConnection(env, ARTIFACT_ID, 'missing')).rejects.toThrow('Connection not found');
    await expect(loadConnectionByName(env, ARTIFACT_ID, 'missing')).rejects.toThrow('Connection not found');
  });

  it('falls back to a workspace-shared platform connection when no artifact-local match', async () => {
    const { encrypted, iv } = await encryptTestCredentials({ access_token: 'shared-tok' });
    const wsRow = {
      id: 'conn_shared',
      scope_type: 'workspace',
    scope_id: 'wsp_team',
      name: 'Team Shopify',
      provider: 'shopify',
      config: JSON.stringify({ shop: 'acme' }),
      encrypted_credentials: encrypted,
      iv,
      preferred_mode: 'auto',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const prepare = vi.fn((sql: string) => ({
      bind: (..._bindings: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes("scope_type = 'artifact'")) return null;
          if (sql.includes('workspace_id FROM artifacts')) return { workspace_id: 'wsp_team' };
          if (sql.includes("scope_type = 'workspace'")) return wsRow;
          return null;
        }),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => ({ meta: { changes: 1 } })),
      }),
    }));
    const env = { CREDENTIALS_KEY, DB: { prepare } } as unknown as Env;

    const conn = await loadConnection(env, ARTIFACT_ID, 'conn_shared');
    expect(conn).toMatchObject({
      id: 'conn_shared',
      provider: 'shopify',
      config: { shop: 'acme' },
      scope: 'workspace',
      ownerKey: 'wsp_team',
    });
  });

  it('encrypts and decrypts stored credentials', async () => {
    const { encrypted, iv } = await encryptTestCredentials({
      access_token: 'secret-token',
      refresh_token: 'refresh',
      expires_at: Date.now() + 3_600_000,
    });

    const decrypted = await getDecryptedCredentials(encrypted, iv, CREDENTIALS_KEY);
    expect(decrypted).toMatchObject({
      access_token: 'secret-token',
      refresh_token: 'refresh',
    });
  });

  it('saves updated credentials to the artifact-scoped table', async () => {
    const runSpy = vi.fn(async () => ({ meta: { changes: 1 } }));
    const env = publicArtifactEnv({}, {
      run: (sql, bindings) => {
        expect(sql).toContain('UPDATE connections');
        expect(bindings[2]).toBe(ARTIFACT_ID);
        expect(bindings[3]).toBe('conn_abc123');
        return { meta: { changes: 1 } };
      },
    });
    const originalPrepare = env.DB.prepare;
    env.DB.prepare = vi.fn((sql: string) => {
      const stmt = originalPrepare(sql);
      return {
        bind: (...bindings: unknown[]) => ({
          ...stmt.bind(...bindings),
          run: runSpy,
        }),
      };
    }) as Env['DB']['prepare'];

    await saveCredentials(env, { scope: 'artifact', ownerKey: ARTIFACT_ID, connectionId: 'conn_abc123' }, {
      access_token: 'new-token',
      expires_at: Date.now() + 60_000,
    }, CREDENTIALS_KEY);

    expect(runSpy).toHaveBeenCalled();
  });

  it('routes workspace-scoped credential writes to the workspace connection row', async () => {
    let capturedSql = '';
    let capturedBindings: unknown[] = [];
    const env = publicArtifactEnv({}, {
      run: (sql, bindings) => {
        capturedSql = sql;
        capturedBindings = bindings;
        return { meta: { changes: 1 } };
      },
    });

    await saveCredentials(env, { scope: 'workspace', ownerKey: 'wsp_team', connectionId: 'conn_shared' }, {
      access_token: 'refreshed-shared-token',
      expires_at: Date.now() + 60_000,
    }, CREDENTIALS_KEY);

    expect(capturedSql).toContain('UPDATE connections');
    // (encrypted, iv, scope_type, scope_id, id) — one statement for both scopes now.
    expect(capturedBindings[2]).toBe('workspace');
    expect(capturedBindings[3]).toBe('wsp_team');
    expect(capturedBindings[4]).toBe('conn_shared');
  });

  it('creates, lists, and deletes connections', async () => {
    const inserts: unknown[][] = [];
    const env = publicArtifactEnv({}, {
      run: (sql, bindings) => {
        if (sql.includes('INSERT INTO connections')) {
          inserts.push(bindings);
        }
        return { meta: { changes: 1 } };
      },
      all: () => ({
        results: [{
          id: 'conn_listed',
          name: 'Listed',
          provider: 'google-sheets',
          config: '{}',
          preferred_mode: 'auto',
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        }],
      }),
    });

    const id = await createConnection(env, ARTIFACT_ID, {
      name: 'New Connection',
      provider: 'google-sheets',
      config: { spreadsheetId: 'abc' },
      credentials: { access_token: 'tok' },
      preferredMode: 'proxy',
    });

    expect(id).toMatch(/^conn_[a-f0-9]{16}$/);
    expect(inserts[0]?.[2]).toBe('New Connection');
    expect(inserts[0]?.[7]).toBe('proxy');

    const listed = await listConnections(env, ARTIFACT_ID);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: 'conn_listed', name: 'Listed', config: {} });

    await deleteConnection(env, ARTIFACT_ID, 'conn_listed');
    expect(env.DB.prepare).toHaveBeenCalled();
  });

  it('issues and verifies proxy tokens', async () => {
    const env = publicArtifactEnv();
    const row = await rowWithCredentials({ access_token: 'tok' });
    const envWithConn = publicArtifactEnv({}, {
      first: () => row,
    });

    const exchange = await prepareCredentialsForRequest(
      envWithConn,
      ARTIFACT_ID,
      'conn_abc123',
      googleSheetsProvider,
      'proxy',
    );

    expect(exchange.mode).toBe('proxy');
    expect(exchange.proxyToken).toBeTruthy();

    const verified = await verifyProxyToken(env, exchange.proxyToken!);
    expect(verified).toMatchObject({
      artifactId: ARTIFACT_ID,
      connectionId: 'conn_abc123',
      provider: 'google-sheets',
    });
  });

  it('returns null for malformed or expired proxy tokens', async () => {
    const env = publicArtifactEnv();
    expect(await verifyProxyToken(env, 'not-a-token')).toBeNull();
    expect(await verifyProxyToken(env, 'bad.part')).toBeNull();

    const { encryptCredentials } = await import('../../../../src/data/connections/credentials');
    const expired = await encryptCredentials({
      artifactId: ARTIFACT_ID,
      connectionId: 'conn_abc123',
      provider: 'google-sheets',
      issuedAt: Date.now() - 120_000,
      expiresAt: Date.now() - 60_000,
    }, CREDENTIALS_KEY);

    expect(await verifyProxyToken(env, `${expired.encrypted}.${expired.iv}`)).toBeNull();
  });

  it('prepares direct credentials when mode is direct', async () => {
    const row = await rowWithCredentials({
      access_token: 'direct-tok',
      expires_at: Date.now() + 3_600_000,
    });
    const env = publicArtifactEnv({}, { first: () => row });

    const result = await prepareCredentialsForRequest(
      env,
      ARTIFACT_ID,
      'conn_abc123',
      googleSheetsProvider,
      'direct',
    );

    expect(result.mode).toBe('direct');
    expect(result.direct).toMatchObject({
      accessToken: 'direct-tok',
      headerName: 'Authorization',
      authHeader: 'Bearer direct-tok',
      allowedHosts: ['sheets.googleapis.com'],
    });
  });

  it('refreshes expiring credentials during prepare', async () => {
    const row = await rowWithCredentials({
      access_token: 'old',
      refresh_token: 'refresh-me',
      expires_at: Date.now() + 30_000,
    });
    const env = publicArtifactEnv({}, { first: () => row });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'fresh',
      expires_in: 3600,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await prepareCredentialsForRequest(
      env,
      ARTIFACT_ID,
      'conn_abc123',
      googleSheetsProvider,
      'proxy',
    );

    expect(fetchMock).toHaveBeenCalled();
    expect(result.mode).toBe('proxy');
    expect(result.proxyToken).toBeTruthy();
  });
});
