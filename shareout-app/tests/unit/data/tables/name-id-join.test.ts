// @vitest-environment node
/**
 * Tables handler tests — name id join.
 * Split from tables.test.ts (2026-07-21 large-file decomposition).
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleTables } from '../../../../src/data/tables';

import { createTablesDb, ctxFromDb, tablesRequest } from './shared';

describe('handleTables opt-012 name→id JOIN', () => {
  function preResolveCalls(db: ReturnType<typeof createTablesDb>): string[] {
    const calls = (db.prepare as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    return calls
      .map((c) => c[0] as string)
      .filter((s) => typeof s === 'string' && s.startsWith('SELECT id FROM artifact_tables'));
  }

  it('resolves the table name inside the row SQL — no separate name→id round-trip', async () => {
    const db = createTablesDb({
      tables: [{ id: 'tbl_users', artifact_id: 'art_1', name: 'users', row_count: 1 }],
      rows: [{
        id: 'row_1',
        table_id: 'tbl_users',
        data: { id: 'row_1', name: 'Alice', status: 'active', createdAt: 'a', updatedAt: 'a' },
      }],
    });
    const ctx = ctxFromDb(db);

    await handleTables(tablesRequest('/users/query', { method: 'POST', body: JSON.stringify({ filter: { status: 'active' } }) }), ctx, '/users/query');
    await handleTables(tablesRequest('/users/count', { method: 'POST', body: '{}' }), ctx, '/users/count');
    await handleTables(tablesRequest('/users/distinct', { method: 'POST', body: JSON.stringify({ field: 'status' }) }), ctx, '/users/distinct');
    await handleTables(tablesRequest('/users/row_1', { method: 'GET' }), ctx, '/users/row_1');

    expect(preResolveCalls(db)).toHaveLength(0);
  });

  it('reads never create a table (no write-on-read)', async () => {
    const db = createTablesDb();
    const ctx = ctxFromDb(db);

    const query = await handleTables(tablesRequest('/ghost/query', { method: 'POST', body: '{}' }), ctx, '/ghost/query');
    expect(query.status).toBe(200);
    await expect(query.json()).resolves.toMatchObject({ success: true, data: { rows: [], total: 0, hasMore: false } });

    const count = await handleTables(tablesRequest('/ghost/count', { method: 'POST', body: '{}' }), ctx, '/ghost/count');
    expect(count.status).toBe(200);
    await expect(count.json()).resolves.toMatchObject({ success: true, data: { count: 0 } });

    const get = await handleTables(tablesRequest('/ghost/row_x', { method: 'GET' }), ctx, '/ghost/row_x');
    expect(get.status).toBe(404);

    expect(db._state.tables).toHaveLength(0);
    expect(db._state.rows).toHaveLength(0);
  });
});

