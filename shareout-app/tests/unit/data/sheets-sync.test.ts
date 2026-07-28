// @vitest-environment node
import './sheets-test-setup';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as auth from '../../../src/auth';
import { decryptCredentials } from '../../../src/data/connections/credentials';
import * as googleAuth from '../../../src/data/sheets/google-auth';
import { handleSheets, handleSheetsOAuthCallback } from '../../../src/data/sheets/handler';
import {
  createSheetsDbState,
  makeSheetsTestEnv,
  sampleSheetConnection,
  SHEETS_TEST_ARTIFACT_ID,
  SHEETS_TEST_BASE_URL,
  SHEETS_TEST_SPREADSHEET_ID,
} from './sheets-mock-db';
import {
  ARTIFACT_ID,
  BASE_URL,
  makeSheetsCtx,
  mockFetchRouter,
  ownerAuthHeaders,
  SHEETS_TEST_USER_ID as USER_ID,
  sheetsRequest,
  SPREADSHEET_ID,
  storeArtifactToken,
} from './sheets-test-helpers';

const createDbState = createSheetsDbState;
const makeSheetsEnv = makeSheetsTestEnv;
const makeCtx = makeSheetsCtx;
const sampleConnection = sampleSheetConnection;

describe('import and export sync', () => {
  beforeEach(() => {
    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: USER_ID, email: 'user@example.com' });
    vi.mocked(googleAuth.getValidAccessToken).mockResolvedValue('user-google-token');
  });

  it('rejects import/export without login or Google connection', async () => {
    vi.mocked(auth.getSessionUser).mockResolvedValue(null);
    const env = makeSheetsEnv(createDbState({ connections: [sampleConnection] }));
    const ctx = makeCtx(env);
    const headers = await ownerAuthHeaders(env);

    const importUnauthorized = await handleSheets(
      sheetsRequest('import/sales', { method: 'POST', headers }),
      ctx,
      'import/sales',
    );
    expect(importUnauthorized.status).toBe(401);

    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: USER_ID, email: 'user@example.com' });
    vi.mocked(googleAuth.getValidAccessToken).mockResolvedValue(null);

    const noGoogle = await handleSheets(
      sheetsRequest('import/sales', { method: 'POST', headers }),
      ctx,
      'import/sales',
    );
    expect(noGoogle.status).toBe(401);
    await expect(noGoogle.json()).resolves.toMatchObject({ code: 'GOOGLE_NOT_CONNECTED' });
  });

  it('imports sheet rows into artifact tables', async () => {
    const state = createDbState({ connections: [{ ...sampleConnection }] });
    const env = makeSheetsEnv(state);
    const ctx = makeCtx(env);

    mockFetchRouter({
      '/values/': () => ({
        ok: true,
        json: async () => ({
          values: [
            ['Item', 'Count', 'Price'],
            ['Apple', '3', '1.5'],
            ['Banana', '2', 'true'],
          ],
        }),
      }),
    });

    const response = await handleSheets(
      sheetsRequest('import/sales', { method: 'POST', headers: await ownerAuthHeaders(env) }),
      ctx,
      'import/sales',
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { imported: number; columns: string[] } };
    expect(body.data.imported).toBe(2);
    expect(body.data.columns).toEqual(['Item', 'Count', 'Price']);
    expect(state.rows).toHaveLength(2);
    expect(state.tables).toHaveLength(1);
  });

  it('handles empty imports, missing connections, and API failures', async () => {
    const state = createDbState({ connections: [{ ...sampleConnection }] });
    const env = makeSheetsEnv(state);
    const ctx = makeCtx(env);
    const headers = await ownerAuthHeaders(env);

    const missingConn = await handleSheets(
      sheetsRequest('import/missing', { method: 'POST', headers }),
      ctx,
      'import/missing',
    );
    expect(missingConn.status).toBe(404);

    mockFetchRouter({
      '/values/': () => ({ ok: true, json: async () => ({ values: [] }) }),
    });
    const empty = await handleSheets(
      sheetsRequest('import/sales', { method: 'POST', headers }),
      ctx,
      'import/sales',
    );
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({ data: { imported: 0 } });

    mockFetchRouter({
      '/values/': () => ({ ok: false, status: 500, text: 'import failed' }),
    });
    const failed = await handleSheets(
      sheetsRequest('import/sales', { method: 'POST', headers }),
      ctx,
      'import/sales',
    );
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toMatchObject({ code: 'SHEETS_UPSTREAM_ERROR' });
  });

  it('maps import upstream failures without leaking response body', async () => {
    const state = createDbState({ connections: [{ ...sampleConnection }] });
    const env = makeSheetsEnv(state);
    const ctx = makeCtx(env);
    const headers = await ownerAuthHeaders(env);

    mockFetchRouter({
      '/values/': () => ({
        ok: false,
        status: 500,
        text: 'secret_google_token=abc123 internal_error_detail',
      }),
    });
    const response = await handleSheets(
      sheetsRequest('import/sales', { method: 'POST', headers }),
      ctx,
      'import/sales',
    );
    expect(response.status).toBe(502);
    const body = await response.json() as { code: string; error: string };
    expect(body).toMatchObject({
      code: 'SHEETS_UPSTREAM_ERROR',
      error: 'Google Sheets is unavailable (HTTP 500)',
    });
    expect(body.error).not.toContain('secret_google_token');
    expect(body.error).not.toContain('internal_error_detail');
  });

  it('handles unexpected import failures without leaking internal error text', async () => {
    const state = createDbState({ connections: [{ ...sampleConnection }] });
    const env = makeSheetsEnv(state);
    const ctx = makeCtx(env);
    const headers = await ownerAuthHeaders(env);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('D1_ERROR: no such table: artifact_rows');
      }),
    );

    const response = await handleSheets(
      sheetsRequest('import/sales', { method: 'POST', headers }),
      ctx,
      'import/sales',
    );
    expect(response.status).toBe(500);
    const body = await response.json() as { code: string; error: string };
    expect(body).toMatchObject({
      code: 'IMPORT_ERROR',
      error: 'Failed to import sheet data',
    });
    expect(body.error).not.toContain('D1_ERROR');
  });

  it('exports artifact table rows to Google Sheets', async () => {
    const state = createDbState({
      connections: [{ ...sampleConnection, sync_direction: 'export' }],
      tables: [{ id: 'tbl_1', artifact_id: ARTIFACT_ID, name: 'sales_data' }],
      rows: [
        {
          id: 'row_1',
          table_id: 'tbl_1',
          data: JSON.stringify({ id: 'row_1', name: 'Apple', qty: 3, createdAt: 't', updatedAt: 't' }),
        },
        {
          id: 'row_2',
          table_id: 'tbl_1',
          data: JSON.stringify({ id: 'row_2', name: 'Banana', qty: null, meta: { fresh: true }, createdAt: 't', updatedAt: 't' }),
        },
      ],
    });
    const env = makeSheetsEnv(state);
    const ctx = makeCtx(env);

    mockFetchRouter({
      '/values/': () => ({ ok: true, json: async () => ({ updatedCells: 4 }) }),
    });

    const response = await handleSheets(
      sheetsRequest('export/sales', { method: 'POST', headers: await ownerAuthHeaders(env) }),
      ctx,
      'export/sales',
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { exported: number; columns: string[] } };
    expect(body.data.exported).toBe(2);
    expect(body.data.columns.sort()).toEqual(['meta', 'name', 'qty']);
  });

  it('handles export edge cases and failures', async () => {
    const state = createDbState({ connections: [{ ...sampleConnection }] });
    const env = makeSheetsEnv(state);
    const ctx = makeCtx(env);
    const headers = await ownerAuthHeaders(env);

    const missingConn = await handleSheets(
      sheetsRequest('export/missing', { method: 'POST', headers }),
      ctx,
      'export/missing',
    );
    expect(missingConn.status).toBe(404);

    const noTable = await handleSheets(
      sheetsRequest('export/sales', { method: 'POST', headers }),
      ctx,
      'export/sales',
    );
    expect(noTable.status).toBe(200);
    await expect(noTable.json()).resolves.toMatchObject({ data: { exported: 0, message: 'Table not found' } });

    state.tables.push({ id: 'tbl_1', artifact_id: ARTIFACT_ID, name: 'sales_data' });
    const emptyTable = await handleSheets(
      sheetsRequest('export/sales', { method: 'POST', headers }),
      ctx,
      'export/sales',
    );
    expect(emptyTable.status).toBe(200);
    await expect(emptyTable.json()).resolves.toMatchObject({ data: { exported: 0, message: 'Table is empty' } });

    state.rows.push({
      id: 'row_1',
      table_id: 'tbl_1',
      data: JSON.stringify({ id: 'row_1', value: 1, createdAt: 't', updatedAt: 't' }),
    });
    mockFetchRouter({
      '/values/': () => ({ ok: false, status: 500, text: 'export failed' }),
    });
    const failed = await handleSheets(
      sheetsRequest('export/sales', { method: 'POST', headers }),
      ctx,
      'export/sales',
    );
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toMatchObject({ code: 'SHEETS_UPSTREAM_ERROR' });
  });

  it('maps export upstream failures without leaking response body', async () => {
    const state = createDbState({ connections: [{ ...sampleConnection }] });
    const env = makeSheetsEnv(state);
    const ctx = makeCtx(env);
    const headers = await ownerAuthHeaders(env);

    state.tables.push({ id: 'tbl_1', artifact_id: ARTIFACT_ID, name: 'sales_data' });
    state.rows.push({
      id: 'row_1',
      table_id: 'tbl_1',
      data: JSON.stringify({ id: 'row_1', value: 1, createdAt: 't', updatedAt: 't' }),
    });

    mockFetchRouter({
      '/values/': () => ({
        ok: false,
        status: 403,
        text: 'The caller does not have permission secret-project',
      }),
    });
    const response = await handleSheets(
      sheetsRequest('export/sales', { method: 'POST', headers }),
      ctx,
      'export/sales',
    );
    expect(response.status).toBe(403);
    const body = await response.json() as { code: string; error: string };
    expect(body).toMatchObject({
      code: 'SHEETS_ACCESS_DENIED',
      error: 'Access denied. Ensure the sheet is shared with the authorized account.',
    });
    expect(body.error).not.toContain('secret-project');
  });

  it('handles unexpected export failures without leaking internal error text', async () => {
    const state = createDbState({ connections: [{ ...sampleConnection }] });
    const env = makeSheetsEnv(state);
    const ctx = makeCtx(env);
    const headers = await ownerAuthHeaders(env);

    state.tables.push({ id: 'tbl_1', artifact_id: ARTIFACT_ID, name: 'sales_data' });
    state.rows.push({
      id: 'row_1',
      table_id: 'tbl_1',
      data: JSON.stringify({ id: 'row_1', value: 1, createdAt: 't', updatedAt: 't' }),
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('D1_ERROR: no such table: artifact_rows');
      }),
    );

    const response = await handleSheets(
      sheetsRequest('export/sales', { method: 'POST', headers }),
      ctx,
      'export/sales',
    );
    expect(response.status).toBe(500);
    const body = await response.json() as { code: string; error: string };
    expect(body).toMatchObject({
      code: 'EXPORT_ERROR',
      error: 'Failed to export sheet data',
    });
    expect(body.error).not.toContain('D1_ERROR');
  });
});
