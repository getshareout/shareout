import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DataSourcesManager,
  extractRows,
} from '../src/stores/dashboards/managers/data-sources-manager';
import type { DataSource } from '../src/stores/dashboards/types';
import type { SdkClient } from '../src/core/sdk-client';
import type { RealtimeDoc } from '../src/stores/realtime-doc';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('extractRows', () => {
  it('returns arrays as-is', () => {
    expect(extractRows([{ a: 1 }])).toEqual([{ a: 1 }]);
  });

  it('unwraps common envelopes', () => {
    expect(extractRows({ data: [{ id: 1 }] })).toEqual([{ id: 1 }]);
    expect(extractRows({ rows: [{ id: 2 }] })).toEqual([{ id: 2 }]);
    expect(extractRows({ results: [{ id: 3 }] })).toEqual([{ id: 3 }]);
  });

  it('wraps a single object', () => {
    expect(extractRows({ id: 9 })).toEqual([{ id: 9 }]);
  });

  it('handles null/undefined', () => {
    expect(extractRows(null)).toEqual([]);
    expect(extractRows(undefined)).toEqual([]);
  });
});

function mockDoc(sources: Record<string, DataSource>): RealtimeDoc {
  const store = { ...sources };
  return {
    map: () => ({
      toJSON: () => store,
      get: (id: string) => store[id],
      set: (id: string, value: DataSource) => {
        store[id] = value;
      },
      has: (id: string) => id in store,
      delete: (id: string) => {
        delete store[id];
      },
    }),
  } as unknown as RealtimeDoc;
}

describe('DataSourcesManager.refresh', () => {
  it('unwraps connection.query QueryResult for sql sources', async () => {
    const rows = [
      { region: 'East', revenue: 100 },
      { region: 'West', revenue: 50 },
    ];
    const query = vi.fn(async () => ({
      data: rows,
      cached: false,
      executionTimeMs: 12,
    }));
    const sdk = {
      connection: vi.fn(() => ({ query })),
      table: vi.fn(),
    } as unknown as SdkClient;

    const source: DataSource = {
      id: 'ds-sql',
      name: 'warehouse',
      type: 'sql',
      config: { connectionId: 'bq', query: 'SELECT 1' },
    };
    const mgr = new DataSourcesManager(mockDoc({ 'ds-sql': source }), sdk, 'dash_1');
    await mgr.refresh('ds-sql');

    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(mgr.getData('ds-sql')).toEqual(rows);
  });

  it('unwraps nested data envelopes from sql results', async () => {
    const query = vi.fn(async () => ({
      data: { rows: [{ x: 1 }] },
      cached: true,
      executionTimeMs: 0,
    }));
    const sdk = {
      connection: () => ({ query }),
    } as unknown as SdkClient;
    const source: DataSource = {
      id: 'ds-sql',
      name: 'api',
      type: 'sql',
      config: { connectionId: 'rest', query: '/metrics' },
    };
    const mgr = new DataSourcesManager(mockDoc({ 'ds-sql': source }), sdk, 'dash_1');
    await mgr.refresh('ds-sql');
    expect(mgr.getData('ds-sql')).toEqual([{ x: 1 }]);
  });

  it('loads shareout table rows', async () => {
    const exec = vi.fn(async () => [{ id: 'row_1' }]);
    const sdk = {
      table: vi.fn(() => ({
        find: () => ({ limit: () => ({ exec }) }),
      })),
    } as unknown as SdkClient;
    const source: DataSource = {
      id: 'ds-tbl',
      name: 'tasks',
      type: 'shareout',
      config: { tableId: 'tasks' },
    };
    const mgr = new DataSourcesManager(mockDoc({ 'ds-tbl': source }), sdk, 'dash_1');
    await mgr.refresh('ds-tbl');
    expect(mgr.getData('ds-tbl')).toEqual([{ id: 'row_1' }]);
    expect(mgr.isTruncated('ds-tbl')).toBe(false);
  });

  it('marks shareout sources truncated at the 1000-row table cap', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `row_${i}` }));
    const exec = vi.fn(async () => rows);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sdk = {
      table: vi.fn(() => ({
        find: () => ({ limit: (n: number) => {
          expect(n).toBe(1000);
          return { exec };
        } }),
      })),
    } as unknown as SdkClient;
    const source: DataSource = {
      id: 'ds-big',
      name: 'big_table',
      type: 'shareout',
      config: { tableId: 'events' },
    };
    const mgr = new DataSourcesManager(mockDoc({ 'ds-big': source }), sdk, 'dash_1');
    await mgr.refresh('ds-big');
    expect(mgr.getData('ds-big')).toHaveLength(1000);
    expect(mgr.isTruncated('ds-big')).toBe(true);
    expect(mgr.get('ds-big')?.lastWarning).toMatch(/1000-row/);
    expect(warn).toHaveBeenCalled();
  });

  it('loads dataset sources via sdk.dataset().get()', async () => {
    const get = vi.fn(async () => [{ sku: 'A' }, { sku: 'B' }]);
    const sdk = {
      dataset: vi.fn(() => ({ get, page: vi.fn() })),
    } as unknown as SdkClient;
    const source: DataSource = {
      id: 'ds-extract',
      name: 'Shipments',
      type: 'dataset',
      config: { datasetName: 'shipments' },
    };
    const mgr = new DataSourcesManager(mockDoc({ 'ds-extract': source }), sdk, 'dash_1');
    await mgr.refresh('ds-extract');
    expect(sdk.dataset).toHaveBeenCalledWith('shipments');
    expect(get).toHaveBeenCalled();
    expect(mgr.getData('ds-extract')).toEqual([{ sku: 'A' }, { sku: 'B' }]);
    expect(mgr.isTruncated('ds-extract')).toBe(false);
  });

  it('pages dataset sources when config.limit is set and flags truncation', async () => {
    const page = vi.fn(async () => ({
      data: [{ id: 1 }, { id: 2 }],
      total: 50,
      offset: 0,
      limit: 2,
      hasMore: true,
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sdk = {
      dataset: vi.fn(() => ({ get: vi.fn(), page })),
    } as unknown as SdkClient;
    const source: DataSource = {
      id: 'ds-page',
      name: 'paged',
      type: 'dataset',
      config: { datasetName: 'big', limit: 2 },
    };
    const mgr = new DataSourcesManager(mockDoc({ 'ds-page': source }), sdk, 'dash_1');
    await mgr.refresh('ds-page');
    expect(page).toHaveBeenCalledWith({ offset: 0, limit: 2 });
    expect(mgr.getData('ds-page')).toHaveLength(2);
    expect(mgr.isTruncated('ds-page')).toBe(true);
    expect(mgr.get('ds-page')?.lastWarning).toMatch(/first 2 of 50/);
    expect(warn).toHaveBeenCalled();
  });
});
