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

import { browseStorageTool, listConnectionsTool } from '../../../src/chat-agent/tools/connection-query';
import { CONNECTOR_TOOLS } from '../../../src/chat-agent/tools/index';
import type { ToolContext } from '../../../src/chat-agent/tools/types';

const ROWS = [
  { name: 'exports', provider: 's3', kind: 'platform', agent_query_enabled: 1 },
  { name: 'wh', provider: 'redshift', kind: 'platform', agent_query_enabled: 1 },
  { name: 'sb', provider: 'supabase', kind: 'platform', agent_query_enabled: 0 },
  { name: 'shop', provider: 'shopify', kind: 'platform', agent_query_enabled: 1 },
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
  it('registers browse_storage alongside the SQL tools', () => {
    expect(CONNECTOR_TOOLS.map((t) => t.name)).toEqual(['list_connections', 'query_connection', 'browse_storage']);
  });

  it('list_connections marks SQL providers queryable and S3 as files, only when enabled', async () => {
    const out = await listConnectionsTool.execute(ctx(), {}) as { connections: unknown[] };
    expect(out.connections).toEqual([
      { name: 'exports', provider: 's3', queryable: false, files: true },
      { name: 'wh', provider: 'redshift', queryable: true, files: false },
      { name: 'sb', provider: 'supabase', queryable: false, files: false },
      { name: 'shop', provider: 'shopify', queryable: false, files: false },
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
