// On a workspace's own host (subdomain or custom domain) /home is already scoped to
// that workspace, so `?workspace=` is dropped from the link people copy.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const host = vi.hoisted(() => ({ hostWorkspaceId: vi.fn() }));
vi.mock('../../../src/pages/home/host', () => host);

import { handleUserHomePage } from '../../../src/pages/home/handler';

const emptyDb = {
  prepare: () => ({
    bind: () => ({
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
    }),
  }),
};
const env = { DB: emptyDb, SHAREOUT_BASE_URL: 'https://x.test' } as unknown as Env;
const alice = { id: 'usr_alice', email: 'alice@example.com' };

beforeEach(() => host.hostWorkspaceId.mockReset());

describe('/home on the workspace host', () => {
  it('redirects away a redundant ?workspace= and keeps the rest of the query', async () => {
    host.hostWorkspaceId.mockResolvedValue('wsp_1');
    const res = await handleUserHomePage(new Request('https://acme.x.test/home?workspace=wsp_1&view=admin&tab=billing'), env, alice);
    expect(res.status).toBe(302);
    // No fragment in Location: the browser carries #l/... over to the new URL.
    expect(res.headers.get('Location')).toBe('/home?view=admin&tab=billing');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('redirects to bare /home when ?workspace= was the only parameter', async () => {
    host.hostWorkspaceId.mockResolvedValue('wsp_1');
    const res = await handleUserHomePage(new Request('https://acme.x.test/home?workspace=wsp_1'), env, alice);
    expect(res.headers.get('Location')).toBe('/home');
  });

  it('keeps ?workspace= on the apex, where it is what picks the workspace', async () => {
    host.hostWorkspaceId.mockResolvedValue(null);
    const res = await handleUserHomePage(new Request('https://x.test/home?workspace=wsp_1'), env, alice);
    expect(res.status).toBe(200);
  });

  it('serves a clean /home on the workspace host without redirecting', async () => {
    host.hostWorkspaceId.mockResolvedValue('wsp_1');
    const res = await handleUserHomePage(new Request('https://acme.x.test/home'), env, alice);
    expect(res.status).toBe(200);
    await res.text();
  });
});
