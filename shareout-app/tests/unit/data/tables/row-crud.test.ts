// @vitest-environment node
/**
 * Tables handler tests — row crud.
 * Split from tables.test.ts (2026-07-21 large-file decomposition).
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleTables } from '../../../../src/data/tables';

import { createTablesDb, ctxFromDb, tablesRequest } from './shared';

describe('handleTables row CRUD', () => {
  it('inserts, reads, updates, and deletes a row by id', async () => {
    const db = createTablesDb({
      tables: [{ id: 'tbl_users', artifact_id: 'art_1', name: 'users', row_count: 0 }],
    });
    const ctx = ctxFromDb(db);

    const insert = await handleTables(
      tablesRequest('/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'Alice', status: 'active' }),
      }),
      ctx,
      '/users'
    );
    expect(insert.status).toBe(201);
    const inserted = (await insert.json()).data.inserted[0];

    const get = await handleTables(tablesRequest(`/users/${inserted.id}`), ctx, `/users/${inserted.id}`);
    expect(get.status).toBe(200);
    await expect(get.json()).resolves.toMatchObject({
      success: true,
      data: { id: inserted.id, name: 'Alice', status: 'active' },
    });

    const patch = await handleTables(
      tablesRequest(`/users/${inserted.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'inactive' }),
      }),
      ctx,
      `/users/${inserted.id}`
    );
    expect(patch.status).toBe(200);
    await expect(patch.json()).resolves.toMatchObject({
      success: true,
      data: { id: inserted.id, name: 'Alice', status: 'inactive' },
    });

    const del = await handleTables(
      tablesRequest(`/users/${inserted.id}`, { method: 'DELETE' }),
      ctx,
      `/users/${inserted.id}`
    );
    expect(del.status).toBe(200);
    await expect(del.json()).resolves.toMatchObject({
      success: true,
      data: { deleted: true },
    });
  });

  it('inserts multiple rows in one request', async () => {
    const db = createTablesDb({
      tables: [{ id: 'tbl_users', artifact_id: 'art_1', name: 'users', row_count: 0 }],
    });
    const ctx = ctxFromDb(db);

    const response = await handleTables(
      tablesRequest('/users', {
        method: 'POST',
        body: JSON.stringify({
          rows: [
            { name: 'Alice', status: 'active' },
            { name: 'Bob', status: 'active' },
          ],
        }),
      }),
      ctx,
      '/users'
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { count: 2 },
    });
    expect(db._state.rows).toHaveLength(2);
  });

  it('returns row not found for missing ids', async () => {
    const db = createTablesDb({
      tables: [{ id: 'tbl_users', artifact_id: 'art_1', name: 'users', row_count: 0 }],
    });
    const ctx = ctxFromDb(db);

    const get = await handleTables(
      tablesRequest('/users/row_missing', { method: 'GET' }),
      ctx,
      '/users/row_missing'
    );
    expect(get.status).toBe(404);
    await expect(get.json()).resolves.toMatchObject({
      success: false,
      code: 'ROW_NOT_FOUND',
    });

    const patch = await handleTables(
      tablesRequest('/users/row_missing', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'x' }),
      }),
      ctx,
      '/users/row_missing'
    );
    expect(patch.status).toBe(404);

    const del = await handleTables(
      tablesRequest('/users/row_missing', { method: 'DELETE' }),
      ctx,
      '/users/row_missing'
    );
    expect(del.status).toBe(404);
  });

  it('rejects patch updates that exceed row size', async () => {
    const db = createTablesDb({
      tables: [{ id: 'tbl_users', artifact_id: 'art_1', name: 'users', row_count: 1 }],
      rows: [{
        id: 'row_1',
        table_id: 'tbl_users',
        data: { id: 'row_1', name: 'Alice', createdAt: 't', updatedAt: 't' },
      }],
    });
    const ctx = ctxFromDb(db);

    const response = await handleTables(
      tablesRequest('/users/row_1', {
        method: 'PATCH',
        body: JSON.stringify({ blob: 'x'.repeat(100_001) }),
      }),
      ctx,
      '/users/row_1'
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'ROW_TOO_LARGE',
    });
  });

  it('bulk updates and deletes rows by filter', async () => {
    const db = createTablesDb({
      tables: [{ id: 'tbl_users', artifact_id: 'art_1', name: 'users', row_count: 2 }],
      rows: [
        {
          id: 'row_1',
          table_id: 'tbl_users',
          data: { id: 'row_1', name: 'Alice', status: 'active', createdAt: 't', updatedAt: 't' },
        },
        {
          id: 'row_2',
          table_id: 'tbl_users',
          data: { id: 'row_2', name: 'Bob', status: 'active', createdAt: 't', updatedAt: 't' },
        },
      ],
    });
    const ctx = ctxFromDb(db);

    const patch = await handleTables(
      tablesRequest('/users', {
        method: 'PATCH',
        body: JSON.stringify({
          filter: { status: 'active' },
          changes: { status: 'archived' },
        }),
      }),
      ctx,
      '/users'
    );
    expect(patch.status).toBe(200);
    await expect(patch.json()).resolves.toMatchObject({
      success: true,
      data: { updated: 2 },
    });

    const del = await handleTables(
      tablesRequest('/users', {
        method: 'DELETE',
        body: JSON.stringify({ filter: { status: 'archived' } }),
      }),
      ctx,
      '/users'
    );
    expect(del.status).toBe(200);
    await expect(del.json()).resolves.toMatchObject({
      success: true,
      data: { deleted: 2 },
    });
    expect(db._state.rows).toHaveLength(0);
  });

  it('drops a table when confirm=true', async () => {
    const db = createTablesDb({
      tables: [{ id: 'tbl_users', artifact_id: 'art_1', name: 'users', row_count: 1 }],
      rows: [{
        id: 'row_1',
        table_id: 'tbl_users',
        data: { id: 'row_1', name: 'Alice' },
      }],
    });
    const ctx = ctxFromDb(db);

    const response = await handleTables(
      tablesRequest('/users?confirm=true', { method: 'DELETE' }),
      ctx,
      '/users'
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { dropped: true, rowsDeleted: 1 },
    });
    expect(db._state.tables).toHaveLength(0);
    expect(db._state.rows).toHaveLength(0);
  });

  it('rejects drop for a row-scoped viewer (cross-tenant wipe guard)', async () => {
    const db = createTablesDb({
      tables: [{ id: 'tbl_users', artifact_id: 'art_1', name: 'users', row_count: 2 }],
      rows: [
        { id: 'row_a', table_id: 'tbl_users', data: { id: 'row_a', tenant: 'A' } },
        { id: 'row_b', table_id: 'tbl_users', data: { id: 'row_b', tenant: 'B' } },
      ],
    });
    const ctx = { ...ctxFromDb(db), viewerScope: { field: 'tenant', values: ['A'] } };

    const response = await handleTables(
      tablesRequest('/users?confirm=true', { method: 'DELETE' }),
      ctx,
      '/users'
    );

    expect(response.status).toBe(403);
    expect(db._state.tables).toHaveLength(1);
    expect(db._state.rows).toHaveLength(2);
  });
});

