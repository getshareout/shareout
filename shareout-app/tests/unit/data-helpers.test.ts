// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAccessToken,
  createSessionToken,
} from '../../src/token';
import type { Env } from '../../src/types';
import {
  corsHeaders,
  dataMiddleware,
  errorResponse,
  handleCorsOptions,
  setRequestOrigin,
  successResponse,
  verifyOwner,
} from '../../src/data/middleware';
import {
  checkRateLimit,
  cleanupStaleLimits,
  getRateLimitInfo,
  resetRateLimit,
} from '../../src/data/connections/rate-limiter';
import {
  decryptCredentials,
  encryptCredentials,
} from '../../src/data/connections/credentials';

function envWithFirst<T>(firstResult: T, extras: Partial<Env> = {}): Env {
  return {
    SESSION_SECRET: 'session-secret',
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => firstResult),
        })),
      })),
    },
    ...extras,
  } as unknown as Env;
}

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
  vi.useRealTimers();
  resetRateLimit('conn_1');
  resetRateLimit('stale_conn');
});

describe('data response helpers', () => {
  it('builds successful and failed JSON responses with CORS headers', async () => {
    const ok = successResponse({ saved: true }, 201);
    const error = errorResponse({ code: 'NOPE', message: 'Nope', status: 418 });

    await expect(ok.json()).resolves.toEqual({ success: true, data: { saved: true } });
    expect(ok.status).toBe(201);
    // No Origin on the request ⇒ not a CORS request ⇒ nothing to allow. This used to
    // assert a hardcoded shareout.site, which was wrong on every other instance.
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBeNull();

    await expect(error.json()).resolves.toEqual({
      success: false,
      error: 'Nope',
      code: 'NOPE',
    });
    expect(error.status).toBe(418);
    expect(corsHeaders()).toHaveProperty('Access-Control-Allow-Methods');
    expect(handleCorsOptions(new Request('https://shareout.site')).status).toBe(204);
  });

  it('reflects null origins for credentialed data preflights', () => {
    const response = handleCorsOptions(new Request('https://shareout.site/v1/data/art/json/key', {
      method: 'OPTIONS',
      headers: { Origin: 'null' },
    }));

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('reflects explicit and stored origins in CORS headers', () => {
    setRequestOrigin('https://app.example.com');
    expect(corsHeaders()).toMatchObject({
      'Access-Control-Allow-Origin': 'https://app.example.com',
    });
    expect(corsHeaders('https://other.example.com')).toMatchObject({
      'Access-Control-Allow-Origin': 'https://other.example.com',
    });
    setRequestOrigin(null);
    expect(corsHeaders()).not.toHaveProperty('Access-Control-Allow-Origin');
    expect(corsHeaders()).toMatchObject({
    });
  });

  it('includes optional error metadata in failed responses', async () => {
    const response = errorResponse({
      code: 'VALIDATION',
      message: 'Bad field',
      status: 422,
      hint: 'Fix it',
      suggestion: 'Try again',
      param: 'name',
      docs: 'https://docs.example.com',
    }, 'https://client.example.com');

    await expect(response.json()).resolves.toMatchObject({
      success: false,
      hint: 'Fix it',
      suggestion: 'Try again',
      param: 'name',
      docs: 'https://docs.example.com',
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://client.example.com');
  });

  it('applies origin headers on success responses', () => {
    const response = successResponse({ ok: true }, 200, 'https://client.example.com');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://client.example.com');
  });
});

describe('dataMiddleware', () => {
  it('returns context for public artifacts', async () => {
    const artifact = {
      id: 'art_1',
      name: 'Artifact',
      visibility: 'public',
      auth_method: null,
    };
    const env = envWithFirst(artifact);

    const result = await dataMiddleware(new Request('https://example.com'), env, 'art_1');

    expect(result).toMatchObject({ artifactId: 'art_1', artifact });
  });

  it('returns a not-found response when the artifact does not exist', async () => {
    const response = await dataMiddleware(
      new Request('https://example.com'),
      envWithFirst(null),
      'missing'
    ) as Response;

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'ARTIFACT_NOT_FOUND',
    });
  });

  it('requires auth for private artifacts without credentials', async () => {
    const response = await dataMiddleware(
      new Request('https://example.com'),
      envWithFirst({
        id: 'art_1',
        name: 'Artifact',
        visibility: 'private',
        auth_method: 'password',
      }),
      'art_1'
    ) as Response;

    expect(response.status).toBe(401);
  });

  it('ignores KV cache read failures and loads from the database', async () => {
    const artifact = {
      id: 'art_1',
      name: 'Artifact',
      visibility: 'public',
      auth_method: null,
    };
    const env = envWithFirst(artifact, {
      SLUGS: {
        get: vi.fn(async () => {
          throw new Error('kv unavailable');
        }),
        put: vi.fn(),
      } as unknown as Env['SLUGS'],
    });

    const result = await dataMiddleware(new Request('https://example.com'), env, 'art_1');

    expect(result).toMatchObject({ artifactId: 'art_1' });
  });

  it('resolves artifacts from KV cache without hitting the database', async () => {
    const cached = {
      id: 'art_cached',
      name: 'Cached',
      visibility: 'public',
      auth_method: null,
    };
    const prepare = vi.fn();
    const env = envWithFirst(null, {
      SLUGS: {
        get: vi.fn(async () => cached),
        put: vi.fn(),
      } as unknown as Env['SLUGS'],
      DB: { prepare },
    });

    const result = await dataMiddleware(new Request('https://example.com'), env, 'my-slug');

    expect(result).toMatchObject({ artifactId: 'art_cached', artifact: cached });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('falls back to production slug lookup and caches the artifact', async () => {
    const artifact = {
      id: 'art_slug',
      name: 'Slug artifact',
      visibility: 'public',
      auth_method: null,
    };
    const put = vi.fn(async () => undefined);
    const env = envWithDb((sql) => {
      if (sql.includes('FROM artifacts WHERE id')) return null;
      if (sql.includes('FROM deployments d')) return artifact;
      return null;
    }, {
      SLUGS: {
        get: vi.fn(async () => null),
        put,
      } as unknown as Env['SLUGS'],
    });

    const result = await dataMiddleware(new Request('https://example.com'), env, 'my-slug');

    expect(result).toMatchObject({ artifactId: 'art_slug' });
    expect(put).toHaveBeenCalledWith(
      'artv2:my-slug',
      JSON.stringify(artifact),
      expect.objectContaining({ expirationTtl: 300 })
    );
  });

  it('allows private artifacts with a valid bearer access token', async () => {
    const env = envWithFirst({
      id: 'art_1',
      name: 'Artifact',
      visibility: 'private',
      auth_method: 'password',
    });
    const token = await createAccessToken('art_1', 'password', env);
    const request = new Request('https://example.com', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const result = await dataMiddleware(request, env, 'art_1');

    expect(result).toMatchObject({ artifactId: 'art_1' });
  });

  it('rejects invalid bearer tokens for private artifacts', async () => {
    const env = envWithFirst({
      id: 'art_1',
      name: 'Artifact',
      visibility: 'private',
      auth_method: 'password',
    });
    const response = await dataMiddleware(
      new Request('https://example.com', {
        headers: { Authorization: 'Bearer not.valid.token' },
      }),
      env,
      'art_1'
    ) as Response;

    expect(response.status).toBe(401);
  });

  it('accepts password artifacts authenticated via access cookies', async () => {
    const env = envWithFirst({
      id: 'art_1',
      name: 'Artifact',
      visibility: 'private',
      auth_method: 'credentials',
    });
    const token = await createAccessToken('art_1', 'credentials', env);
    const request = new Request('https://example.com', {
      headers: { Cookie: `shareout_access_art_1=${token}` },
    });

    const result = await dataMiddleware(request, env, 'art_1');

    expect(result).toMatchObject({ artifactId: 'art_1' });
  });

  it('accepts google artifacts with a collaborator session', async () => {
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
        return { id: 'collab_1' };
      }
      return null;
    });
    const session = await createSessionToken('usr_1', 'collab@example.com', env);
    const request = new Request('https://example.com', {
      headers: { Cookie: `shareout_session=${session}` },
    });

    const result = await dataMiddleware(request, env, 'art_1');

    expect(result).toMatchObject({ artifactId: 'art_1' });
  });
});

describe('verifyOwner', () => {
  const artifactWithOwner = (owner_id: string | null) => ({
    id: 'art_1',
    name: 'Artifact',
    visibility: 'private',
    auth_method: null,
    workspace_id: null,
    owner_id,
  });
  const ctxBase = {
    artifactId: 'art_1',
    artifact: artifactWithOwner('usr_1'),
    origin: null,
  };

  it('reads owner_id from ctx.artifact without re-querying artifacts', async () => {
    const env = envWithFirst(null);
    const token = await createAccessToken('art_1', 'owner', env);
    const request = new Request('https://example.com', {
      headers: { Authorization: `Bearer ${token}` },
    });

    await verifyOwner(request, { ...ctxBase, env });

    const prepared = (env.DB.prepare as ReturnType<typeof vi.fn>).mock.calls
      .map(([sql]) => sql as string);
    expect(prepared.some((sql) => /SELECT owner_id FROM artifacts/i.test(sql))).toBe(false);
  });

  it('accepts owner access tokens', async () => {
    const env = envWithFirst(null);
    const token = await createAccessToken('art_1', 'owner', env);
    const request = new Request('https://example.com', {
      headers: { Authorization: `Bearer ${token}` },
    });

    await expect(verifyOwner(request, { ...ctxBase, env })).resolves.toBe(true);
  });

  it('rejects missing owners, non-owner tokens, and unknown sessions', async () => {
    const env = envWithFirst(null);
    const viewerToken = await createAccessToken('art_1', 'password', env);

    await expect(verifyOwner(new Request('https://example.com'), {
      ...ctxBase,
      artifact: artifactWithOwner(null),
      env,
    })).resolves.toBe(false);

    await expect(verifyOwner(
      new Request('https://example.com', {
        headers: { Authorization: `Bearer ${viewerToken}` },
      }),
      { ...ctxBase, env }
    )).resolves.toBe(false);

    const session = await createSessionToken('usr_2', 'other@example.com', env);
    await expect(verifyOwner(
      new Request('https://example.com', {
        headers: { Cookie: `shareout_session=${session}` },
      }),
      { ...ctxBase, env: envWithFirst(null) }
    )).resolves.toBe(false);
  });

  it('accepts owner sessions when the user email matches', async () => {
    const env = envWithDb((sql) => {
      if (sql.includes('FROM users WHERE id')) return { id: 'usr_1' };
      return null;
    });
    const session = await createSessionToken('usr_1', 'owner@example.com', env);
    const request = new Request('https://example.com', {
      headers: { Cookie: `shareout_session=${session}` },
    });

    await expect(verifyOwner(request, { ...ctxBase, env })).resolves.toBe(true);
  });
});

describe('connection rate limiter', () => {
  it('tracks remaining requests and resets after the window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    await expect(checkRateLimit({} as Env, 'conn_1', 2)).resolves.toBe(true);
    await expect(checkRateLimit({} as Env, 'conn_1', 2)).resolves.toBe(true);
    await expect(checkRateLimit({} as Env, 'conn_1', 2)).resolves.toBe(false);
    expect(getRateLimitInfo('conn_1', 2)).toMatchObject({ remaining: 0 });

    vi.advanceTimersByTime(60_001);
    await expect(checkRateLimit({} as Env, 'conn_1', 2)).resolves.toBe(true);
  });

  it('cleans up stale windows', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await checkRateLimit({} as Env, 'stale_conn', 1);

    vi.advanceTimersByTime(120_001);
    cleanupStaleLimits();

    expect(getRateLimitInfo('stale_conn', 1)?.remaining).toBe(1);
  });

  it('reports full remaining quota for unknown connections', () => {
    expect(getRateLimitInfo('fresh_conn', 10)).toMatchObject({ remaining: 10 });
  });
});

describe('credential encryption', () => {
  it('round-trips encrypted credential payloads', async () => {
    const encrypted = await encryptCredentials(
      { apiKey: 'secret', nested: { region: 'us' } },
      'test-key'
    );

    await expect(decryptCredentials(
      encrypted.encrypted,
      encrypted.iv,
      'test-key'
    )).resolves.toEqual({ apiKey: 'secret', nested: { region: 'us' } });
  });

  it('rejects decrypting with the wrong key', async () => {
    const encrypted = await encryptCredentials({ apiKey: 'secret' }, 'test-key');

    await expect(decryptCredentials(
      encrypted.encrypted,
      encrypted.iv,
      'wrong-key'
    )).rejects.toThrow();
  });
});
