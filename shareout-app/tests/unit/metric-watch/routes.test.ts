import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', () => ({ validateToken }));
vi.mock('../../../src/auth/session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSessionUser,
}));

const createWatch = vi.hoisted(() => vi.fn());
const deleteWatch = vi.hoisted(() => vi.fn());
vi.mock('../../../src/metric-watch/watches', () => ({ createWatch, deleteWatch, listWatches: vi.fn() }));

import { routeMetricWatchApi } from '../../../src/router/api/metric-watch';
import { createFetchContext } from '../../../src/router/context';

const env = {} as Env;

function call(path: string, method: string, body?: BodyInit) {
  const req = new Request('https://shareout.site' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: 'shareout_session=x' },
    body,
  });
  return routeMetricWatchApi(createFetchContext(req, env));
}

beforeEach(() => {
  vi.clearAllMocks();
  validateToken.mockResolvedValue(null);
  getSessionUser.mockResolvedValue({ id: 'user_1', email: 'me@example.com' });
});

describe('metric-watch error envelope', () => {
  it('invalid JSON', async () => {
    const res = await call('/v1/metric-watch', 'POST', '{bad');
    expect(res?.status).toBe(400);
    expect(await res!.json()).toMatchObject({ success: false, code: 'INVALID_JSON' });
  });

  it('missing artifact_id', async () => {
    for (const body of ['{}', 'null']) {
      const res = await call('/v1/metric-watch', 'POST', body);
      expect(res?.status).toBe(400);
      expect(await res!.json()).toMatchObject({ success: false, code: 'VALIDATION_ERROR', param: 'artifact_id' });
    }
    expect(createWatch).not.toHaveBeenCalled();
  });

  it('unknown table is a 404 with a code', async () => {
    createWatch.mockResolvedValue({ error: 'Table "nope" not found' });
    const res = await call('/v1/metric-watch', 'POST', JSON.stringify({ artifact_id: 'art_1', table: 'nope', kind: 'count' }));
    expect(res?.status).toBe(404);
    expect(await res!.json()).toMatchObject({ success: false, code: 'NOT_FOUND', error: 'Table "nope" not found' });
  });

  it('DELETE of an unknown watch', async () => {
    deleteWatch.mockResolvedValue({ success: false, error: 'Watch not found' });
    const res = await call('/v1/metric-watch/mw_x', 'DELETE');
    expect(res?.status).toBe(404);
    expect(await res!.json()).toMatchObject({ success: false, code: 'NOT_FOUND' });
  });
});
