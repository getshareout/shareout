// @vitest-environment node
/**
 * Tables handler tests — query count opt out.
 * Split from tables.test.ts (2026-07-21 large-file decomposition).
 */
import './mocks';
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleTables } from '../../../../src/data/tables';

import { createTablesDb, ctxFromDb, tablesRequest } from './shared';

describe('handleTables query count opt-out (opt-013)', () => {
  function seedRows(n: number) {
    return {
      tables: [{ id: 'tbl_users', artifact_id: 'art_1', name: 'users', row_count: n }],
      rows: Array.from({ length: n }, (_, i) => ({
        id: `row_${i}`,
        table_id: 'tbl_users',
        data: { id: `row_${i}`, status: 'open', createdAt: String(i).padStart(4, '0'), updatedAt: 'a' },
      })),
    };
  }

  function batchSqls(db: ReturnType<typeof createTablesDb>): string[] {
    return (db.batch as ReturnType<typeof vi.fn>).mock.calls
      .flatMap((call) => (call[0] as Array<{ sql: string }>).map((s) => s.sql));
  }

  function prepareSqls(db: ReturnType<typeof createTablesDb>): string[] {
    return (db.prepare as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string);
  }

  it('count:false returns the page and a correct hasMore without issuing COUNT(*)', async () => {
    const db = createTablesDb(seedRows(5));
    const batchSpy = vi.spyOn(db, 'batch');
    const ctx = ctxFromDb(db);

    const response = await handleTables(
      tablesRequest('/users/query', {
        method: 'POST',
        body: JSON.stringify({ filter: { status: 'open' }, sort: { createdAt: 'asc' }, limit: 3, count: false }),
      }),
      ctx,
      '/users/query'
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: { rows: unknown[]; total?: number; hasMore: boolean } };
    expect(json.data.rows).toHaveLength(3);
    expect(json.data.hasMore).toBe(true);
    expect(json.data.total).toBeUndefined();
    expect(batchSpy).not.toHaveBeenCalled();
    expect(prepareSqls(db).some((s) => s.includes('COUNT(*)'))).toBe(false);
  });

  it('count:false trims the limit+1 probe row (never leaks it)', async () => {
    const ctx = ctxFromDb(createTablesDb(seedRows(10)));

    const exact = await handleTables(
      tablesRequest('/users/query', {
        method: 'POST',
        body: JSON.stringify({ limit: 10, count: false }),
      }),
      ctx,
      '/users/query'
    );
    await expect(exact.json()).resolves.toMatchObject({ data: { rows: expect.any(Array), hasMore: false } });
    const exactJson = (await (await handleTables(
      tablesRequest('/users/query', { method: 'POST', body: JSON.stringify({ limit: 10, count: false }) }),
      ctx,
      '/users/query'
    )).json()) as { data: { rows: unknown[]; hasMore: boolean } };
    expect(exactJson.data.rows).toHaveLength(10);
    expect(exactJson.data.hasMore).toBe(false);

    const partial = (await (await handleTables(
      tablesRequest('/users/query', { method: 'POST', body: JSON.stringify({ limit: 9, count: false }) }),
      ctx,
      '/users/query'
    )).json()) as { data: { rows: unknown[]; hasMore: boolean } };
    expect(partial.data.rows).toHaveLength(9);
    expect(partial.data.hasMore).toBe(true);
  });

  it('default (count omitted) still returns an exact total via COUNT(*)', async () => {
    const db = createTablesDb(seedRows(5));
    const batchSpy = vi.spyOn(db, 'batch');
    const ctx = ctxFromDb(db);

    const response = await handleTables(
      tablesRequest('/users/query', {
        method: 'POST',
        body: JSON.stringify({ filter: { status: 'open' }, limit: 3 }),
      }),
      ctx,
      '/users/query'
    );

    await expect(response.json()).resolves.toMatchObject({ data: { total: 5, hasMore: true } });
    expect(batchSpy).toHaveBeenCalled();
    expect(batchSqls(db).some((s) => s.includes('COUNT(*) as total'))).toBe(true);
  });
});

