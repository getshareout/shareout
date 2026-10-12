import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const validateToken = vi.hoisted(() => vi.fn());
const quickSearch = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', async (orig) => ({ ...(await orig<object>()), validateToken }));
vi.mock('../../../src/search/quick-search', async (orig) => ({
  ...(await orig<typeof import('../../../src/search/quick-search')>()),
  quickSearch,
}));

import { routeArtifactApi } from '../../../src/router/api/artifacts';
import { createFetchContext } from '../../../src/router/context';

const env = {} as Env;
const get = (qs: string) =>
  routeArtifactApi(createFetchContext(new Request(`https://shareout.site/v1/search${qs}`, { headers: { Authorization: 'Bearer so_x' } }), env));

beforeEach(() => {
  validateToken.mockReset().mockResolvedValue({ id: 'user_1', email: 'me@example.com' });
  quickSearch.mockReset().mockResolvedValue({ query: '', artifacts: [] });
});

describe('GET /v1/search', () => {
  it('400s without a q param', async () => {
    const res = await get('');
    expect(res?.status).toBe(400);
    expect(await res!.json()).toMatchObject({ success: false, code: 'VALIDATION_ERROR', param: 'q' });
    expect(quickSearch).not.toHaveBeenCalled();
  });

  it('still returns recents for an explicit empty q', async () => {
    const res = await get('?q=');
    expect(res?.status).toBe(200);
    expect(quickSearch).toHaveBeenCalled();
  });
});
