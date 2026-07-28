import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeRequestMock = vi.fn();
const getEndpointMock = vi.fn((id: string) => ({ id, method: id === 'jobs.query' ? 'POST' : 'POST', path: '/x' }));

vi.mock('../../../../src/data/platform/registry', () => ({
  getProvider: (id: string) => {
    if (id !== 'snowflake' && id !== 'bigquery') return undefined;
    return { getEndpoint: getEndpointMock, executeRequest: executeRequestMock };
  },
}));

import { executeWarehouseQuery } from '../../../../src/data/connections/warehouse-exec';

const env = {} as never;

function rejectionMessage(p: Promise<unknown>): Promise<string> {
  return p.then(() => '', (e) => (e instanceof Error ? e.message : String(e)));
}

beforeEach(() => {
  executeRequestMock.mockReset();
  getEndpointMock.mockClear();
});

describe('executeWarehouseQuery', () => {
  it('runs a Snowflake statement and coerces cells by rowType', async () => {
    executeRequestMock.mockResolvedValue({
      success: true,
      data: {
        resultSetMetaData: { rowType: [{ name: 'D', type: 'text' }, { name: 'N', type: 'fixed' }, { name: 'OK', type: 'boolean' }] },
        data: [['2026-06-26', '42', 'true'], ['2026-06-27', null, 'false']],
      },
    });

    const rows = await executeWarehouseQuery(env, 'snowflake', { account: 'ACME' }, { extra: { private_key: 'pk' } }, 'SELECT 1', {});

    expect(rows).toEqual([
      { D: '2026-06-26', N: 42, OK: true },
      { D: '2026-06-27', N: null, OK: false },
    ]);
    const [ctx, endpoint, params] = executeRequestMock.mock.calls[0];
    expect(endpoint.id).toBe('statements.execute');
    expect((params.body as { statement: string }).statement).toBe('SELECT 1');
    expect(ctx.connectionConfig.config).toEqual({ account: 'ACME' });
  });

  it('passes inline credentials through `extra` and surfaces access_token', async () => {
    executeRequestMock.mockResolvedValue({ success: true, data: { data: [] } });
    await executeWarehouseQuery(env, 'snowflake', {}, { access_token: 'tok', user: 'u' }, 'SELECT 1', {});
    const ctx = executeRequestMock.mock.calls[0][0];
    expect(ctx.credentials.access_token).toBe('tok');
    expect(ctx.credentials.extra).toEqual({ access_token: 'tok', user: 'u' });
  });

  it('runs a BigQuery job with projectId from config and coerces by schema', async () => {
    executeRequestMock.mockResolvedValue({
      success: true,
      data: {
        schema: { fields: [{ name: 'brand', type: 'STRING' }, { name: 'rev', type: 'FLOAT' }] },
        rows: [{ f: [{ v: 'Northwind' }, { v: '100.5' }] }],
      },
    });

    const rows = await executeWarehouseQuery(env, 'bigquery', { project: 'analytics-platform' }, null, 'SELECT 1', {});

    expect(rows).toEqual([{ brand: 'Northwind', rev: 100.5 }]);
    const params = executeRequestMock.mock.calls[0][2];
    expect(params.pathParams.projectId).toBe('analytics-platform');
  });

  it('requires a projectId for BigQuery when config has none', async () => {
    expect(await rejectionMessage(executeWarehouseQuery(env, 'bigquery', {}, null, 'SELECT 1', {}))).toMatch(/projectId/);
    expect(executeRequestMock).not.toHaveBeenCalled();
  });

  it('throws a clear error when the provider call fails', async () => {
    executeRequestMock.mockResolvedValue({ success: false, error: { message: 'SNOWFLAKE_JWT_ERROR: bad key' } });
    expect(await rejectionMessage(executeWarehouseQuery(env, 'snowflake', {}, {}, 'SELECT 1', {}))).toMatch(/bad key/);
  });
});
