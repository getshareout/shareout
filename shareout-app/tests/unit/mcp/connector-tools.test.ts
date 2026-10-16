// Data connector tools over MCP: workspace membership gate, then the assistant's own
// tools (AI toggle, SQL guard, query limit) run as the person in that workspace.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/chat-agent/access', () => ({ listWorkspacesForUser: vi.fn() }));
const queryWorkspaceConnection = vi.fn();
// Treat the caller as an internal member of whatever workspace is selected; the
// membership gate itself is covered in chat-agent/workspace-scope.test.ts.
vi.mock('../../../src/chat-agent/scope', async (orig) => {
  const real = await orig<typeof import('../../../src/chat-agent/scope')>();
  return {
    ...real,
    resolveAgentScope: async (_e: unknown, _u: string, sel?: string | null) => ({ selection: sel ?? null, workspaceId: real.selectedWorkspace(sel), role: real.selectedWorkspace(sel) ? 'member' : null }),
    scopedWorkspaceId: async (c: { selectedWorkspaceId?: string | null }) => real.selectedWorkspace(c.selectedWorkspaceId),
  };
});
vi.mock('../../../src/data/connections/warehouse-query', async (orig) => ({
  ...(await orig<object>()),
  queryWorkspaceConnection: (...a: unknown[]) => queryWorkspaceConnection(...a),
}));
vi.mock('../../../src/rate-limit', async (orig) => ({
  ...(await orig<object>()),
  checkWebAgentQueryLimit: async () => ({ allowed: true }),
}));

import { callTool } from '../../../src/mcp/tools';
import { listWorkspacesForUser } from '../../../src/chat-agent/access';
import type { Env } from '../../../src/types';

const WS = { id: 'wsp_acme', name: 'Acme', slug: 'acme', role: 'member' as const, artifactCount: 0 };
const OTHER = { id: 'wsp_two', name: 'Two', slug: 'two', role: 'member' as const, artifactCount: 0 };

function envWith(conn: Record<string, unknown> | null): Env {
  const DB = {
    prepare: () => ({
      bind: () => ({
        first: async () => conn,
        all: async () => ({ results: [{ name: 'wh', provider: 'redshift', kind: 'platform', agent_query_enabled: 1 }] }),
      }),
    }),
  };
  return { DB } as unknown as Env;
}

const ctx = (env: Env) => ({ env, user: { id: 'usr_1', email: 'ana@example.com', username: null }, origin: 'https://shareout.test', authorization: 'Bearer so_x' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listWorkspacesForUser).mockResolvedValue([WS]);
});

describe('connector tools over MCP', () => {
  it('lists connectors in the person’s only workspace', async () => {
    const r = (await callTool(ctx(envWith(null)), 'list_connections', {}))!;
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ workspace_id: 'wsp_acme', connections: [{ name: 'wh', provider: 'redshift', queryable: true, files: false }] });
  });

  it('runs a guarded SELECT as the person in the named workspace', async () => {
    queryWorkspaceConnection.mockResolvedValue([{ region: 'EU', revenue: 10 }]);
    const r = (await callTool(ctx(envWith({ id: 'conn_wh', provider: 'redshift', config: '{}', agent_query_enabled: 1 })), 'query_connection', {
      workspace_id: 'acme', connection: 'wh', sql: 'select region, sum(revenue) revenue from sales group by 1;',
    }))!;
    expect(r.structuredContent).toMatchObject({ connection: 'wh', rowCount: 1, rows: [{ region: 'EU', revenue: 10 }] });
    expect(queryWorkspaceConnection).toHaveBeenCalledWith(
      expect.anything(), 'wsp_acme', expect.objectContaining({ id: 'conn_wh' }),
      'select region, sum(revenue) revenue from sales group by 1', expect.anything(), 'usr_1',
    );
  });

  it('refuses writes before reaching the warehouse', async () => {
    const r = (await callTool(ctx(envWith({ id: 'c', provider: 'redshift', config: '{}', agent_query_enabled: 1 })), 'query_connection', {
      connection: 'wh', sql: 'delete from sales',
    }))!;
    expect(r.structuredContent).toMatchObject({ error: expect.stringMatching(/SELECT/) });
    expect(queryWorkspaceConnection).not.toHaveBeenCalled();
  });

  it('respects the admin’s AI switch', async () => {
    const r = (await callTool(ctx(envWith({ id: 'c', provider: 'redshift', config: '{}', agent_query_enabled: 0 })), 'query_connection', {
      connection: 'wh', sql: 'select 1',
    }))!;
    expect(r.content[0].text).toMatch(/isn’t enabled/);
    expect(queryWorkspaceConnection).not.toHaveBeenCalled();
  });

  it('never reaches a workspace the person is not in, and asks when there are several', async () => {
    const env = envWith({ id: 'c', provider: 'redshift', config: '{}', agent_query_enabled: 1 });
    const notMember = (await callTool(ctx(env), 'query_connection', { workspace_id: 'wsp_other', connection: 'wh', sql: 'select 1' }))!;
    expect(notMember.isError).toBe(true);
    vi.mocked(listWorkspacesForUser).mockResolvedValue([WS, OTHER]);
    const ask = (await callTool(ctx(env), 'list_connections', {}))!;
    expect(ask.structuredContent).toMatchObject({ needs_workspace: true });
    expect(queryWorkspaceConnection).not.toHaveBeenCalled();
  });
});
