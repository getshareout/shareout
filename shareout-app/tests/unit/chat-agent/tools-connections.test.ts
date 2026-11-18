// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execMock = vi.fn();
vi.mock('../../../src/data/platform', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  PlatformEngine: class {
    execute(...args: unknown[]) { return execMock(...args); }
  },
}));
vi.mock('../../../src/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  checkWebAgentQueryLimit: async () => ({ allowed: true }),
}));

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
import { browseStorageTool, fitToBudget, listConnectionsTool, readConnectorTool } from '../../../src/chat-agent/tools/connection-query';
import { CONNECTOR_TOOLS } from '../../../src/chat-agent/tools/index';
import type { ToolContext } from '../../../src/chat-agent/tools/types';

const ROWS = [
  { name: 'exports', provider: 's3', kind: 'platform', agent_query_enabled: 1 },
  { name: 'wh', provider: 'redshift', kind: 'platform', agent_query_enabled: 1 },
  { name: 'sb', provider: 'supabase', kind: 'platform', agent_query_enabled: 0 },
  { name: 'shop', provider: 'shopify', kind: 'platform', agent_query_enabled: 1 },
  { name: 'people', provider: 'humand', kind: 'platform', agent_query_enabled: 1 },
  { name: 'people-off', provider: 'humand', kind: 'platform', agent_query_enabled: 0 },
];

function ctx(conn: Record<string, unknown> | null = { id: 'conn_s3', provider: 's3', agent_query_enabled: 1 }): ToolContext {
  const DB = {
    prepare: (_sql: string) => ({
      bind: () => ({
        first: async () => conn,
        all: async () => ({ results: ROWS }),
      }),
    }),
  };
  return { env: { DB } as never, userId: 'usr_1', selectedWorkspaceId: 'wsp_1' };
}

beforeEach(() => execMock.mockReset());

describe('connector agent tools', () => {
  it('registers browse_storage and read_connector alongside the SQL tools', () => {
    expect(CONNECTOR_TOOLS.map((t) => t.name)).toEqual(['list_connections', 'query_connection', 'browse_storage', 'read_connector']);
  });

  it('list_connections marks SQL providers queryable, S3 as files and Humand readable, only when enabled', async () => {
    const out = await listConnectionsTool.execute(ctx(), {}) as { connections: unknown[] };
    expect(out.connections).toEqual([
      { name: 'exports', provider: 's3', queryable: false, files: true, readable: false },
      { name: 'wh', provider: 'redshift', queryable: true, files: false, readable: false },
      { name: 'sb', provider: 'supabase', queryable: false, files: false, readable: false },
      { name: 'shop', provider: 'shopify', queryable: false, files: false, readable: false },
      { name: 'people', provider: 'humand', queryable: false, files: false, readable: true },
      { name: 'people-off', provider: 'humand', queryable: false, files: false, readable: false },
    ]);
  });

  it('browse_storage reads a file through the engine and caps rows', async () => {
    execMock.mockResolvedValue({ success: true, data: { key: 'a.csv', format: 'csv', rows: Array.from({ length: 1500 }, (_, i) => ({ i })) } });
    const out = await browseStorageTool.execute(ctx(), { connection: 'exports', action: 'read', key: 'a.csv' }) as { rows: unknown[]; truncated: boolean };
    expect(execMock).toHaveBeenCalledWith(expect.objectContaining({ provider: 's3', endpoint: 'objects.get', connectionId: 'conn_s3', params: { queryParams: { key: 'a.csv' } } }));
    expect(out.rows).toHaveLength(1000);
    expect(out.truncated).toBe(true);
  });

  it('browse_storage lists a prefix', async () => {
    execMock.mockResolvedValue({ success: true, data: { objects: [], prefixes: ['x/'] } });
    await browseStorageTool.execute(ctx(), { connection: 'exports', action: 'list', prefix: 'x/' });
    expect(execMock).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'objects.list', params: { queryParams: { prefix: 'x/' } } }));
  });

  it('browse_storage refuses disabled, missing and non-S3 connectors', async () => {
    expect(await browseStorageTool.execute(ctx({ id: 'c', provider: 's3', agent_query_enabled: 0 }), { connection: 'exports', action: 'list' }))
      .toMatchObject({ error: expect.stringContaining('isn’t enabled') });
    expect(await browseStorageTool.execute(ctx({ id: 'c', provider: 'redshift', agent_query_enabled: 1 }), { connection: 'wh', action: 'list' }))
      .toMatchObject({ error: expect.stringContaining('No storage connector') });
    expect(await browseStorageTool.execute(ctx(null), { connection: 'nope', action: 'list' }))
      .toMatchObject({ error: expect.stringContaining('No storage connector') });
    expect(execMock).not.toHaveBeenCalled();
  });
});

describe('read_connector (app connectors such as Humand)', () => {
  const HUMAND = { id: 'conn_hd', provider: 'humand', agent_query_enabled: 1 };

  it('lists what the connector can read when no endpoint is given, without calling it', async () => {
    const out = await readConnectorTool.execute(ctx(HUMAND), { connection: 'people' }) as { endpoints: Array<{ id: string; path_params: string[]; paged: boolean }> };
    expect(out.endpoints.length).toBeGreaterThan(30);
    expect(out.endpoints.find((e) => e.id === 'users.list')).toMatchObject({ path_params: [], paged: true });
    expect(out.endpoints.find((e) => e.id === 'departments.members')).toMatchObject({ path_params: ['id'] });
    expect(execMock).not.toHaveBeenCalled();
  });

  it('reads one endpoint through the engine with only primitive query/path values', async () => {
    execMock.mockResolvedValue({ success: true, data: { count: 766, users: [{ id: 1 }] }, pagination: { hasMore: true, cursor: '2', total: 766 } });
    const out = await readConnectorTool.execute(ctx(HUMAND), {
      connection: 'people', endpoint: 'users.list',
      query: { page: 1, limit: 100, search: 'ana', nested: { x: 1 }, list: [1] },
      path: { id: 3, bad: { y: 1 } },
    });
    expect(execMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'humand', endpoint: 'users.list', connectionId: 'conn_hd',
      params: { queryParams: { page: 1, limit: 100, search: 'ana' }, pathParams: { id: 3 } },
    }));
    expect(out).toEqual({ connection: 'people', endpoint: 'users.list', data: { count: 766, users: [{ id: 1 }] }, total: 766, next_page: '2' });
  });

  it('refuses write or unknown endpoints, disabled connectors and non-app connectors before calling anything', async () => {
    expect(await readConnectorTool.execute(ctx(HUMAND), { connection: 'people', endpoint: 'users.create' }))
      .toMatchObject({ error: expect.stringContaining('isn’t something people can read') });
    expect(await readConnectorTool.execute(ctx({ ...HUMAND, agent_query_enabled: 0 }), { connection: 'people', endpoint: 'users.list' }))
      .toMatchObject({ error: expect.stringContaining('isn’t enabled') });
    expect(await readConnectorTool.execute(ctx({ id: 'c', provider: 'shopify', agent_query_enabled: 1 }), { connection: 'shop', endpoint: 'orders.list' }))
      .toMatchObject({ error: expect.stringContaining('No app connector') });
    expect(await readConnectorTool.execute(ctx(null), { connection: 'nope' }))
      .toMatchObject({ error: expect.stringContaining('No app connector') });
    expect(execMock).not.toHaveBeenCalled();
  });

  it('passes the connector error through', async () => {
    execMock.mockResolvedValue({ success: false, error: { message: 'Humand rejected the request: employeeId should not be null or undefined' } });
    expect(await readConnectorTool.execute(ctx(HUMAND), { connection: 'people', endpoint: 'timeTracking.entries' }))
      .toEqual({ error: 'Humand rejected the request: employeeId should not be null or undefined' });
  });

  it('cuts a big answer to fit by halving the longest list', async () => {
    const users = Array.from({ length: 400 }, (_, i) => ({ id: i, bio: 'x'.repeat(300) }));
    execMock.mockResolvedValue({ success: true, data: { count: 400, users } });
    const out = await readConnectorTool.execute(ctx(HUMAND), { connection: 'people', endpoint: 'users.list' }) as { data: { count: number; users: unknown[] }; truncated: string };
    expect(out.data.count).toBe(400);
    expect(out.data.users.length).toBeLessThan(400);
    expect(JSON.stringify(out.data).length).toBeLessThanOrEqual(50_000);
    expect(out.truncated).toMatch(/^Showing \d+ of 400 items/);
    expect(fitToBudget([1, 2, 3])).toEqual({ data: [1, 2, 3] });
    expect(fitToBudget({ text: 'y'.repeat(100) }, 50).truncated).toMatch(/cut to fit/);
  });
});
