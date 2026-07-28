// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleConnections } from '../../../../src/data/connections/handler';
import { ARTIFACT_ID, BASE_URL, connRequest, encryptedApiKey, makeCtx, makeEnv } from './shared';
import { createConnectionsDb, sampleRestConnection } from './mock-db';

describe('updateConnection', () => {
  it('returns 500 when CREDENTIALS_KEY is missing', async () => {
    const db = createConnectionsDb({ connections: [{ ...sampleRestConnection }] });
    const ctx = makeCtx(makeEnv(db, { credentialsKey: undefined }));
    const response = await handleConnections(
      connRequest('PUT', 'my_api', { config: { baseUrl: 'https://new.example.com' } }),
      ctx,
      'my_api',
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  it('returns 404 when connection does not exist', async () => {
    const db = createConnectionsDb();
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('PUT', 'ghost', { config: {} }),
      ctx,
      'ghost',
    );

    expect(response.status).toBe(404);
  });

  it('returns 400 for invalid JSON body', async () => {
    const db = createConnectionsDb({ connections: [{ ...sampleRestConnection }] });
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/connections/my_api`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{bad',
      }),
      ctx,
      'my_api',
    );

    expect(response.status).toBe(400);
  });

  it('updates config, cache, rate limit, and existing credentials', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T15:00:00.000Z'));

    const enc = await encryptedApiKey('rotated-key');
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
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('PUT', 'my_api', {
        config: { baseUrl: 'https://updated.example.com' },
        cacheTtl: 600,
        rateLimit: 120,
        credentials: { type: 'api_key', data: { apiKey: 'new-secret' } },
      }),
      ctx,
      'my_api',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { updatedAt: string } };
    expect(body.data.updatedAt).toBe('2026-05-30T15:00:00.000Z');
    expect(JSON.parse(db.connections[0].config).baseUrl).toBe('https://updated.example.com');
    expect(db.connections[0].cache_ttl_seconds).toBe(600);
    expect(db.connections[0].rate_limit_rpm).toBe(120);
  });

  it('inserts credentials when connection had none', async () => {
    const db = createConnectionsDb({
      connections: [{ ...sampleRestConnection, encrypted_credentials: null, iv: null }],
    });
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('PUT', 'my_api', {
        credentials: { type: 'basic_auth', data: { username: 'u', password: 'p' } },
      }),
      ctx,
      'my_api',
    );

    expect(response.status).toBe(200);
    expect(db.connections[0].auth_type).toBe('basic_auth');
    expect(db.connections[0].encrypted_credentials).toBeTruthy();
  });
});

describe('deleteConnection', () => {
  it('returns 404 when connection is missing', async () => {
    const db = createConnectionsDb();
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('DELETE', 'missing'),
      ctx,
      'missing',
    );

    expect(response.status).toBe(404);
  });

  it('deletes the connection and its cache rows', async () => {
    const enc = await encryptedApiKey('key');
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
      cache: [
        {
          connection_id: 'con_sample',
          query_hash: 'abc',
          r2_key: 'cache/con_sample/abc',
          expires_at: '2099-01-01T00:00:00.000Z',
        },
      ],
    });
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(connRequest('DELETE', 'my_api'), ctx, 'my_api');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { deleted: true } });
    expect(db.connections).toHaveLength(0);
    expect(db.cache).toHaveLength(0);
  });

  it('deletes connection without credentials', async () => {
    const db = createConnectionsDb({
      connections: [{ ...sampleRestConnection, encrypted_credentials: null, iv: null }],
    });
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(connRequest('DELETE', 'my_api'), ctx, 'my_api');

    expect(response.status).toBe(200);
    expect(db.connections).toHaveLength(0);
  });
});
