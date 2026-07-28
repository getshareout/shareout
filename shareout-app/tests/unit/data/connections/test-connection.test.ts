// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { encryptCredentials } from '../../../../src/data/connections/credentials';
import { handleConnections } from '../../../../src/data/connections/handler';
import { FetchTimeoutError, fetchWithTimeout } from '../../../../src/fetch-utils';
import { createConnectionsDb, sampleRestConnection } from './mock-db';
import {
  ARTIFACT_ID,
  CREDENTIALS_KEY,
  connRequest,
  encryptedApiKey,
  makeCtx,
  makeEnv,
} from './shared';

describe('testConnection', () => {
  it('returns 500 when CREDENTIALS_KEY is missing', async () => {
    const db = createConnectionsDb({ connections: [{ ...sampleRestConnection }] });
    const ctx = makeCtx(makeEnv(db, { credentialsKey: undefined }));
    const response = await handleConnections(
      connRequest('POST', 'my_api/test'),
      ctx,
      'my_api/test',
    );

    expect(response.status).toBe(500);
  });

  it('returns 404 when connection is missing', async () => {
    const db = createConnectionsDb();
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', 'ghost/test'),
      ctx,
      'ghost/test',
    );

    expect(response.status).toBe(404);
  });

  it('reports missing baseUrl for rest_api connections', async () => {
    const db = createConnectionsDb({
      connections: [{ ...sampleRestConnection, config: JSON.stringify({}) }],
    });
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', 'my_api/test'),
      ctx,
      'my_api/test',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { success: false, error: 'baseUrl not configured' },
    });
  });

  it('tests rest_api with api_key credentials and successful fetch', async () => {
    const enc = await encryptedApiKey('test-api-key');
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
      new Response('ok', { status: 200 }),
    );
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', 'my_api/test'),
      ctx,
      'my_api/test',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { success: boolean; status: number } };
    expect(body.data.success).toBe(true);
    expect(body.data.status).toBe(200);
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      'https://api.example.com/health',
      expect.objectContaining({
        headers: { 'X-Api-Key': 'test-api-key' },
        method: 'GET',
      }),
      15000,
    );
  });

  it('tests rest_api with basic_auth and non-ok HTTP status', async () => {
    const enc = await encryptCredentials(
      { username: 'user', password: 'pass' },
      CREDENTIALS_KEY,
    );
    const db = createConnectionsDb({
      connections: [
        {
          ...sampleRestConnection,
          config: JSON.stringify({ baseUrl: 'https://api.example.com' }),
        },
      ],
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
      new Response('error', { status: 503, statusText: 'Service Unavailable' }),
    );
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', 'my_api/test'),
      ctx,
      'my_api/test',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { success: false, status: 503, message: 'HTTP 503' },
    });
    const expectedAuth = `Basic ${btoa('user:pass')}`;
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      'https://api.example.com',
      expect.objectContaining({
        headers: { Authorization: expectedAuth },
      }),
      15000,
    );
  });

  it('returns not-implemented message for connection types with no server-side engine (postgres)', async () => {
    const db = createConnectionsDb({
      connections: [{ ...sampleRestConnection, provider: 'postgres', name: 'pg' }],
    });
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', 'pg/test'),
      ctx,
      'pg/test',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { success: true, message: expect.stringContaining('not implemented') },
    });
  });

  it('attempts a real warehouse query for snowflake/bigquery (fails gracefully on missing config)', async () => {
    const db = createConnectionsDb({
      connections: [{ ...sampleRestConnection, type: 'snowflake', name: 'warehouse' }],
    });
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', 'warehouse/test'),
      ctx,
      'warehouse/test',
    );

    expect(response.status).toBe(200);
    // No Snowflake key-pair config on the rest-shaped sample → the provider rejects
    // before any network call, and testConnection surfaces it as a clean failure
    // rather than the old "not implemented" stub.
    await expect(response.json()).resolves.toMatchObject({
      data: { success: false },
    });
  });

  it('handles fetch timeouts without leaking internal error text', async () => {
    const db = createConnectionsDb({ connections: [{ ...sampleRestConnection }] });
    const ctx = makeCtx(makeEnv(db));

    vi.mocked(fetchWithTimeout).mockRejectedValue(
      new FetchTimeoutError('https://api.example.com/health', 15000),
    );
    const timeout = await handleConnections(
      connRequest('POST', 'my_api/test'),
      ctx,
      'my_api/test',
    );
    await expect(timeout.json()).resolves.toMatchObject({
      data: { success: false, error: 'Connection timed out' },
    });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(fetchWithTimeout).mockRejectedValue(new Error('D1_ERROR: secret_internal detail'));
    const failed = await handleConnections(
      connRequest('POST', 'my_api/test'),
      ctx,
      'my_api/test',
    );
    const body = await failed.json() as { data: { success: boolean; error?: string } };
    expect(body.data).toMatchObject({
      success: false,
      error: 'Connection test failed',
    });
    expect(body.data.error).not.toContain('D1_ERROR');
    expect(body.data.error).not.toContain('secret_internal');
    expect(consoleError).toHaveBeenCalled();
  });
});
