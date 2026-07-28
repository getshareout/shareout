// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleCreateWorkspaceConnection,
  handleGetMyConnectionCredentials,
  handlePutMyConnectionCredentials,
} from '../../../src/router/api/workspace-connections';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';

const CREDENTIALS_KEY = 'test-credentials-key-32bytes!!';
const WORKSPACE_ID = 'wsp_team';
const CONN_ID = 'conn_gql';
const USER: AuthUser = { id: 'usr_member', email: 'm@example.com', username: null };

afterEach(() => vi.restoreAllMocks());

function makeEnv(opts: {
  role?: string | null;
  connection?: { id: string; credential_scope: string; auth_type: string } | null;
  hasUserCreds?: boolean;
}): Env {
  const prepare = vi.fn((sql: string) => ({
    bind: (...bindings: unknown[]) => ({
      first: vi.fn(async () => {
        if (sql.includes('FROM workspace_members')) {
          const role = opts.role ?? 'member';
          return role === null ? null : { role };
        }
        if (sql.includes("scope_type = 'workspace'") && sql.includes('credential_scope = \'per_user\'')) {
          return opts.connection ?? null;
        }
        if (sql.includes('auth_type, credential_scope')) {
          return opts.connection ?? null;
        }
        if (sql.includes('connection_user_credentials WHERE connection_id')) {
          return opts.hasUserCreds ? { 1: 1 } : null;
        }
        if (sql.includes("SELECT id FROM connections") && sql.includes('AND name = ?')) {
          return null;
        }
        if (sql.includes('updated_at AS updatedAt')) {
          return opts.hasUserCreds ? { updatedAt: '2026-06-15T00:00:00Z' } : null;
        }
        return null;
      }),
      all: vi.fn(async () => ({ results: [] })),
      run: vi.fn(async () => ({ meta: { changes: 1 } })),
    }),
  }));
  return { CREDENTIALS_KEY, DB: { prepare } } as unknown as Env;
}

describe('per-user workspace connectors', () => {
  it('creates a per-user generic connector without shared secrets', async () => {
    let inserted: unknown[] | null = null;
    const env = makeEnv({ role: 'admin' });
    (env.DB as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare = vi.fn((sql: string) => ({
      bind: (...bindings: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('FROM workspace_members')) return { role: 'admin' };
          if (sql.includes("SELECT id FROM connections")) return null;
          return null;
        }),
        run: vi.fn(async () => {
          if (sql.includes('INSERT INTO connections')) inserted = bindings;
          return { meta: { changes: 1 } };
        }),
      }),
    })) as unknown as Env['DB']['prepare'];

    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections', {
      method: 'POST',
      body: JSON.stringify({
        name: 'acme_graphql',
        type: 'rest_api',
        credentialScope: 'per_user',
        authType: 'api_key',
        config: { baseUrl: 'https://api.acme.example/graphql' },
      }),
    });
    const res = await handleCreateWorkspaceConnection(req, env, USER, WORKSPACE_ID);
    expect(res.status).toBe(201);
    const body = await res.json() as { credentialScope: string };
    expect(body.credentialScope).toBe('per_user');
    expect(inserted).not.toBeNull();
    expect(inserted!.at(-1)).toBe('per_user');
    expect(JSON.stringify(inserted)).not.toContain('secret-token');
  });

  it('reports whether the member has saved credentials', async () => {
    const env = makeEnv({
      role: 'member',
      connection: { id: CONN_ID, credential_scope: 'per_user', auth_type: 'api_key' },
      hasUserCreds: true,
    });
    const res = await handleGetMyConnectionCredentials(env, USER, WORKSPACE_ID, CONN_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as { configured: boolean; authType: string };
    expect(body).toMatchObject({ configured: true, authType: 'api_key' });
  });

  it('creates a per-user platform connector with authorized_user auth', async () => {
    let inserted: unknown[] | null = null;
    const env = makeEnv({ role: 'admin' });
    (env.DB as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare = vi.fn((sql: string) => ({
      bind: (...bindings: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('FROM workspace_members')) return { role: 'admin' };
          if (sql.includes("SELECT id FROM connections")) return null;
          return null;
        }),
        run: vi.fn(async () => {
          if (sql.includes('INSERT INTO connections')) inserted = bindings;
          return { meta: { changes: 1 } };
        }),
      }),
    })) as unknown as Env['DB']['prepare'];

    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections', {
      method: 'POST',
      body: JSON.stringify({
        name: 'bigquery',
        kind: 'platform',
        provider: 'bigquery',
        credentialScope: 'per_user',
        credentials: { type: 'authorized_user' },
        config: { projectId: 'analytics-platform' },
      }),
    });
    const res = await handleCreateWorkspaceConnection(req, env, USER, WORKSPACE_ID);
    expect(res.status).toBe(201);
    const body = await res.json() as { credentialScope: string };
    expect(body.credentialScope).toBe('per_user');
    expect(inserted).not.toBeNull();
    expect(inserted!.at(-1)).toBe('per_user');
    // auth_type is stored; no shared credential is persisted for per_user.
    expect(inserted).toContain('authorized_user');
  });

  it('stores member authorized_user creds in the platform envelope', async () => {
    let storedBlob = '';
    const env = makeEnv({ role: 'member' });
    (env.DB as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare = vi.fn((sql: string) => ({
      bind: (...bindings: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('FROM workspace_members')) return { role: 'member' };
          if (sql.includes("credential_scope FROM connections")) {
            return { id: CONN_ID, kind: 'platform', credential_scope: 'per_user', auth_type: 'authorized_user' };
          }
          return null;
        }),
        run: vi.fn(async () => {
          if (sql.includes('INSERT INTO connection_user_credentials')) {
            expect(bindings[1]).toBe(USER.id);
            // Encrypted blob — raw refresh token must not be visible.
            storedBlob = JSON.stringify(bindings[2]);
          }
          return { meta: { changes: 1 } };
        }),
      }),
    })) as unknown as Env['DB']['prepare'];

    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections/conn_gql/my-credentials', {
      method: 'PUT',
      body: JSON.stringify({
        credentials: {
          type: 'authorized_user',
          data: { client_id: 'cid.apps.googleusercontent.com', client_secret: 'csec', refresh_token: 'my-refresh-token' },
        },
      }),
    });
    const res = await handlePutMyConnectionCredentials(req, env, USER, WORKSPACE_ID, CONN_ID);
    expect(res.status).toBe(200);
    expect(storedBlob).not.toContain('my-refresh-token');
  });

  it('rejects authorized_user creds missing required fields', async () => {
    const env = makeEnv({ role: 'member' });
    (env.DB as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare = vi.fn((sql: string) => ({
      bind: () => ({
        first: vi.fn(async () => {
          if (sql.includes('FROM workspace_members')) return { role: 'member' };
          if (sql.includes("credential_scope FROM connections")) {
            return { id: CONN_ID, kind: 'platform', credential_scope: 'per_user', auth_type: 'authorized_user' };
          }
          return null;
        }),
        run: vi.fn(async () => ({ meta: { changes: 1 } })),
      }),
    })) as unknown as Env['DB']['prepare'];

    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections/conn_gql/my-credentials', {
      method: 'PUT',
      body: JSON.stringify({ credentials: { type: 'authorized_user', data: { client_id: 'only-id' } } }),
    });
    const res = await handlePutMyConnectionCredentials(req, env, USER, WORKSPACE_ID, CONN_ID);
    expect(res.status).toBe(400);
  });

  it('stores member credentials encrypted', async () => {
    let upserted = false;
    const env = makeEnv({
      role: 'member',
      connection: { id: CONN_ID, credential_scope: 'per_user', auth_type: 'api_key' },
    });
    (env.DB as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare = vi.fn((sql: string) => ({
      bind: (...bindings: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('FROM workspace_members')) return { role: 'member' };
          if (sql.includes("credential_scope FROM connections")) {
            return { id: CONN_ID, credential_scope: 'per_user', auth_type: 'api_key' };
          }
          return null;
        }),
        run: vi.fn(async () => {
          if (sql.includes('INSERT INTO connection_user_credentials')) {
            upserted = true;
            expect(bindings[1]).toBe(USER.id);
            expect(JSON.stringify(bindings[2])).not.toContain('my-personal-token');
          }
          return { meta: { changes: 1 } };
        }),
      }),
    })) as unknown as Env['DB']['prepare'];

    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections/conn_gql/my-credentials', {
      method: 'PUT',
      body: JSON.stringify({
        credentials: { type: 'api_key', data: { apiKey: 'my-personal-token' } },
      }),
    });
    const res = await handlePutMyConnectionCredentials(req, env, USER, WORKSPACE_ID, CONN_ID);
    expect(res.status).toBe(200);
    expect(upserted).toBe(true);
  });
});
