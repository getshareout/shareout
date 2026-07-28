// @vitest-environment node
/**
 * Tables handler tests — list schema.
 * Split from tables.test.ts (2026-07-21 large-file decomposition).
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleTables } from '../../../../src/data/tables';

import { createTablesDb, ctxFromDb, tablesRequest } from './shared';

describe('handleTables list and schema', () => {
  it('lists tables for the artifact', async () => {
    const db = createTablesDb({
      tables: [
        { id: 'tbl_b', artifact_id: 'art_1', name: 'orders', row_count: 3 },
        { id: 'tbl_a', artifact_id: 'art_1', name: 'users', row_count: 2 },
      ],
    });
    const ctx = ctxFromDb(db);

    const response = await handleTables(tablesRequest('/'), ctx, '/');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        tables: [
          { name: 'orders', rowCount: 3 },
          { name: 'users', rowCount: 2 },
        ],
      },
    });
  });

  it('creates a table lazily on first write', async () => {
    const db = createTablesDb();
    const ctx = ctxFromDb(db);

    const response = await handleTables(
      tablesRequest('/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'Alice', status: 'active' }),
      }),
      ctx,
      '/users'
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { count: 1 },
    });
    expect(db._state.tables).toHaveLength(1);
    expect(db._state.tables[0].name).toBe('users');
  });

  it('returns table limit exceeded when creating a new table', async () => {
    const db = createTablesDb({ tableCountOverride: 50 });
    const ctx = ctxFromDb(db);

    const response = await handleTables(
      tablesRequest('/new_table', {
        method: 'POST',
        body: JSON.stringify({ value: 1 }),
      }),
      ctx,
      '/new_table'
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'TABLE_LIMIT_EXCEEDED',
    });
  });
});

