// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/types';
import type { FetchContext } from '../../../src/router/context';

const feed = vi.fn();
const streamTurn = vi.fn();
vi.mock('../../../src/router/helpers/auth-guard', () => ({
  requireTokenOrSession: async () => ({ id: 'u1', email: 'leo@x.com', username: null }),
  isAuthUser: () => true,
}));
vi.mock('../../../src/pages/home/host', () => ({ hostWorkspaceId: async () => null }));
vi.mock('../../../src/pages/home/queries', () => ({ queryActivityFeed: (...a: unknown[]) => feed(...a), queryHomeArtifactCatalog: vi.fn() }));
vi.mock('../../../src/account-links', () => ({ getVisibilityScope: async () => ({ userIds: ['u1'] }) }));
vi.mock('../../../src/analytics', () => ({ getAccountAnalytics: async () => null }));
vi.mock('../../../src/data/agent/ai-config', () => ({ resolveGatewayModel: async () => 'm' }));
vi.mock('../../../src/crew/provider', () => ({ getCrewProvider: () => ({ streamTurn: (...a: unknown[]) => streamTurn(...a) }) }));

import { routeHomeAgentApi } from '../../../src/router/api/home-agent';

function ctx(qs: string): FetchContext {
  const DB = { prepare: () => ({ bind: () => ({ first: async () => ({ name: 'Leonel Fernandez' }) }) }) };
  const url = new URL(`https://shareout.site/v1/home/agent/brief?${qs}`);
  return { request: new Request(url), env: { DB } as unknown as Env, path: url.pathname, url, addCORS: (r: Response) => r } as unknown as FetchContext;
}

beforeEach(() => { feed.mockReset(); streamTurn.mockReset(); });

describe('home agent brief', () => {
  it('returns no brief and calls no model when nothing happened (new account)', async () => {
    feed.mockResolvedValue({ needs: [], pulse: [] });
    const res = await routeHomeAgentApi(ctx('tod=morning&lang=es'));
    expect(await res!.json()).toEqual({ text: '' });
    expect(streamTurn).not.toHaveBeenCalled();
  });

  it('writes in the viewer language and greets by first name', async () => {
    feed.mockResolvedValue({ needs: [{ actor: 'Ana', summary: 'commented' }], pulse: [] });
    streamTurn.mockImplementation(async function* () { yield { type: 'text_delta', text: 'Buen día, Leonel.' }; yield { type: 'message_stop' }; });
    const res = await routeHomeAgentApi(ctx('tod=morning&lang=es'));
    expect(await res!.json()).toEqual({ text: 'Buen día, Leonel.' });
    const req = streamTurn.mock.calls[0][0];
    expect(req.system).toContain('Spanish as spoken in Argentina');
    expect(req.transcript[0].text).toContain('User: Leonel');
  });
});
