import { describe, it, expect, vi, beforeEach } from 'vitest';

const execMock = vi.fn();
vi.mock('../../../src/data/platform', () => ({
  PlatformEngine: class {
    execute(...args: unknown[]) { return execMock(...args); }
  },
}));

const queryConnectionDataMock = vi.fn();
vi.mock('../../../src/data/connections/handler', () => ({
  queryConnectionData: (...args: unknown[]) => queryConnectionDataMock(...args),
}));

import { queryConnectionAny } from '../../../src/data/connections/warehouse-query';

function envWith(platformRow: unknown) {
  const db = {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => {
          if (sql.includes('workspace_id FROM artifacts')) return { workspace_id: 'wsp_1' };
          if (sql.includes("kind = 'platform'")) return platformRow;
          return null;
        },
      }),
    }),
  };
  return { DB: db } as never;
}

beforeEach(() => {
  execMock.mockReset();
  queryConnectionDataMock.mockReset();
});

/** Run the promise and return its rejection message. `.catch` attaches synchronously
 *  so the workers pool never sees a transient unhandled rejection. */
function rejectionMessage(p: Promise<unknown>): Promise<string> {
  return p.then(() => '', (e) => (e instanceof Error ? e.message : String(e)));
}

describe('queryConnectionAny', () => {
  it('routes a BigQuery platform connection through PlatformEngine and coerces cells by schema type', async () => {
    execMock.mockResolvedValue({
      success: true,
      data: {
        schema: { fields: [{ name: 'brand', type: 'STRING' }, { name: 'rev', type: 'FLOAT' }, { name: 'dau', type: 'INTEGER' }, { name: 'live', type: 'BOOLEAN' }] },
        rows: [{ f: [{ v: 'Northwind' }, { v: '100.5' }, { v: '37598' }, { v: 'true' }] }, { f: [{ v: 'Northwind' }, { v: null }, { v: '0' }, { v: 'false' }] }],
      },
    });
    const env = envWith({ id: 'conn_bq', provider: 'bigquery', config: JSON.stringify({ project: 'analytics-platform' }) });

    const rows = await queryConnectionAny(env, 'art_1', 'bigquery', 'SELECT 1', {}, 'usr_owner');

    expect(rows).toEqual([
      { brand: 'Northwind', rev: 100.5, dau: 37598, live: true },
      { brand: 'Northwind', rev: null, dau: 0, live: false },
    ]);
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(queryConnectionDataMock).not.toHaveBeenCalled();
  });

  it('requires projectId when the BigQuery connection config has none', async () => {
    const env = envWith({ id: 'conn_bq', provider: 'bigquery', config: '{}' });
    expect(await rejectionMessage(queryConnectionAny(env, 'art_1', 'bigquery', 'SELECT 1', {}, 'u'))).toMatch(/projectId/);
  });

  it('throws a clear error when BigQuery itself fails', async () => {
    execMock.mockResolvedValue({ success: false, error: { message: 'D1_ERROR: no such table' } });
    const env = envWith({ id: 'c', provider: 'bigquery', config: JSON.stringify({ project: 'p' }) });
    expect(await rejectionMessage(queryConnectionAny(env, 'art_1', 'bigquery', 'SELECT 1', {}, 'u'))).toMatch(/no such table/);
  });

  it('falls back to the generic REST path when no platform connection matches', async () => {
    queryConnectionDataMock.mockResolvedValue({ ok: true });
    const env = envWith(null);

    const out = await queryConnectionAny(env, 'art_1', 'rest', 'GET /x', undefined, 'u');

    expect(out).toEqual({ ok: true });
    expect(queryConnectionDataMock).toHaveBeenCalledWith(env, 'art_1', 'rest', 'GET /x', undefined, 'u');
    expect(execMock).not.toHaveBeenCalled();
  });

  it('routes a Snowflake platform connection through PlatformEngine and coerces cells by rowType', async () => {
    execMock.mockResolvedValue({
      success: true,
      data: {
        resultSetMetaData: {
          rowType: [
            { name: 'D', type: 'text' },
            { name: 'EVENTS', type: 'fixed' },
            { name: 'LOAD', type: 'real' },
            { name: 'OK', type: 'boolean' },
          ],
        },
        data: [
          ['2026-06-18', '122021', '1.25', 'true'],
          ['2026-06-19', '20550', null, 'false'],
        ],
      },
    });
    const env = envWith({ id: 'conn_sf', provider: 'snowflake', config: JSON.stringify({ account: 'FXVVFWJ-DNA83679' }) });

    const rows = await queryConnectionAny(env, 'art_1', 'acme_snowflake', 'SELECT 1', {}, 'usr_owner');

    expect(rows).toEqual([
      { D: '2026-06-18', EVENTS: 122021, LOAD: 1.25, OK: true },
      { D: '2026-06-19', EVENTS: 20550, LOAD: null, OK: false },
    ]);
    const call = execMock.mock.calls[0][0];
    expect(call.provider).toBe('snowflake');
    expect(call.endpoint).toBe('statements.execute');
    expect(call.params.body.statement).toBe('SELECT 1');
    expect(queryConnectionDataMock).not.toHaveBeenCalled();
  });

  it('throws a clear error when Snowflake itself fails', async () => {
    execMock.mockResolvedValue({ success: false, error: { message: 'SNOWFLAKE_ERROR: invalid identifier' } });
    const env = envWith({ id: 'c', provider: 'snowflake', config: '{}' });
    expect(await rejectionMessage(queryConnectionAny(env, 'art_1', 'sf', 'SELECT 1', {}, 'u'))).toMatch(/invalid identifier/);
  });

  it('rejects an unsupported platform provider with a clear message', async () => {
    const env = envWith({ id: 'c', provider: 'shopify', config: '{}' });
    expect(await rejectionMessage(queryConnectionAny(env, 'art_1', 'shop', 'SELECT 1', {}, 'u'))).toMatch(/not yet supported/);
  });
});
