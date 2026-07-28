// @vitest-environment node
/**
 * Tables handler tests — row limits.
 * Split from tables.test.ts (2026-07-21 large-file decomposition).
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleTables } from '../../../../src/data/tables';

import { createTablesDb, ctxFromDb, tablesRequest } from './shared';

describe('handleTables row limits', () => {
  it('rejects inserts that exceed the row limit', async () => {
    const db = createTablesDb({
      tables: [{ id: 'tbl_users', artifact_id: 'art_1', name: 'users', row_count: 100_000 }],
    });
    const ctx = ctxFromDb(db);

    const response = await handleTables(
      tablesRequest('/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'Overflow' }),
      }),
      ctx,
      '/users'
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'ROW_LIMIT_EXCEEDED',
    });
  });

  it('rejects rows that exceed the size limit', async () => {
    const db = createTablesDb({
      tables: [{ id: 'tbl_users', artifact_id: 'art_1', name: 'users', row_count: 0 }],
    });
    const ctx = ctxFromDb(db);

    const response = await handleTables(
      tablesRequest('/users', {
        method: 'POST',
        body: JSON.stringify({ blob: 'x'.repeat(100_001) }),
      }),
      ctx,
      '/users'
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'ROW_TOO_LARGE',
    });
  });
});

