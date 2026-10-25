// @vitest-environment node
// G17: who is "member" (human session) vs "automation" (API/agent token).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const validateToken = vi.hoisted(() => vi.fn());
const role = vi.hoisted(() => vi.fn());
const resolveUser = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/api-auth', async (orig) => ({ ...(await orig<object>()), validateToken }));
vi.mock('../../../../src/workspaces/roles', async (orig) => ({ ...(await orig<object>()), getInternalWorkspaceRole: role }));
vi.mock('../../../../src/data/middleware', async (orig) => ({ ...(await orig<object>()), resolveRequesterUserId: resolveUser }));

import { agentCaller } from '../../../../src/data/agent/member-quota';

const ctx = (over: Record<string, unknown> = {}) => ({ workspaceId: 'wsp_1', env: {}, viewer: { email: 'a@x.com' }, ...over }) as never;
const req = (auth?: string) => new Request('https://x/agent/chat', { method: 'POST', headers: auth ? { Authorization: auth } : {} });

beforeEach(() => {
  validateToken.mockReset().mockResolvedValue(null);
  role.mockReset().mockResolvedValue('member');
  resolveUser.mockReset().mockResolvedValue('usr_1');
});

describe('agentCaller', () => {
  it('a personal API token (so_) of a member is automation', async () => {
    validateToken.mockResolvedValue({ id: 'usr_leo' });
    expect(await agentCaller(req('Bearer so_abc'), ctx({ viewer: undefined }))).toEqual({ kind: 'automation', userId: 'usr_leo' });
  });

  it('a workspace agent token (sot_) is automation only for its own workspace', async () => {
    validateToken.mockResolvedValue({ id: 'usr_agent', service: { workspaceId: 'wsp_1', scopes: [] } });
    expect(await agentCaller(req('Bearer sot_x'), ctx())).toEqual({ kind: 'automation', userId: 'usr_agent' });
    validateToken.mockResolvedValue({ id: 'usr_agent', service: { workspaceId: 'wsp_other', scopes: [] } });
    expect(await agentCaller(req('Bearer sot_x'), ctx())).toBeNull();
  });

  it('an API token of a non-member is not a caller at all', async () => {
    validateToken.mockResolvedValue({ id: 'usr_x' });
    role.mockResolvedValue(null);
    expect(await agentCaller(req('Bearer so_abc'), ctx())).toBeNull();
  });

  it('a browser session (no API token) is a member', async () => {
    expect(await agentCaller(req(), ctx())).toEqual({ kind: 'member', userId: 'usr_1' });
  });

  it('the page-embedded artifact access token (Bearer that is not an API token) is still a human member', async () => {
    expect(await agentCaller(req('Bearer eyJ.artifact.access'), ctx())).toEqual({ kind: 'member', userId: 'usr_1' });
  });

  it('anonymous or workspace-less requests are not callers', async () => {
    expect(await agentCaller(req(), ctx({ viewer: { email: null } }))).toBeNull();
    expect(await agentCaller(req(), ctx({ workspaceId: undefined }))).toBeNull();
  });
});
