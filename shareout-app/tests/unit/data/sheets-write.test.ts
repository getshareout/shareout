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

describe('updateSheetData and appendSheetData', () => {
  it('requires owner auth for writes', async () => {
    const env = makeSheetsEnv();
    const ctx = makeCtx(env);

    const update = await handleSheets(
      sheetsRequest('update', {
        method: 'POST',
        body: JSON.stringify({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Sheet1!A1',
          values: [['x']],
        }),
      }),
      ctx,
      'update',
    );
    expect(update.status).toBe(403);

    const append = await handleSheets(
      sheetsRequest('append', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID, values: [['y']] }),
      }),
      ctx,
      'append',
    );
    expect(append.status).toBe(403);
  });

  it('updates and appends sheet values when connected', async () => {
    const state = createDbState();
    const env = makeSheetsEnv(state);
    await storeArtifactToken(state, env);
    const ctx = makeCtx(env);
    const headers = await ownerAuthHeaders(env);

    mockFetchRouter({
      '/values/': (_init) => {
        if (_init?.method === 'PUT') {
          return {
            ok: true,
            json: async () => ({ updatedCells: 2, updatedRows: 1, updatedColumns: 2 }),
          };
        }
        if (_init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ updates: { updatedCells: 1, updatedRows: 1 } }),
          };
        }
        return { ok: true, json: async () => ({}) };
      },
    });

    const update = await handleSheets(
      sheetsRequest('update', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`,
          range: 'Sheet1!A1:B1',
          values: [['a', 'b']],
        }),
      }),
      ctx,
      'update',
    );
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({ data: { updated: true, updatedCells: 2 } });

    const append = await handleSheets(
      sheetsRequest('append', {
        method: 'POST',
        headers,
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID, values: [['c', 'd']] }),
      }),
      ctx,
      'append',
    );
    expect(append.status).toBe(200);
    await expect(append.json()).resolves.toMatchObject({ data: { appended: true, appendedRows: 1 } });
  });

  it('returns validation and API errors for write operations', async () => {
    const state = createDbState();
    const env = makeSheetsEnv(state);
    await storeArtifactToken(state, env);
    const ctx = makeCtx(env);
    const headers = await ownerAuthHeaders(env);

    const badUpdate = await handleSheets(
      sheetsRequest('update', { method: 'POST', headers, body: 'bad' }),
      ctx,
      'update',
    );
    expect(badUpdate.status).toBe(400);

    const missingFields = await handleSheets(
      sheetsRequest('update', {
        method: 'POST',
        headers,
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID }),
      }),
      ctx,
      'update',
    );
    expect(missingFields.status).toBe(400);

    const noTokenEnv = makeSheetsEnv(createDbState());
    const noTokenCtx = makeCtx(noTokenEnv);
    const noToken = await handleSheets(
      sheetsRequest('update', {
        method: 'POST',
        headers: await ownerAuthHeaders(noTokenEnv),
        body: JSON.stringify({
          spreadsheetId: SPREADSHEET_ID,
          range: 'A1',
          values: [['x']],
        }),
      }),
      noTokenCtx,
      'update',
    );
    expect(noToken.status).toBe(401);

    mockFetchRouter({
      '/values/': () => ({
        ok: false,
        status: 500,
        text: 'secret_google_token=abc123 internal_write_failure',
      }),
    });
    const updateError = await handleSheets(
      sheetsRequest('update', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          spreadsheetId: SPREADSHEET_ID,
          range: 'A1',
          values: [['x']],
        }),
      }),
      ctx,
      'update',
    );
    expect(updateError.status).toBe(502);
    const updateBody = await updateError.json() as { code: string; error: string };
    expect(updateBody).toMatchObject({
      code: 'SHEETS_UPSTREAM_ERROR',
      error: 'Google Sheets is unavailable (HTTP 500)',
    });
    expect(updateBody.error).not.toContain('secret_google_token');
    expect(updateBody.error).not.toContain('internal_write_failure');

    const badAppend = await handleSheets(
      sheetsRequest('append', {
        method: 'POST',
        headers,
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID }),
      }),
      ctx,
      'append',
    );
    expect(badAppend.status).toBe(400);

    mockFetchRouter({
      '/values/': (_init) => ({
        ok: false,
        status: 404,
        text: 'Requested entity was not found. project_id=secret-project',
      }),
    });
    const appendError = await handleSheets(
      sheetsRequest('append', {
        method: 'POST',
        headers,
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID, values: [['x']] }),
      }),
      ctx,
      'append',
    );
    expect(appendError.status).toBe(424);
    const appendBody = await appendError.json() as { code: string; error: string };
    expect(appendBody).toMatchObject({
      code: 'SHEETS_UPSTREAM_REJECTED',
      error: 'Google Sheets rejected the request (HTTP 404)',
    });
    expect(appendBody.error).not.toContain('secret-project');
  });

  it('handles unexpected write failures without leaking internal error text', async () => {
    const state = createDbState();
    const env = makeSheetsEnv(state);
    await storeArtifactToken(state, env);
    const ctx = makeCtx(env);
    const headers = await ownerAuthHeaders(env);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('D1_ERROR: no such table: artifact_sheets_tokens');
      }),
    );

    const updateError = await handleSheets(
      sheetsRequest('update', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          spreadsheetId: SPREADSHEET_ID,
          range: 'A1',
          values: [['x']],
        }),
      }),
      ctx,
      'update',
    );
    expect(updateError.status).toBe(500);
    const updateBody = await updateError.json() as { code: string; error: string };
    expect(updateBody).toMatchObject({
      code: 'UPDATE_ERROR',
      error: 'Failed to update sheet data',
    });
    expect(updateBody.error).not.toContain('D1_ERROR');
  });
});
