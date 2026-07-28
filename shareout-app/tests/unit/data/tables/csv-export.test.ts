// @vitest-environment node
/**
 * Tables handler tests — csv export.
 * Split from tables.test.ts (2026-07-21 large-file decomposition).
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleTables } from '../../../../src/data/tables';

import { createTablesDb, ctxFromDb, tablesRequest } from './shared';

describe('handleTables CSV export', () => {
  it('exports rows as downloadable CSV', async () => {
    const db = createTablesDb({
      tables: [{ id: 'tbl_proj', artifact_id: 'art_1', name: 'projections', row_count: 2 }],
      rows: [
        { id: 'row_1', table_id: 'tbl_proj', data: { id: 'row_1', year: 2026, age: 36, grossIncome: 90000 } },
        { id: 'row_2', table_id: 'tbl_proj', data: { id: 'row_2', year: 2027, age: 37, grossIncome: 92000 } },
      ],
    });
    const ctx = ctxFromDb(db);

    const response = await handleTables(
      tablesRequest('/projections/export?sort=year:asc&filename=test.csv', { method: 'GET' }),
      ctx,
      '/projections/export'
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    expect(response.headers.get('Content-Disposition')).toContain('test.csv');
    const body = await response.text();
    expect(body).toContain('year');
    expect(body).toContain('2026');
    expect(body).toContain('2027');
  });

  it('returns 404 when table is empty', async () => {
    const db = createTablesDb({
      tables: [{ id: 'tbl_proj', artifact_id: 'art_1', name: 'projections', row_count: 0 }],
    });
    const ctx = ctxFromDb(db);

    const response = await handleTables(
      tablesRequest('/projections/export', { method: 'GET' }),
      ctx,
      '/projections/export'
    );

    expect(response.status).toBe(404);
  });
});

