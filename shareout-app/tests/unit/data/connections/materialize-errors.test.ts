// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleConnections } from '../../../../src/data/connections/handler';
import { FetchTimeoutError, fetchWithTimeout } from '../../../../src/fetch-utils';
import { createConnectionsDb, sampleRestConnection } from './mock-db';
import { connRequest, makeCtx, makeEnv } from './shared';

describe('handleConnections materialize error sanitization', () => {
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
    const response = await handleConnections(
      connRequest('POST', 'my_api/materialize', {
        query: '/fail',
        target: { type: 'dataset', name: 'out' },
      }),
      ctx,
      'my_api/materialize',
    );

    expect(response.status).toBe(502);
    const body = await response.json() as { code: string; error: string };
    expect(body).toMatchObject({
      code: 'UPSTREAM_ERROR',
      error: 'The connected API is unavailable (HTTP 500)',
    });
    expect(body.error).not.toContain('secret_upstream_token');
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
    const response = await handleConnections(
      connRequest('POST', 'my_api/materialize', {
        query: '/fail',
        target: { type: 'dataset', name: 'out' },
      }),
      ctx,
      'my_api/materialize',
    );

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      code: 'UPSTREAM_TIMEOUT',
      error: 'The connected API timed out',
    });
  });

  it('handles unexpected materialize failures without leaking internal error text', async () => {
    const materialize = await import('../../../../src/data/materialize');
    vi.spyOn(materialize, 'runMaterialize').mockRejectedValue(
      new Error('D1_ERROR: no such table: datasets'),
    );
    const db = createConnectionsDb({
      connections: [{ ...sampleRestConnection }],
    });
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', 'my_api/materialize', {
        rows: [{ id: 1 }],
        target: { type: 'dataset', name: 'out' },
      }),
      ctx,
      'my_api/materialize',
    );

    expect(response.status).toBe(500);
    const body = await response.json() as { code: string; error: string };
    expect(body).toMatchObject({
      code: 'MATERIALIZE_ERROR',
      error: 'Materialize failed',
    });
    expect(body.error).not.toContain('D1_ERROR');
    expect(body.error).not.toContain('datasets');
  });

  it('preserves user-actionable dataset quota messages', async () => {
    const materialize = await import('../../../../src/data/materialize');
    vi.spyOn(materialize, 'runMaterialize').mockRejectedValue(
      new Error('Materialized dataset "out" would exceed the free plan\'s 50MB storage limit'),
    );
    const db = createConnectionsDb({
      connections: [{ ...sampleRestConnection }],
    });
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('POST', 'my_api/materialize', {
        rows: [{ id: 1 }],
        target: { type: 'dataset', name: 'out' },
      }),
      ctx,
      'my_api/materialize',
    );

    expect(response.status).toBe(400);
    const body = await response.json() as { code: string; error: string };
    expect(body.code).toBe('MATERIALIZE_ERROR');
    expect(body.error).toContain('would exceed the free plan');
  });
});
