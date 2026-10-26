// The workspace chat route verifies the turn's scope before streaming (alongside the turn
// limits) and hands it to the turn, so the agent loop does not resolve it a second time.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ userId: '', runAgentTurn: vi.fn() }));
vi.mock('../../../src/router/helpers/auth-guard', () => ({
  requireTokenOrSession: async () => ({ id: h.userId, email: null, username: null }),
  isAuthUser: () => true,
}));
vi.mock('../../../src/chat-agent/agent-loop', () => ({ runAgentTurn: (...a: unknown[]) => h.runAgentTurn(...a) }));

import { applyMigrations, e } from '../helpers/migrated-db';
import type { FetchContext } from '../../../src/router/context';
import { routeWorkspaceAgentApi } from '../../../src/router/api/workspace-agent';

const WS = 'wsp_wct';
const MEMBER = 'usr_wct_member';
const OUTSIDER = 'usr_wct_outsider';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'wct.member@example.com', 'm'), (?, 'wct.outsider@example.com', 'o')").bind(MEMBER, OUTSIDER),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'wct-ws', ?)").bind(WS, MEMBER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_wct_1', ?, ?, 'admin', 'internal')").bind(WS, MEMBER),
  ]);
});

beforeEach(() => {
  h.runAgentTurn.mockReset();
  h.runAgentTurn.mockResolvedValue({ reply: 'ok' });
});

const chat = async (userId: string) => {
  h.userId = userId;
  const url = new URL(`https://shareout.test/v1/workspace/${WS}/agent/chat`);
  const request = new Request(url, { method: 'POST', body: JSON.stringify({ text: 'hola' }), headers: { 'content-type': 'application/json' } });
  return (await routeWorkspaceAgentApi({ request, env: e, path: url.pathname, url, addCORS: (r: Response) => r } as unknown as FetchContext))!;
};

describe('workspace chat turn', () => {
  it('hands the turn the scope it verified, for the selection the turn runs in', async () => {
    const res = await chat(MEMBER);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"type":"done"');

    const input = h.runAgentTurn.mock.calls[0][1];
    expect(input.scope).toMatchObject({ selection: WS, workspaceId: WS, role: 'admin' });
    expect(input.scope.selection).toBe(input.selectedWorkspaceId);
    expect(input.workspaceContext).toContain('Pages (');
    expect(Object.keys(input.timing).sort()).toEqual(['context_ms', 'limits_ms', 'pre_ms', 'save_ms']);
  });

  it('refuses a non-member before any turn', async () => {
    expect((await chat(OUTSIDER)).status).toBe(403);
    expect(h.runAgentTurn).not.toHaveBeenCalled();
  });

  it('a stale cached role is not enough: the fresh scope check refuses before streaming', async () => {
    await e.SLUGS!.put(`wsintrole:${WS}:${OUTSIDER}`, 'member');
    expect((await chat(OUTSIDER)).status).toBe(403);
    expect(h.runAgentTurn).not.toHaveBeenCalled();
    const threads = await e.DB.prepare('SELECT COUNT(*) AS n FROM agent_threads WHERE user_id = ?').bind(OUTSIDER).first<{ n: number }>();
    expect(threads?.n).toBe(0);
  });
});
