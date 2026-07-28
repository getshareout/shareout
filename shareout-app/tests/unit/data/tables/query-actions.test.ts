// @vitest-environment node
/**
 * Tables handler tests — query actions.
 * Split from tables.test.ts (2026-07-21 large-file decomposition).
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleTables } from '../../../../src/data/tables';

import { createTablesDb, ctxFromDb, tablesRequest } from './shared';

describe('handleTables query actions', () => {
  const seed = {
    tables: [{ id: 'tbl_users', artifact_id: 'art_1', name: 'users', row_count: 2 }],
    rows: [
      {
        id: 'row_1',
        table_id: 'tbl_users',
        data: { id: 'row_1', name: 'Alice', status: 'active', score: 10, createdAt: 'a', updatedAt: 'a' },
      },
      {
        id: 'row_2',
        table_id: 'tbl_users',
        data: { id: 'row_2', name: 'Bob', status: 'inactive', score: 20, createdAt: 'b', updatedAt: 'b' },
      },
    ],
  };

  it('queries rows with filter, sort, select, and pagination', async () => {
    const ctx = ctxFromDb(createTablesDb(seed));

    const response = await handleTables(
      tablesRequest('/users/query', {
        method: 'POST',
        body: JSON.stringify({
          filter: { status: 'active' },
          sort: { score: 'desc' },
          select: ['name', 'status'],
          limit: 10,
          skip: 0,
        }),
      }),
      ctx,
      '/users/query'
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        rows: [{ name: 'Alice', status: 'active' }],
        total: 1,
        hasMore: false,
      },
    });
  });

  it('counts rows and returns distinct values', async () => {
    const ctx = ctxFromDb(createTablesDb(seed));

    const count = await handleTables(
      tablesRequest('/users/count', {
        method: 'POST',
        body: JSON.stringify({ filter: { status: 'active' } }),
      }),
      ctx,
      '/users/count'
    );
    expect(count.status).toBe(200);
    await expect(count.json()).resolves.toMatchObject({
      success: true,
      data: { count: 1 },
    });

    const distinct = await handleTables(
      tablesRequest('/users/distinct', {
        method: 'POST',
        body: JSON.stringify({ field: 'status' }),
      }),
      ctx,
      '/users/distinct'
    );
    expect(distinct.status).toBe(200);
    await expect(distinct.json()).resolves.toMatchObject({
      success: true,
      data: { values: ['active', 'inactive'] },
    });
  });

  it('supports advanced filter operators in query and count', async () => {
    const ctx = ctxFromDb(createTablesDb({
      tables: [{ id: 'tbl_users', artifact_id: 'art_1', name: 'users', row_count: 3 }],
      rows: [
        {
          id: 'row_1',
          table_id: 'tbl_users',
          data: { id: 'row_1', role: 'admin', score: 5, note: 'hello world', createdAt: 'a', updatedAt: 'a' },
        },
        {
          id: 'row_2',
          table_id: 'tbl_users',
          data: { id: 'row_2', role: 'viewer', score: 15, note: 'goodbye', createdAt: 'b', updatedAt: 'b' },
        },
        {
          id: 'row_3',
          table_id: 'tbl_users',
          data: { id: 'row_3', role: null, score: 25, note: 'hell', createdAt: 'c', updatedAt: 'c' },
        },
      ],
    }));

    const query = await handleTables(
      tablesRequest('/users/query', {
        method: 'POST',
        body: JSON.stringify({
          filter: {
            score: { $gte: 10 },
            role: { $ne: 'admin' },
            note: { $contains: 'ell' },
          },
          limit: 1000,
        }),
      }),
      ctx,
      '/users/query'
    );
    expect(query.status).toBe(200);
    await expect(query.json()).resolves.toMatchObject({
      success: true,
      data: { total: 1 },
    });

    const nullFilter = await handleTables(
      tablesRequest('/users/count', {
        method: 'POST',
        body: JSON.stringify({ filter: { role: null } }),
      }),
      ctx,
      '/users/count'
    );
    expect(nullFilter.status).toBe(200);
    await expect(nullFilter.json()).resolves.toMatchObject({
      success: true,
      data: { count: 1 },
    });

    const inFilter = await handleTables(
      tablesRequest('/users/count', {
        method: 'POST',
        body: JSON.stringify({ filter: { role: { $in: ['admin', 'viewer'] } } }),
      }),
      ctx,
      '/users/count'
    );
    expect(inFilter.status).toBe(200);
    await expect(inFilter.json()).resolves.toMatchObject({
      success: true,
      data: { count: 2 },
    });

    const prefixFilter = await handleTables(
      tablesRequest('/users/count', {
        method: 'POST',
        body: JSON.stringify({ filter: { note: { $startsWith: 'good' } } }),
      }),
      ctx,
      '/users/count'
    );
    expect(prefixFilter.status).toBe(200);
    await expect(prefixFilter.json()).resolves.toMatchObject({
      success: true,
      data: { count: 1 },
    });

    const ninFilter = await handleTables(
      tablesRequest('/users/count', {
        method: 'POST',
        body: JSON.stringify({ filter: { role: { $nin: ['admin'] } } }),
      }),
      ctx,
      '/users/count'
    );
    expect(ninFilter.status).toBe(200);
    await expect(ninFilter.json()).resolves.toMatchObject({
      success: true,
      data: { count: 2 },
    });

    const endsWithFilter = await handleTables(
      tablesRequest('/users/query', {
        method: 'POST',
        body: JSON.stringify({
          filter: { note: { $endsWith: 'world' } },
          limit: 1000,
        }),
      }),
      ctx,
      '/users/query'
    );
    expect(endsWithFilter.status).toBe(200);
    await expect(endsWithFilter.json()).resolves.toMatchObject({
      success: true,
      data: { total: 1, rows: [{ note: 'hello world' }] },
    });

    const eqFilter = await handleTables(
      tablesRequest('/users/count', {
        method: 'POST',
        body: JSON.stringify({ filter: { score: { $eq: 15 } } }),
      }),
      ctx,
      '/users/count'
    );
    expect(eqFilter.status).toBe(200);
    await expect(eqFilter.json()).resolves.toMatchObject({
      success: true,
      data: { count: 1 },
    });

    const gtFilter = await handleTables(
      tablesRequest('/users/count', {
        method: 'POST',
        body: JSON.stringify({ filter: { score: { $gt: 10 } } }),
      }),
      ctx,
      '/users/count'
    );
    expect(gtFilter.status).toBe(200);
    await expect(gtFilter.json()).resolves.toMatchObject({
      success: true,
      data: { count: 2 },
    });

    const ltFilter = await handleTables(
      tablesRequest('/users/count', {
        method: 'POST',
        body: JSON.stringify({ filter: { score: { $lt: 20 } } }),
      }),
      ctx,
      '/users/count'
    );
    expect(ltFilter.status).toBe(200);
    await expect(ltFilter.json()).resolves.toMatchObject({
      success: true,
      data: { count: 2 },
    });

    const lteFilter = await handleTables(
      tablesRequest('/users/count', {
        method: 'POST',
        body: JSON.stringify({ filter: { score: { $lte: 5 } } }),
      }),
      ctx,
      '/users/count'
    );
    expect(lteFilter.status).toBe(200);
    await expect(lteFilter.json()).resolves.toMatchObject({
      success: true,
      data: { count: 1 },
    });
  });

  it('requires field for distinct and POST for actions', async () => {
    const ctx = ctxFromDb(createTablesDb(seed));

    const missingField = await handleTables(
      tablesRequest('/users/distinct', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      ctx,
      '/users/distinct'
    );
    expect(missingField.status).toBe(400);
    await expect(missingField.json()).resolves.toMatchObject({
      success: false,
      code: 'MISSING_PARAM',
      param: 'field',
    });

    const wrongMethod = await handleTables(
      tablesRequest('/users/query', { method: 'GET' }),
      ctx,
      '/users/query'
    );
    expect(wrongMethod.status).toBe(405);
    await expect(wrongMethod.json()).resolves.toMatchObject({
      success: false,
      code: 'METHOD_NOT_ALLOWED',
    });
  });
});

