// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleConnections } from '../../../../src/data/connections/handler';
import { createConnectionsDb, sampleRestConnection } from './mock-db';
import { ARTIFACT_ID, BASE_URL, connRequest, makeCtx, makeEnv } from './shared';

describe('createConnection', () => {
  it('returns 500 when CREDENTIALS_KEY is not configured', async () => {
    const db = createConnectionsDb();
    const ctx = makeCtx(makeEnv(db, { credentialsKey: undefined }));
    const response = await handleConnections(
      connRequest('POST', '', { name: 'api', type: 'rest_api', config: {} }),
      ctx,
      '',
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  it('returns 400 for invalid JSON and validation errors', async () => {
    const db = createConnectionsDb();
    const ctx = makeCtx(makeEnv(db));

    const badJson = await handleConnections(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      ctx,
      '',
    );
    expect(badJson.status).toBe(400);

    const missingName = await handleConnections(
      connRequest('POST', '', { type: 'rest_api', config: {} }),
      ctx,
      '',
    );
    expect(missingName.status).toBe(400);
    await expect(missingName.json()).resolves.toMatchObject({
      error: 'Name is required',
    });

    const longName = await handleConnections(
      connRequest('POST', '', { name: 'a'.repeat(65), type: 'rest_api', config: {} }),
      ctx,
      '',
    );
    expect(longName.status).toBe(400);
    await expect(longName.json()).resolves.toMatchObject({
      error: 'Name too long (max 64 chars)',
    });

    const invalidChars = await handleConnections(
      connRequest('POST', '', { name: 'bad name!', type: 'rest_api', config: {} }),
      ctx,
      '',
    );
    expect(invalidChars.status).toBe(400);
    await expect(invalidChars.json()).resolves.toMatchObject({
      error: 'Name contains invalid characters',
    });

    const badType = await handleConnections(
      connRequest('POST', '', { name: 'valid_name', type: 'mysql', config: {} }),
      ctx,
      '',
    );
    expect(badType.status).toBe(400);
    await expect(badType.json()).resolves.toMatchObject({
      error: expect.stringContaining('Type must be one of'),
    });
  });

  it('rejects postgres — hidden until a server-side engine exists (work/023)', async () => {
    const db = createConnectionsDb();
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', '', { name: 'pg', type: 'postgres', config: {} }),
      ctx,
      '',
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Type must be one of: rest_api, bigquery, snowflake',
    });
  });

  it('returns 409 when connection name already exists', async () => {
    const db = createConnectionsDb({ connections: [{ ...sampleRestConnection }] });
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', '', {
        name: 'my_api',
        type: 'rest_api',
        config: { baseUrl: 'https://api.example.com' },
      }),
      ctx,
      '',
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CONFLICT',
      error: 'Connection already exists',
    });
  });

  it('rejects rest_api baseUrl targeting private/metadata hosts (SSRF)', async () => {
    const db = createConnectionsDb();
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', '', {
        name: 'ssrf',
        type: 'rest_api',
        config: { baseUrl: 'http://169.254.169.254/latest' },
      }),
      ctx,
      '',
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_REQUEST',
      error: expect.stringMatching(/Blocked|blocked|private|metadata|169/i),
    });
  });

  it('creates a connection without credentials', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:00:00.000Z'));

    const db = createConnectionsDb();
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', '', {
        name: 'public_api',
        type: 'rest_api',
        config: { baseUrl: 'https://api.example.com' },
        cacheTtl: 120,
        rateLimit: 30,
      }),
      ctx,
      '',
    );

    expect(response.status).toBe(201);
    const body = await response.json() as {
      data: { name: string; hasCredentials: boolean; createdAt: string };
    };
    expect(body.data).toMatchObject({
      name: 'public_api',
      hasCredentials: false,
      createdAt: '2026-05-30T14:00:00.000Z',
    });
    expect(db.connections).toHaveLength(1);
    expect(db.connections[0].cache_ttl_seconds).toBe(120);
    expect(db.connections[0].encrypted_credentials).toBeNull();
  });

  it('creates a connection with encrypted credentials', async () => {
    const db = createConnectionsDb();
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', '', {
        name: 'secure_api',
        type: 'rest_api',
        config: { baseUrl: 'https://api.example.com' },
        credentials: { type: 'api_key', data: { apiKey: 'secret-key' } },
      }),
      ctx,
      '',
    );

    expect(response.status).toBe(201);
    const body = await response.json() as { data: { hasCredentials: boolean } };
    expect(body.data.hasCredentials).toBe(true);
    expect(db.connections).toHaveLength(1);
    // Credentials are inline on the row now — no second table to point at.
    expect(db.connections[0].auth_type).toBe('api_key');
    expect(db.connections[0].encrypted_credentials).toBeTruthy();
    expect(db.connections[0].iv).toBeTruthy();
  });
});
