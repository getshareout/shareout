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

describe('fetchSheetData', () => {
  it('validates input and requires connection', async () => {
    const env = makeSheetsEnv();
    const ctx = makeCtx(env);

    const badJson = await handleSheets(
      sheetsRequest('fetch', { method: 'POST', body: 'bad' }),
      ctx,
      'fetch',
    );
    expect(badJson.status).toBe(400);

    const missingId = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetUrl: 'https://example.com/nope' }),
      }),
      ctx,
      'fetch',
    );
    expect(missingId.status).toBe(400);

    const notConnected = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID }),
      }),
      ctx,
      'fetch',
    );
    expect(notConnected.status).toBe(401);
  });

  it('returns cached data when available and not expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:00:00.000Z'));

    const state = createDbState();
    const env = makeSheetsEnv(state);
    await storeArtifactToken(state, env);
    const cacheKey = `_sheets_cache_${SPREADSHEET_ID}_Sheet1`;
    state.artifactJson.set(`${ARTIFACT_ID}::${cacheKey}`, JSON.stringify({
      data: { data: [{ a: 1 }], headers: ['a'], rowCount: 1 },
      cachedAt: '2026-05-30T13:58:00.000Z',
    }));
    const ctx = makeCtx(env);

    const response = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID, range: 'Sheet1' }),
      }),
      ctx,
      'fetch',
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { cached: true, rowCount: 1 },
    });
  });

  it('fetches from Google Sheets and caches results', async () => {
    const state = createDbState();
    const env = makeSheetsEnv(state);
    await storeArtifactToken(state, env);
    const ctx = makeCtx(env);

    mockFetchRouter({
      '/values/': () => ({
        ok: true,
        json: async () => ({
          values: [
            ['Name', 'Qty', 'Active'],
            ['Widget', '10', 'true'],
            ['Gadget', '5', 'false'],
          ],
        }),
      }),
    });

    const response = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`,
          range: 'Sheet1',
        }),
      }),
      ctx,
      'fetch',
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { cached: boolean; headers: string[]; data: Array<Record<string, unknown>> };
    };
    expect(body.data.cached).toBe(false);
    expect(body.data.headers).toEqual(['Name', 'Qty', 'Active']);
    expect(body.data.data[0]).toMatchObject({ Name: 'Widget', Qty: 10, Active: true });
  });

  it('handles empty sheets, raw rows, access denied, and fetch errors', async () => {
    const state = createDbState();
    const env = makeSheetsEnv(state);
    await storeArtifactToken(state, env);
    const ctx = makeCtx(env);

    mockFetchRouter({
      '/values/': () => ({ ok: true, json: async () => ({ values: [] }) }),
    });
    const empty = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID, cache: false }),
      }),
      ctx,
      'fetch',
    );
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({ data: { rowCount: 0 } });

    mockFetchRouter({
      '/values/': () => ({
        ok: true,
        json: async () => ({ values: [['only', 'header'], ['a', 'b']] }),
      }),
    });
    const raw = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID, headers: false, cache: false }),
      }),
      ctx,
      'fetch',
    );
    const rawBody = await raw.json() as { data: { data: string[][] } };
    expect(rawBody.data.data).toHaveLength(2);

    mockFetchRouter({
      '/values/': () => ({ ok: false, status: 403, text: 'denied' }),
    });
    const denied = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID, cache: false }),
      }),
      ctx,
      'fetch',
    );
    expect(denied.status).toBe(403);

    mockFetchRouter({
      '/values/': () => ({ ok: false, status: 500, text: 'boom' }),
    });
    const failed = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID, cache: false }),
      }),
      ctx,
      'fetch',
    );
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toMatchObject({ code: 'SHEETS_UPSTREAM_ERROR' });
  });

  it('maps upstream 4xx (deleted sheet / bad range) to 424 and 429 to 429', async () => {
    const state = createDbState();
    const env = makeSheetsEnv(state);
    await storeArtifactToken(state, env);
    const ctx = makeCtx(env);

    mockFetchRouter({
      '/values/': () => ({ ok: false, status: 404, text: 'Requested entity was not found.' }),
    });
    const notFound = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID, cache: false }),
      }),
      ctx,
      'fetch',
    );
    expect(notFound.status).toBe(424);
    await expect(notFound.json()).resolves.toMatchObject({ code: 'SHEETS_UPSTREAM_REJECTED' });

    mockFetchRouter({
      '/values/': () => ({ ok: false, status: 429, text: 'Rate Limit Exceeded' }),
    });
    const limited = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID, cache: false }),
      }),
      ctx,
      'fetch',
    );
    expect(limited.status).toBe(429);
  });

  it('maps upstream 5xx to SHEETS_UPSTREAM_ERROR without leaking response body', async () => {
    const state = createDbState();
    const env = makeSheetsEnv(state);
    await storeArtifactToken(state, env);
    const ctx = makeCtx(env);

    mockFetchRouter({
      '/values/': () => ({
        ok: false,
        status: 500,
        text: 'secret_google_token=abc123 internal_error_detail',
      }),
    });
    const response = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID, cache: false }),
      }),
      ctx,
      'fetch',
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

  it('maps upstream 4xx to SHEETS_UPSTREAM_REJECTED without leaking response body', async () => {
    const state = createDbState();
    const env = makeSheetsEnv(state);
    await storeArtifactToken(state, env);
    const ctx = makeCtx(env);

    mockFetchRouter({
      '/values/': () => ({
        ok: false,
        status: 404,
        text: 'Requested entity was not found. project_id=secret-project',
      }),
    });
    const response = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID, cache: false }),
      }),
      ctx,
      'fetch',
    );
    expect(response.status).toBe(424);
    const body = await response.json() as { code: string; error: string };
    expect(body).toMatchObject({
      code: 'SHEETS_UPSTREAM_REJECTED',
      error: 'Google Sheets rejected the request (HTTP 404)',
    });
    expect(body.error).not.toContain('secret-project');
    expect(body.error).not.toContain('Requested entity');
  });

  it('handles unexpected fetch failures without leaking internal error text', async () => {
    const state = createDbState();
    const env = makeSheetsEnv(state);
    await storeArtifactToken(state, env);
    const ctx = makeCtx(env);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('D1_ERROR: no such table: artifact_sheets_tokens');
      }),
    );
    const response = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID, cache: false }),
      }),
      ctx,
      'fetch',
    );
    expect(response.status).toBe(500);
    const body = await response.json() as { code: string; error: string };
    expect(body).toMatchObject({
      code: 'FETCH_ERROR',
      error: 'Failed to fetch sheet data',
    });
    expect(body.error).not.toContain('D1_ERROR');
    expect(body.error).not.toContain('artifact_sheets_tokens');
  });

  it('returns a clean 401 (not 500) when the stored token blob cannot be decrypted', async () => {
    const state = createDbState();
    const env = makeSheetsEnv(state);
    await storeArtifactToken(state, env);
    const ctx = makeCtx(env);

    vi.mocked(decryptCredentials).mockRejectedValueOnce(
      new Error('Decryption failed. ... for AES-GCM'),
    );

    const response = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID, cache: false }),
      }),
      ctx,
      'fetch',
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'SHEETS_NOT_CONNECTED' });
  });

  it('skips expired cache entries and refetches', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:10:00.000Z'));

    const state = createDbState();
    const env = makeSheetsEnv(state);
    await storeArtifactToken(state, env);
    const cacheKey = `_sheets_cache_${SPREADSHEET_ID}_Sheet1`;
    state.artifactJson.set(`${ARTIFACT_ID}::${cacheKey}`, JSON.stringify({
      data: { data: [{ stale: true }], rowCount: 1 },
      cachedAt: '2026-05-30T14:00:00.000Z',
    }));
    const ctx = makeCtx(env);

    mockFetchRouter({
      '/values/': () => ({
        ok: true,
        json: async () => ({ values: [['fresh']] }),
      }),
    });

    const response = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID }),
      }),
      ctx,
      'fetch',
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { cached: false } });
  });

  it('ignores malformed cache entries', async () => {
    const state = createDbState();
    const env = makeSheetsEnv(state);
    await storeArtifactToken(state, env);
    state.artifactJson.set(
      `${ARTIFACT_ID}::_sheets_cache_${SPREADSHEET_ID}_Sheet1`,
      'not-json',
    );
    const ctx = makeCtx(env);

    mockFetchRouter({
      '/values/': () => ({
        ok: true,
        json: async () => ({ values: [['ok']] }),
      }),
    });

    const response = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID }),
      }),
      ctx,
      'fetch',
    );
    expect(response.status).toBe(200);
  });

  it('ignores expired cache and honors forceRefresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:10:00.000Z'));

    const state = createDbState();
    const env = makeSheetsEnv(state);
    await storeArtifactToken(state, env);
    const cacheKey = `_sheets_cache_${SPREADSHEET_ID}_Sheet1`;
    state.artifactJson.set(`${ARTIFACT_ID}::${cacheKey}`, JSON.stringify({
      data: { data: [], rowCount: 0 },
      cachedAt: '2026-05-30T14:00:00.000Z',
    }));
    const ctx = makeCtx(env);

    mockFetchRouter({
      '/values/': () => ({
        ok: true,
        json: async () => ({ values: [['H'], ['v']] }),
      }),
    });

    const response = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID, forceRefresh: true }),
      }),
      ctx,
      'fetch',
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { cached: false } });
  });
});
