// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { encryptCredentials } from '../../../../src/data/connections/credentials';
import { handleConnections } from '../../../../src/data/connections/handler';
import { FetchTimeoutError, fetchWithTimeout } from '../../../../src/fetch-utils';
import { createConnectionsDb, sampleRestConnection } from './mock-db';
import {
  ARTIFACT_ID,
  BASE_URL,
  CREDENTIALS_KEY,
  connRequest,
  encryptedApiKey,
  hashConnectionQuery,
  makeCtx,
  makeEnv,
} from './shared';

describe('executeQuery', () => {
  it('returns 500 when CREDENTIALS_KEY is missing', async () => {
    const db = createConnectionsDb({ connections: [{ ...sampleRestConnection }] });
    const ctx = makeCtx(makeEnv(db, { credentialsKey: undefined }));
    const response = await handleConnections(
      connRequest('POST', 'my_api/query', { query: '/items' }),
      ctx,
      'my_api/query',
    );

    expect(response.status).toBe(500);
  });

  it('returns 404 when connection is missing', async () => {
    const db = createConnectionsDb();
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', 'ghost/query', { query: '/x' }),
      ctx,
      'ghost/query',
    );

    expect(response.status).toBe(404);
  });

  it('returns 400 for invalid JSON', async () => {
    const db = createConnectionsDb({ connections: [{ ...sampleRestConnection }] });
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/connections/my_api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      ctx,
      'my_api/query',
    );

    expect(response.status).toBe(400);
  });

  it('returns 429 when rate limit is exceeded', async () => {
    const db = createConnectionsDb({
      connections: [{ ...sampleRestConnection, rate_limit_rpm: 1 }],
    });
    vi.mocked(fetchWithTimeout).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const ctx = makeCtx(makeEnv(db));

    const first = await handleConnections(
      connRequest('POST', 'my_api/query', { query: '/a', options: { cache: false } }),
      ctx,
      'my_api/query',
    );
    expect(first.status).toBe(200);

    vi.mocked(fetchWithTimeout).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const second = await handleConnections(
      connRequest('POST', 'my_api/query', { query: '/b', options: { cache: false } }),
      ctx,
      'my_api/query',
    );
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('returns cached result when cache entry exists', async () => {
    const query = '/cached-path';
    const queryHash = await hashConnectionQuery(query);

    const db = createConnectionsDb({
      connections: [{ ...sampleRestConnection }],
      cache: [
        {
          connection_id: 'con_sample',
          query_hash: queryHash,
          r2_key: 'cache/con_sample/hash',
          expires_at: '2099-01-01T00:00:00.000Z',
        },
      ],
    });
    const ctx = makeCtx(
      makeEnv(db, { cacheGetResult: [{ id: 1 }, { id: 2 }] }),
    );
    const response = await handleConnections(
      connRequest('POST', 'my_api/query', { query }),
      ctx,
      'my_api/query',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { cached: true, executionTimeMs: 0, data: [{ id: 1 }, { id: 2 }] },
    });
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('executes rest_api string query and caches JSON response', async () => {
    const enc = await encryptedApiKey('query-key');
    const db = createConnectionsDb({
      connections: [{ ...sampleRestConnection }],
      credentials: [
        {
          id: 'crd_sample',
          artifact_id: ARTIFACT_ID,
          type: 'api_key',
          encrypted_data: enc.encrypted,
          iv: enc.iv,
          created_at: '2026-05-30T14:00:00.000Z',
          updated_at: '2026-05-30T14:00:00.000Z',
        },
      ],
    });
    vi.mocked(fetchWithTimeout).mockResolvedValue(
      new Response(JSON.stringify({ items: [1, 2] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const env = makeEnv(db);
    const ctx = makeCtx(env);
    const response = await handleConnections(
      connRequest('POST', 'my_api/query', {
        query: '/items',
        options: { params: { limit: '10' }, ttl: 60 },
      }),
      ctx,
      'my_api/query',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { cached: boolean; data: { items: number[] }; executionTimeMs: number };
    };
    expect(body.data.cached).toBe(false);
    expect(body.data.data).toEqual({ items: [1, 2] });
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      'https://api.example.com/items?limit=10',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'X-Api-Key': 'query-key' }),
      }),
      15000,
    );
    expect(env.ARTIFACTS.put).toHaveBeenCalled();
  });

  it('executes rest_api query with basic_auth credentials', async () => {
    const enc = await encryptCredentials(
      { username: 'reader', password: 'secret' },
      CREDENTIALS_KEY,
    );
    const db = createConnectionsDb({
      connections: [{ ...sampleRestConnection }],
      credentials: [
        {
          id: 'crd_sample',
          artifact_id: ARTIFACT_ID,
          type: 'basic_auth',
          encrypted_data: enc.encrypted,
          iv: enc.iv,
          created_at: '2026-05-30T14:00:00.000Z',
          updated_at: '2026-05-30T14:00:00.000Z',
        },
      ],
    });
    vi.mocked(fetchWithTimeout).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const ctx = makeCtx(makeEnv(db));
    await handleConnections(
      connRequest('POST', 'my_api/query', {
        query: '/secure',
        options: { cache: false },
      }),
      ctx,
      'my_api/query',
    );

    expect(fetchWithTimeout).toHaveBeenCalledWith(
      'https://api.example.com/secure',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${btoa('reader:secret')}`,
        }),
      }),
      15000,
    );
  });

  it('merges static config.headers into the rest_api request alongside the api key', async () => {
    const enc = await encryptedApiKey('ctx-key');
    const db = createConnectionsDb({
      connections: [
        {
          ...sampleRestConnection,
          config: JSON.stringify({
            baseUrl: 'https://api.example.com',
            apiKeyHeader: 'x-api-key',
            apiKeyPrefix: '',
            headers: { 'x-context': 'true', 'x-skip-num': 1 },
          }),
        },
      ],
      credentials: [
        {
          id: 'crd_sample',
          artifact_id: ARTIFACT_ID,
          type: 'api_key',
          encrypted_data: enc.encrypted,
          iv: enc.iv,
          created_at: '2026-05-30T14:00:00.000Z',
          updated_at: '2026-05-30T14:00:00.000Z',
        },
      ],
    });
    vi.mocked(fetchWithTimeout).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const ctx = makeCtx(makeEnv(db));
    await handleConnections(
      connRequest('POST', 'my_api/query', { query: '/data', options: { cache: false } }),
      ctx,
      'my_api/query',
    );

    const [, init] = vi.mocked(fetchWithTimeout).mock.calls.at(-1)!;
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers['x-context']).toBe('true');
    expect(headers['x-api-key']).toBe('ctx-key');
    // non-string header values are ignored
    expect(headers['x-skip-num']).toBeUndefined();
  });

  it('executes object query with POST body and returns text for non-JSON responses', async () => {
    const db = createConnectionsDb({
      connections: [
        {
          ...sampleRestConnection,
          encrypted_credentials: null,
          iv: null,
          config: JSON.stringify({ baseUrl: 'https://api.example.com/' }),
        },
      ],
    });
    vi.mocked(fetchWithTimeout).mockResolvedValue(
      new Response('plain-text', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', 'my_api/query', {
        query: { endpoint: 'export', method: 'post', body: { format: 'csv' } },
        options: { cache: false, ttl: 0 },
      }),
      ctx,
      'my_api/query',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { data: string } };
    expect(body.data.data).toBe('plain-text');
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      'https://api.example.com/export',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ format: 'csv' }),
      }),
      15000,
    );
  });

  it('returns 501 for unimplemented provider types', async () => {
    const db = createConnectionsDb({
      connections: [{ ...sampleRestConnection, provider: 'postgres', name: 'db' }],
    });
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', 'db/query', { query: 'SELECT 1' }),
      ctx,
      'db/query',
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PROVIDER_NOT_IMPLEMENTED',
    });
  });

  it('returns 400 when rest_api baseUrl is missing', async () => {
    const noBaseDb = createConnectionsDb({
      connections: [
        {
          ...sampleRestConnection,
          name: 'no_base',
          config: JSON.stringify({}),
        },
      ],
    });
    const noBaseCtx = makeCtx(makeEnv(noBaseDb));
    const noBase = await handleConnections(
      connRequest('POST', 'no_base/query', { query: '/x', options: { cache: false } }),
      noBaseCtx,
      'no_base/query',
    );
    expect(noBase.status).toBe(400);
    await expect(noBase.json()).resolves.toMatchObject({
      code: 'INVALID_REQUEST',
      error: 'baseUrl not configured',
    });
  });

  it('returns 400 when rest_api baseUrl targets a blocked host', async () => {
    const db = createConnectionsDb({
      connections: [
        {
          ...sampleRestConnection,
          name: 'ssrf',
          config: JSON.stringify({ baseUrl: 'http://127.0.0.1' }),
        },
      ],
    });
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', 'ssrf/query', { query: '/secret', options: { cache: false } }),
      ctx,
      'ssrf/query',
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_REQUEST',
      error: expect.stringMatching(/Blocked/i),
    });
  });

  it('maps an upstream 5xx to 502 UPSTREAM_ERROR without leaking response body', async () => {
    const db = createConnectionsDb({
      connections: [
        {
          ...sampleRestConnection,
          config: JSON.stringify({ baseUrl: 'https://api.example.com' }),
        },
      ],
    });
    vi.mocked(fetchWithTimeout).mockResolvedValue(
      new Response('secret_upstream_token=abc123', { status: 500, statusText: 'Internal Server Error' }),
    );
    const ctx = makeCtx(makeEnv(db));
    const httpErr = await handleConnections(
      connRequest('POST', 'my_api/query', {
        query: '/fail',
        options: { cache: false },
      }),
      ctx,
      'my_api/query',
    );
    expect(httpErr.status).toBe(502);
    const body = await httpErr.json() as { code: string; error: string };
    expect(body).toMatchObject({
      code: 'UPSTREAM_ERROR',
      error: 'The connected API is unavailable (HTTP 500)',
    });
    expect(body.error).not.toContain('secret_upstream_token');
  });

  it('maps an upstream 4xx (bad/expired credential) to 424 UPSTREAM_REJECTED without leaking response body', async () => {
    const db = createConnectionsDb({
      connections: [
        {
          ...sampleRestConnection,
          config: JSON.stringify({ baseUrl: 'https://api.example.com' }),
        },
      ],
    });
    vi.mocked(fetchWithTimeout).mockResolvedValue(
      new Response('invalid api key: sk_live_secret', { status: 401, statusText: 'Unauthorized' }),
    );
    const ctx = makeCtx(makeEnv(db));
    const rejected = await handleConnections(
      connRequest('POST', 'my_api/query', {
        query: '/fail',
        options: { cache: false },
      }),
      ctx,
      'my_api/query',
    );
    expect(rejected.status).toBe(424);
    const body = await rejected.json() as { code: string; error: string };
    expect(body).toMatchObject({
      code: 'UPSTREAM_REJECTED',
      error: 'The connected API rejected the request (HTTP 401)',
    });
    expect(body.error).not.toContain('sk_live_secret');
  });

  it('maps an upstream timeout to 504 UPSTREAM_TIMEOUT', async () => {
    const db = createConnectionsDb({
      connections: [
        {
          ...sampleRestConnection,
          config: JSON.stringify({ baseUrl: 'https://api.example.com' }),
        },
      ],
    });
    vi.mocked(fetchWithTimeout).mockRejectedValue(
      new FetchTimeoutError('https://api.example.com/fail', 15000),
    );
    const ctx = makeCtx(makeEnv(db));
    const timedOut = await handleConnections(
      connRequest('POST', 'my_api/query', {
        query: '/fail',
        options: { cache: false },
      }),
      ctx,
      'my_api/query',
    );
    expect(timedOut.status).toBe(504);
    await expect(timedOut.json()).resolves.toMatchObject({
      code: 'UPSTREAM_TIMEOUT',
      error: 'The connected API timed out',
    });
  });

  it('handles unexpected query failures without leaking internal error text', async () => {
    const enc = await encryptedApiKey('query-key');
    const db = createConnectionsDb({
      connections: [{ ...sampleRestConnection }],
      credentials: [
        {
          id: 'crd_sample',
          artifact_id: ARTIFACT_ID,
          type: 'api_key',
          encrypted_data: enc.encrypted,
          iv: enc.iv,
          created_at: '2026-05-30T14:00:00.000Z',
          updated_at: '2026-05-30T14:00:00.000Z',
        },
      ],
    });
    vi.mocked(fetchWithTimeout).mockRejectedValue(
      new Error('D1_ERROR: no such table: connection_credentials'),
    );
    const ctx = makeCtx(makeEnv(db));
    const failed = await handleConnections(
      connRequest('POST', 'my_api/query', {
        query: '/fail',
        options: { cache: false },
      }),
      ctx,
      'my_api/query',
    );
    expect(failed.status).toBe(500);
    const body = await failed.json() as { code: string; error: string };
    expect(body).toMatchObject({
      code: 'QUERY_ERROR',
      error: 'Query failed',
    });
    expect(body.error).not.toContain('D1_ERROR');
    expect(body.error).not.toContain('connection_credentials');
  });

  it('bypasses cache read when options.cache is false', async () => {
    const { sha256 } = await import('../../../../src/crypto-utils');
    const query = '/fresh';
    const queryHash = await sha256(new TextEncoder().encode(query).buffer as ArrayBuffer);

    const db = createConnectionsDb({
      connections: [{ ...sampleRestConnection }],
      cache: [
        {
          connection_id: 'con_sample',
          query_hash: queryHash,
          r2_key: 'cache/con_sample/stale',
          expires_at: '2099-01-01T00:00:00.000Z',
        },
      ],
    });
    vi.mocked(fetchWithTimeout).mockResolvedValue(
      new Response(JSON.stringify({ fresh: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const env = makeEnv(db, { cacheGetResult: { stale: true } });
    const ctx = makeCtx(env);
    const response = await handleConnections(
      connRequest('POST', 'my_api/query', {
        query,
        options: { cache: false },
      }),
      ctx,
      'my_api/query',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { cached: false, data: { fresh: true } },
    });
    expect(fetchWithTimeout).toHaveBeenCalled();
    expect(env.ARTIFACTS.get).not.toHaveBeenCalled();
  });
});
