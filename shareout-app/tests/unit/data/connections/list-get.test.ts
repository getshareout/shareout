// @vitest-environment node
import './setup';
import { describe, expect, it } from 'vitest';
import { handleConnections } from '../../../../src/data/connections/handler';
import { createConnectionsDb, sampleRestConnection } from './mock-db';
import { connRequest, makeCtx, makeEnv } from './shared';

describe('listConnections', () => {
  it('returns connection summaries for the artifact', async () => {
    const db = createConnectionsDb({
      connections: [
        { ...sampleRestConnection },
        {
          ...sampleRestConnection,
          id: 'con_other',
          name: 'warehouse',
          provider: 'snowflake',
        },
      ],
    });
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(connRequest('GET', ''), ctx, '');

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { connections: Array<{ name: string; type: string }>; count: number };
    };
    expect(body.data.count).toBe(2);
    expect(body.data.connections[0]).toMatchObject({
      name: 'my_api',
      type: 'rest_api',
      cacheTtl: 300,
      rateLimit: 60,
    });
    expect(body.data.connections[1].name).toBe('warehouse');
  });
});

describe('getConnection', () => {
  it('returns 404 when connection is missing', async () => {
    const db = createConnectionsDb();
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(connRequest('GET', 'missing'), ctx, 'missing');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'NOT_FOUND',
      error: 'Connection not found',
    });
  });

  it('returns parsed config for an existing connection', async () => {
    const db = createConnectionsDb({ connections: [{ ...sampleRestConnection }] });
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(connRequest('GET', 'my_api'), ctx, 'my_api');

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { name: string; config: { baseUrl: string } } };
    expect(body.data.name).toBe('my_api');
    expect(body.data.config.baseUrl).toBe('https://api.example.com');
  });
});
