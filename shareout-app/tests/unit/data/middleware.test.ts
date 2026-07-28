// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionToken, createAccessToken } from '../../../src/token';
import type { Env } from '../../../src/types';
import { dataMiddleware } from '../../../src/data/middleware';

function envWithDb(firstForSql: (sql: string) => unknown, extras: Partial<Env> = {}): Env {
  return {
    SESSION_SECRET: 'session-secret',
    DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => firstForSql(sql)),
        })),
      })),
    },
    ...extras,
  } as unknown as Env;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dataMiddleware edge cases', () => {
  it('ignores KV cache write failures after loading from the database', async () => {
    const artifact = {
      id: 'art_1',
      name: 'Artifact',
      visibility: 'public',
      auth_method: null,
    };
    const env = envWithDb(
      (sql) => (sql.includes('FROM artifacts WHERE id') ? artifact : null),
      {
        SLUGS: {
          get: vi.fn(async () => null),
          put: vi.fn(async () => {
            throw new Error('kv write failed');
          }),
        } as unknown as Env['SLUGS'],
      }
    );

    const result = await dataMiddleware(new Request('https://example.com'), env, 'art_1');

    expect(result).toMatchObject({ artifactId: 'art_1' });
    expect(env.SLUGS?.put).toHaveBeenCalled();
  });

  it('rejects google auth when the session user is not a collaborator', async () => {
    const env = envWithDb((sql) => {
      if (sql.includes('FROM artifacts WHERE id')) {
        return {
          id: 'art_1',
          name: 'Artifact',
          visibility: 'private',
          auth_method: 'google',
        };
      }
      if (sql.includes('FROM collaborators')) {
        return null;
      }
      return null;
    });
    const session = await createSessionToken('usr_1', 'stranger@example.com', env);
    const request = new Request('https://example.com', {
      headers: { Cookie: `shareout_session=${session}` },
    });

    const response = await dataMiddleware(request, env, 'art_1') as Response;

    expect(response.status).toBe(401);
  });
});

describe('dataMiddleware external-sharing token gate (work/030 Phase 3)', () => {
  const ARTIFACT = {
    id: 'art_x', name: 'A', visibility: 'private', auth_method: null,
    workspace_id: 'wsp', owner_id: 'usr_other', access_policy: null,
    allow_anon_write: 0, allow_anon_email: 0, allow_anon_agent: 0, allow_anon_collab: 0,
  };
  const TOKEN_ROW = {
    token_id: 't1', principal_user_id: 'usr_ext', workspace_id: 'wsp',
    scopes: 'data:read,data:write', subject_external_user_id: 'usr_ext',
    email: 'ext@x.com', username: null,
  };

  function extEnv(grantRows: Array<{ resource_type: string; resource_id: string; capability: string }>): Env {
    return {
      SESSION_SECRET: 'secret',
      SLUGS: { get: vi.fn(async () => null), put: vi.fn(async () => {}) } as unknown as Env['SLUGS'],
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn(() => ({
            first: vi.fn(async () => {
              if (sql.includes('FROM artifacts WHERE id')) return ARTIFACT;
              if (sql.includes("principal_type = 'workspace'")) return TOKEN_ROW;
              if (sql.includes('SELECT workspace_id FROM artifacts')) return { workspace_id: 'wsp' };
              return null; // collaborators, etc.
            }),
            all: vi.fn(async () => {
              if (sql.includes('FROM grants')) return { results: grantRows };
              return { results: [] }; // sharee_members, chain
            }),
            run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
          })),
        })),
      },
    } as unknown as Env;
  }

  const tokenReq = () => new Request('https://example.com', { headers: { Authorization: 'Bearer sot_external' } });

  it('denies an external token on a NON-granted artifact', async () => {
    const res = await dataMiddleware(tokenReq(), extEnv([]), 'art_x') as Response;
    expect(res.status).toBe(403);
  });

  it('authorizes read for an external token WITH a view grant, but stays read-only', async () => {
    const ctx = await dataMiddleware(tokenReq(), extEnv([
      { resource_type: 'artifact', resource_id: 'art_x', capability: 'view' },
    ]), 'art_x');
    expect(ctx).toMatchObject({ artifactId: 'art_x' });
    expect((ctx as { canWrite: boolean }).canWrite).toBe(false); // view grant ⊉ write
  });

  it('grants write to an external token with an edit grant (and data:write scope)', async () => {
    const ctx = await dataMiddleware(tokenReq(), extEnv([
      { resource_type: 'artifact', resource_id: 'art_x', capability: 'edit' },
    ]), 'art_x');
    expect((ctx as { canWrite: boolean }).canWrite).toBe(true);
  });
});

describe('dataMiddleware resolves user id from the signed token (no users lookup)', () => {
  function capturingEnv(firstForSql: (sql: string) => unknown) {
    const calls: { sql: string; args: unknown[] }[] = [];
    const env = {
      SESSION_SECRET: 'session-secret',
      SLUGS: { get: vi.fn(async () => null), put: vi.fn(async () => {}) } as unknown as Env['SLUGS'],
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn((...args: unknown[]) => {
            calls.push({ sql, args });
            return { first: vi.fn(async () => firstForSql(sql)) };
          }),
        })),
      },
    } as unknown as Env;
    return { env, calls };
  }

  it('authorizes the owner from the session token without reading the users table', async () => {
    const artifact = { id: 'art_1', name: 'Artifact', visibility: 'private', auth_method: 'google', owner_id: 'usr_1' };
    const { env, calls } = capturingEnv((sql) => (sql.includes('FROM artifacts WHERE id') ? artifact : null));
    const session = await createSessionToken('usr_1', 'owner@example.com', env);
    const request = new Request('https://example.com', { headers: { Cookie: `shareout_session=${session}` } });

    const result = await dataMiddleware(request, env, 'art_1');

    expect(result).toMatchObject({ artifactId: 'art_1', isOwner: true });
    expect(calls.some((c) => c.sql.includes('FROM users'))).toBe(false);
  });

  it('authorizes a workspace member via getWorkspaceRole(userId) without a users lookup', async () => {
    const artifact = {
      id: 'art_1', name: 'Artifact', visibility: 'workspace', auth_method: 'google',
      owner_id: 'usr_owner', workspace_id: 'wsp_1',
    };
    const { env, calls } = capturingEnv((sql) => {
      if (sql.includes('FROM artifacts WHERE id')) return artifact;
      if (sql.includes('FROM collaborators')) return null;
      if (sql.includes('FROM workspace_members')) return { role: 'member' };
      return null;
    });
    const session = await createSessionToken('usr_2', 'member@example.com', env);
    const request = new Request('https://example.com', { headers: { Cookie: `shareout_session=${session}` } });

    const result = await dataMiddleware(request, env, 'art_1');

    expect(result).toMatchObject({ artifactId: 'art_1' });
    expect(calls.some((c) => c.sql.includes('FROM users'))).toBe(false);
    const wmCall = calls.find((c) => c.sql.includes('FROM workspace_members'));
    expect(wmCall?.args).toEqual(['wsp_1', 'usr_2']);
  });
});

describe('dataMiddleware capability-token isolation (ADR 30)', () => {
  const privateArtifact = { id: 'art_1', name: 'Artifact', visibility: 'private', auth_method: 'google' };
  const dbFor = (sql: string) => (sql.includes('FROM artifacts WHERE id') ? privateArtifact : null);

  it('rejects a "content" capability token as a data-API credential', async () => {
    const env = envWithDb(dbFor);
    const ct = await createAccessToken('art_1', 'content', env, 600);
    const request = new Request('https://example.com', { headers: { Authorization: `Bearer ${ct}` } });

    const response = await dataMiddleware(request, env, 'art_1') as Response;

    expect(response.status).toBe(401);
  });

  it('still authorizes a genuine viewer Bearer token (guard is specific to "content")', async () => {
    const env = envWithDb(dbFor);
    const viewerToken = await createAccessToken('art_1', 'viewer', env, 600, 'viewer@example.com');
    const request = new Request('https://example.com', { headers: { Authorization: `Bearer ${viewerToken}` } });

    const result = await dataMiddleware(request, env, 'art_1');

    expect(result).toMatchObject({ artifactId: 'art_1' });
  });
});

describe('dataMiddleware test-run sandbox (Unit B)', () => {
  const ownedArtifact = { id: 'art_1', name: 'Artifact', visibility: 'private', auth_method: 'google', owner_id: 'usr_1' };
  const dbFor = (sql: string) => (sql.includes('FROM artifacts WHERE id') ? ownedArtifact : null);

  it('an owner_test token reads as the owner but is read-only (testRun, canWrite=false)', async () => {
    const env = envWithDb(dbFor);
    const token = await createAccessToken('art_1', 'owner_test', env, 600, 'owner@example.com');
    const request = new Request('https://example.com', { headers: { Authorization: `Bearer ${token}` } });

    const result = await dataMiddleware(request, env, 'art_1');

    expect(result).toMatchObject({
      artifactId: 'art_1',
      isOwner: true,        // reads resolve as the owner so the artifact loads
      testRun: true,
      canWrite: false,      // ...but every mutation is denied
      canWriteCollab: false,
    });
  });

  it('a normal owner token is NOT a test run and can write', async () => {
    const env = envWithDb(dbFor);
    const token = await createAccessToken('art_1', 'owner', env, 600, 'owner@example.com');
    const request = new Request('https://example.com', { headers: { Authorization: `Bearer ${token}` } });

    const result = await dataMiddleware(request, env, 'art_1');

    expect(result).toMatchObject({ isOwner: true, testRun: false, canWrite: true });
  });
});
