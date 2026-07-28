// @vitest-environment node
/**
 * Tables handler tests — handler validation.
 * Split from tables.test.ts (2026-07-21 large-file decomposition).
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleTables } from '../../../../src/data/tables';

import { createTablesDb, ctxFromDb, tablesRequest } from './shared';

describe('handleTables validation', () => {
  it('rejects invalid table names', async () => {
    const ctx = ctxFromDb(createTablesDb());

    const response = await handleTables(
      tablesRequest('/123bad', { method: 'POST', body: JSON.stringify({ name: 'x' }) }),
      ctx,
      '/123bad'
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'INVALID_TABLE_NAME',
    });
  });

  it('rejects table names that are too long', async () => {
    const ctx = ctxFromDb(createTablesDb());
    const longName = 'a' + 'b'.repeat(64);

    const response = await handleTables(
      tablesRequest(`/${longName}`, { method: 'POST', body: JSON.stringify({ value: 1 }) }),
      ctx,
      `/${longName}`
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'INVALID_TABLE_NAME',
    });
  });

  it('requires a table name for non-GET requests at the root path', async () => {
    const ctx = ctxFromDb(createTablesDb());

    const response = await handleTables(
      tablesRequest('/', { method: 'POST', body: '{}' }),
      ctx,
      '/'
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'MISSING_PARAM',
      param: 'tableName',
    });
  });

  it('rejects invalid JSON bodies', async () => {
    const db = createTablesDb({
      tables: [{ id: 'tbl_existing', artifact_id: 'art_1', name: 'users', row_count: 0 }],
    });
    const ctx = ctxFromDb(db);

    const response = await handleTables(
      tablesRequest('/users', { method: 'POST', body: 'not-json' }),
      ctx,
      '/users'
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'INVALID_JSON',
    });
  });
});

