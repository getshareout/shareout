// @vitest-environment node
/**
 * Tables handler tests — method guards.
 * Split from tables.test.ts (2026-07-21 large-file decomposition).
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleTables } from '../../../../src/data/tables';

import { createTablesDb, ctxFromDb, tablesRequest } from './shared';

describe('handleTables method guards', () => {
  it('rejects unsupported methods on row and table routes', async () => {
    const db = createTablesDb({
      tables: [{ id: 'tbl_users', artifact_id: 'art_1', name: 'users', row_count: 0 }],
    });
    const ctx = ctxFromDb(db);

    const rowMethod = await handleTables(
      tablesRequest('/users/row_1', { method: 'POST' }),
      ctx,
      '/users/row_1'
    );
    expect(rowMethod.status).toBe(405);

    const tableMethod = await handleTables(
      tablesRequest('/users', { method: 'GET' }),
      ctx,
      '/users'
    );
    expect(tableMethod.status).toBe(405);
  });
});

