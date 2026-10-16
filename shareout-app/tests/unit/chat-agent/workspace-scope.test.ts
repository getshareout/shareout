// The account agent's workspace scope against the real schema: only internal members
// get a workspace scope, external (sharee) edges and other workspaces' ids are refused
// before any tool, workspace setting or model is touched, and tools re-check on their own.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getCrewProvider: vi.fn(), queryWorkspaceConnection: vi.fn(), host: null as string | null, userId: '' }));
vi.mock('../../../src/pages/home/host', () => ({ hostWorkspaceId: async () => h.host }));
vi.mock('../../../src/router/helpers/auth-guard', () => ({
  requireTokenOrSession: async () => ({ id: h.userId, email: null, username: null }),
  isAuthUser: () => true,
}));
vi.mock('../../../src/crew/provider', async (orig) => ({
  ...(await orig<typeof import('../../../src/crew/provider')>()),
  getCrewProvider: h.getCrewProvider,
  crewProviderFor: h.getCrewProvider,
}));
vi.mock('../../../src/data/connections/warehouse-query', async (orig) => ({
  ...(await orig<object>()),
  queryWorkspaceConnection: h.queryWorkspaceConnection,
}));

import { applyMigrations, e } from '../helpers/migrated-db';
import { resolveAgentScope, scopedWorkspaceId } from '../../../src/chat-agent/scope';
import { listWorkspacesForUser, resolveArtifactAccessForUser } from '../../../src/chat-agent/access';
import { knowledgeGetTool, knowledgeSearchTool } from '../../../src/chat-agent/tools/knowledge';
import { queryConnectionTool, listConnectionsTool } from '../../../src/chat-agent/tools/connection-query';
import { catalogSearchTool } from '../../../src/chat-agent/tools/catalog';
import { runAgentTurn } from '../../../src/chat-agent/agent-loop';
import { WebThreadStore } from '../../../src/chat-agent/store/d1-threads';
import { setKnowledgeEnabled, upsertKnowledgeFile } from '../../../src/knowledge';
import type { ToolContext } from '../../../src/chat-agent/tools/types';
import type { FetchContext } from '../../../src/router/context';
import { routeHomeAgentApi } from '../../../src/router/api/home-agent';

const WS_A = 'wsp_scope_a';
const WS_B = 'wsp_scope_b';
const MEMBER = 'usr_scope_member';
const LINKED = 'usr_scope_linked';
const EXTERNAL = 'usr_scope_external';
const OTHER = 'usr_scope_other';
const SECRET = 'Renewal price for the client is 91k.';

const NODE = `---
kind: topic
id: topic.renewal
title: Renewal
topics: [renewal]
sources: []
pinned: false
---
${SECRET}`;

const ctx = (userId: string, selectedWorkspaceId: string | null): ToolContext => ({ env: e, userId, selectedWorkspaceId });

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name, identity_id) VALUES (?, 'member@example.com', 'm', 'idn_scope'), (?, 'linked@example.com', 'l', 'idn_scope'), (?, 'external@example.com', 'x', NULL), (?, 'other@example.com', 'o', NULL)")
      .bind(MEMBER, LINKED, EXTERNAL, OTHER),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'A', 'scope-a', ?), (?, 'B', 'scope-b', ?)")
      .bind(WS_A, MEMBER, WS_B, OTHER),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_scope_1', ?, ?, 'owner', 'internal'), ('wm_scope_2', ?, ?, 'member', 'external'), ('wm_scope_3', ?, ?, 'owner', 'internal')`)
      .bind(WS_A, MEMBER, WS_A, EXTERNAL, WS_B, OTHER),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id) VALUES ('art_scope_ws', ?, 'Team page', 'scope-team', 'workspace', ?)")
      .bind(MEMBER, WS_A),
    e.DB.prepare("INSERT INTO connections (id, scope_type, scope_id, name, provider, kind, agent_query_enabled) VALUES ('conn_scope_a', 'workspace', ?, 'wh', 'redshift', 'platform', 1)")
      .bind(WS_A),
  ]);
  await setKnowledgeEnabled(e, WS_A, true);
  await upsertKnowledgeFile(e, WS_A, { path: 'topics/renewal.md', content: NODE });
});

describe('resolveAgentScope', () => {
  it('scopes an internal member, including through a linked account', async () => {
    expect(await resolveAgentScope(e, MEMBER, WS_A)).toMatchObject({ workspaceId: WS_A, role: 'owner' });
    expect(await resolveAgentScope(e, LINKED, WS_A)).toMatchObject({ workspaceId: WS_A, role: 'owner' });
  });

  it('refuses another workspace id and an external member edge', async () => {
    expect(await resolveAgentScope(e, MEMBER, WS_B)).toBeNull();
    expect(await resolveAgentScope(e, EXTERNAL, WS_A)).toBeNull();
    expect(await resolveAgentScope(e, MEMBER, 'wsp_does_not_exist')).toBeNull();
  });

  it('personal and all-pages selections carry no workspace', async () => {
    expect(await resolveAgentScope(e, EXTERNAL, '__personal')).toMatchObject({ workspaceId: null });
    expect(await resolveAgentScope(e, EXTERNAL, null)).toMatchObject({ workspaceId: null });
  });

  it('a scope verified for one workspace does not carry over to another selection', async () => {
    const scope = (await resolveAgentScope(e, MEMBER, WS_A))!;
    expect(await scopedWorkspaceId({ env: e, userId: MEMBER, selectedWorkspaceId: WS_B, scope })).toBeNull();
    expect(await scopedWorkspaceId({ env: e, userId: MEMBER, selectedWorkspaceId: WS_A, scope })).toBe(WS_A);
  });
});

describe('knowledge tools', () => {
  it('give an internal member the node', async () => {
    const got = await knowledgeGetTool.execute(ctx(MEMBER, WS_A), { path: 'topics/renewal.md' });
    expect(JSON.stringify(got)).toContain(SECRET);
    const found = (await knowledgeSearchTool.execute(ctx(MEMBER, WS_A), { query: 'renewal' })) as { count: number };
    expect(found.count).toBe(1);
  });

  it.each([
    ['a member of another workspace', OTHER],
    ['an external member', EXTERNAL],
  ])('refuse %s with no data', async (_label, userId) => {
    for (const r of [
      await knowledgeGetTool.execute(ctx(userId, WS_A), { path: 'topics/renewal.md' }),
      await knowledgeGetTool.execute(ctx(userId, WS_A), { id: 'topic.renewal' }),
      await knowledgeSearchTool.execute(ctx(userId, WS_A), { query: 'renewal' }),
      await knowledgeSearchTool.execute(ctx(userId, WS_A), { query: '', kind: 'topic' }),
    ]) {
      expect(r).toEqual({ error: 'You are not a member of this workspace.' });
    }
  });
});

describe('other workspace tools', () => {
  it('refuse connectors and the catalog outside internal membership', async () => {
    for (const userId of [OTHER, EXTERNAL]) {
      expect(await listConnectionsTool.execute(ctx(userId, WS_A), {})).toHaveProperty('error');
      expect(await queryConnectionTool.execute(ctx(userId, WS_A), { connection: 'wh', sql: 'SELECT 1' })).toHaveProperty('error');
      expect(await catalogSearchTool.execute(ctx(userId, WS_A), { query: 'x' })).toHaveProperty('error');
    }
    expect(h.queryWorkspaceConnection).not.toHaveBeenCalled();
    const listed = (await listConnectionsTool.execute(ctx(MEMBER, WS_A), {})) as { connections: { name: string }[] };
    expect(listed.connections.map((c) => c.name)).toEqual(['wh']);
  });
});

describe('external member edges', () => {
  it('are not workspaces for the agent and grant no workspace-visible pages', async () => {
    expect((await listWorkspacesForUser(e, EXTERNAL)).map((w) => w.id)).toEqual([]);
    expect((await listWorkspacesForUser(e, LINKED)).map((w) => w.id)).toEqual([WS_A]);
    expect(await resolveArtifactAccessForUser(e, 'art_scope_ws', EXTERNAL)).toBeNull();
    expect(await resolveArtifactAccessForUser(e, 'art_scope_ws', OTHER)).toBeNull();
  });
});

describe('runAgentTurn', () => {
  it.each([
    ['another workspace id', MEMBER, WS_B],
    ['an external member', EXTERNAL, WS_A],
  ])('refuses %s before the model is called', async (_label, userId, ws) => {
    h.getCrewProvider.mockClear();
    const r = await runAgentTurn(e, { userId, platform: 'web', selectedWorkspaceId: ws, userText: 'what is the renewal price?', history: [], locale: 'en', workspaceContext: SECRET });
    expect(r.reply).toMatch(/not a member/);
    expect(r.proposal).toBeUndefined();
    expect(h.getCrewProvider).not.toHaveBeenCalled();
  });
});

describe('web threads', () => {
  it('belong to one scope and one user', async () => {
    const t = await new WebThreadStore(e, WS_A, MEMBER).create('hola');
    expect(await new WebThreadStore(e, WS_A, MEMBER).owns(t.id)).toBe(true);
    expect(await new WebThreadStore(e, WS_B, MEMBER).owns(t.id)).toBe(false);
    expect(await new WebThreadStore(e, WS_A, OTHER).owns(t.id)).toBe(false);
  });
});

describe('home assistant on a workspace host', () => {
  const call = (path: string, method = 'GET', body?: unknown) => {
    const url = new URL(`https://scope.example${path}`);
    const request = new Request(url, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
    return routeHomeAgentApi({ request, env: e, path: url.pathname, url, addCORS: (r: Response) => r } as unknown as FetchContext);
  };

  it.each([
    ['a member of another workspace', MEMBER, WS_B],
    ['an external member', EXTERNAL, WS_A],
  ])('is forbidden to %s', async (_label, userId, host) => {
    h.userId = userId;
    h.host = host;
    expect((await call('/v1/home/agent/threads'))!.status).toBe(403);
    expect((await call('/v1/home/agent/chat', 'POST', { text: 'hola' }))!.status).toBe(403);
  });

  it('serves an internal member', async () => {
    h.userId = MEMBER;
    h.host = WS_A;
    expect((await call('/v1/home/agent/threads'))!.status).toBe(200);
  });
});
