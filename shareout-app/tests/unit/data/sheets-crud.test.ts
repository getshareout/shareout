// @vitest-environment node
import './sheets-test-setup';
import { describe, expect, it, vi } from 'vitest';
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

describe('handleSheets routing', () => {
  it('returns 404 for unknown routes', async () => {
    const env = makeSheetsEnv();
    const ctx = makeCtx(env);
    const response = await handleSheets(
      sheetsRequest('unknown/action', { method: 'PATCH' }),
      ctx,
      'unknown/action',
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('connection CRUD', () => {
  it('lists sheet connections for owners', async () => {
    const state = createDbState({ connections: [sampleConnection] });
    const env = makeSheetsEnv(state);
    const ctx = makeCtx(env);
    const response = await handleSheets(
      sheetsRequest('', { method: 'GET', headers: await ownerAuthHeaders(env) }),
      ctx,
      '',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { count: number; connections: Array<{ name: string }> } };
    expect(body.data.count).toBe(1);
    expect(body.data.connections[0].name).toBe('sales');
  });

  it('returns 403 when listing connections without owner auth', async () => {
    const env = makeSheetsEnv();
    const ctx = makeCtx(env);
    const response = await handleSheets(sheetsRequest('', { method: 'GET' }), ctx, '');
    expect(response.status).toBe(403);
  });

  it('creates a sheet connection with validation', async () => {
    const state = createDbState();
    const env = makeSheetsEnv(state);
    const ctx = makeCtx(env);

    const badJson = await handleSheets(
      sheetsRequest('', {
        method: 'POST',
        headers: await ownerAuthHeaders(env),
        body: 'not-json',
      }),
      ctx,
      '',
    );
    expect(badJson.status).toBe(400);

    const badName = await handleSheets(
      sheetsRequest('', {
        method: 'POST',
        headers: await ownerAuthHeaders(env),
        body: JSON.stringify({
          name: 'bad name!',
          spreadsheetId: SPREADSHEET_ID,
          targetTable: 'sales_data',
        }),
      }),
      ctx,
      '',
    );
    expect(badName.status).toBe(400);

    const missingSpreadsheet = await handleSheets(
      sheetsRequest('', {
        method: 'POST',
        headers: await ownerAuthHeaders(env),
        body: JSON.stringify({ name: 'sales', targetTable: 'sales_data' }),
      }),
      ctx,
      '',
    );
    expect(missingSpreadsheet.status).toBe(400);

    const badTable = await handleSheets(
      sheetsRequest('', {
        method: 'POST',
        headers: await ownerAuthHeaders(env),
        body: JSON.stringify({
          name: 'sales',
          spreadsheetId: SPREADSHEET_ID,
          targetTable: 'bad table',
        }),
      }),
      ctx,
      '',
    );
    expect(badTable.status).toBe(400);

    state.connections.push({ ...sampleConnection });
    const conflict = await handleSheets(
      sheetsRequest('', {
        method: 'POST',
        headers: await ownerAuthHeaders(env),
        body: JSON.stringify({
          name: 'sales',
          spreadsheetId: SPREADSHEET_ID,
          targetTable: 'sales_data',
        }),
      }),
      ctx,
      '',
    );
    expect(conflict.status).toBe(409);

    const response = await handleSheets(
      sheetsRequest('', {
        method: 'POST',
        headers: await ownerAuthHeaders(env),
        body: JSON.stringify({
          name: 'inventory',
          spreadsheetId: SPREADSHEET_ID,
          sheetName: 'Sheet1',
          targetTable: 'inventory_data',
          syncDirection: 'export',
          syncSchedule: '0 * * * *',
        }),
      }),
      ctx,
      '',
    );
    expect(response.status).toBe(201);
    const body = await response.json() as { data: { name: string; syncDirection: string } };
    expect(body.data.name).toBe('inventory');
    expect(body.data.syncDirection).toBe('export');
    expect(state.connections).toHaveLength(2);
  });

  it('gets and deletes a connection by name', async () => {
    const state = createDbState({ connections: [{ ...sampleConnection }] });
    const env = makeSheetsEnv(state);
    const ctx = makeCtx(env);
    const headers = await ownerAuthHeaders(env);

    const missing = await handleSheets(
      sheetsRequest('missing', { method: 'GET', headers }),
      ctx,
      'missing',
    );
    expect(missing.status).toBe(404);

    const get = await handleSheets(
      sheetsRequest('sales', { method: 'GET', headers }),
      ctx,
      'sales',
    );
    expect(get.status).toBe(200);
    const getBody = await get.json() as { data: { spreadsheetId: string } };
    expect(getBody.data.spreadsheetId).toBe(SPREADSHEET_ID);

    const delMissing = await handleSheets(
      sheetsRequest('missing', { method: 'DELETE', headers }),
      ctx,
      'missing',
    );
    expect(delMissing.status).toBe(404);

    const del = await handleSheets(
      sheetsRequest('sales', { method: 'DELETE', headers }),
      ctx,
      'sales',
    );
    expect(del.status).toBe(200);
    expect(state.connections).toHaveLength(0);
  });
});
