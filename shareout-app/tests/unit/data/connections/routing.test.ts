// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleConnections } from '../../../../src/data/connections/handler';
import * as middleware from '../../../../src/data/middleware';
import { createConnectionsDb } from './mock-db';
import { connRequest, makeCtx, makeEnv } from './shared';

describe('handleConnections routing', () => {
  it('returns 404 for unknown routes', async () => {
    const db = createConnectionsDb();
    const ctx = makeCtx(makeEnv(db));
    const response = await handleConnections(
      connRequest('PATCH', 'my_api/unknown'),
      ctx,
      'my_api/unknown',
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 403 when owner verification fails on protected routes', async () => {
    vi.mocked(middleware.verifyOwner).mockResolvedValue(false);
    const db = createConnectionsDb();
    const ctx = makeCtx(makeEnv(db));

    const list = await handleConnections(connRequest('GET', ''), ctx, '');
    expect(list.status).toBe(403);

    const create = await handleConnections(
      connRequest('POST', '', { name: 'x', type: 'rest_api', config: {} }),
      ctx,
      '',
    );
    expect(create.status).toBe(403);

    const query = await handleConnections(
      connRequest('POST', 'my_api/query', { query: '/items' }),
      ctx,
      'my_api/query',
    );
    expect(query.status).toBe(403);
  });
});
