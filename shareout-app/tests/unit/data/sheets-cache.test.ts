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

describe('cache management', () => {
  it('lists cached sheet entries', async () => {
    const state = createDbState();
    state.artifactJson.set(`${ARTIFACT_ID}::_sheets_cache_${SPREADSHEET_ID}_Sheet1`, JSON.stringify({
      data: { rowCount: 3 },
      cachedAt: '2026-05-30T12:00:00.000Z',
    }));
    const env = makeSheetsEnv(state);
    const ctx = makeCtx(env);

    const response = await handleSheets(sheetsRequest('cache', { method: 'GET' }), ctx, 'cache');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { count: number; caches: Array<{ key: string }> } };
    expect(body.data.count).toBe(1);
    expect(body.data.caches[0].key).toContain(SPREADSHEET_ID);
  });

  it('clears cache for owners only', async () => {
    const state = createDbState();
    state.artifactJson.set(`${ARTIFACT_ID}::_sheets_cache_${SPREADSHEET_ID}_Sheet1`, '{}');
    state.artifactJson.set(`${ARTIFACT_ID}::_sheets_cache_${SPREADSHEET_ID}_Sheet2`, '{}');
    const env = makeSheetsEnv(state);
    const ctx = makeCtx(env);

    const forbidden = await handleSheets(sheetsRequest('cache', { method: 'DELETE' }), ctx, 'cache');
    expect(forbidden.status).toBe(403);

    const clearOne = await handleSheets(
      sheetsRequest('cache', { method: 'DELETE', headers: await ownerAuthHeaders(env) }, `?spreadsheetId=${SPREADSHEET_ID}`),
      ctx,
      'cache',
    );
    expect(clearOne.status).toBe(200);
    expect([...state.artifactJson.keys()].some((k) => k.includes('_Sheet1'))).toBe(false);

    state.artifactJson.set(`${ARTIFACT_ID}::_sheets_cache_other_sheet`, '{}');
    const clearAll = await handleSheets(
      sheetsRequest('cache', { method: 'DELETE', headers: await ownerAuthHeaders(env) }),
      ctx,
      'cache',
    );
    expect(clearAll.status).toBe(200);
    expect([...state.artifactJson.keys()].filter((k) => k.includes('_sheets_cache_'))).toHaveLength(0);
  });
});

describe('artifact token refresh path', () => {
  it('refreshes expired artifact tokens via google-auth', async () => {
    const state = createDbState();
    const env = makeSheetsEnv(state);
    await storeArtifactToken(state, env, { expiresInMs: -120_000 });

    vi.mocked(decryptCredentials).mockResolvedValue({ access_token: 'expired-access', refresh_token: 'valid-refresh' });
    vi.mocked(googleAuth.refreshAccessToken).mockResolvedValue({
      access_token: 'refreshed-access',
      refresh_token: 'refreshed-refresh',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'sheets',
    });

    mockFetchRouter({
      '/values/': () => ({
        ok: true,
        json: async () => ({ values: [['H'], ['v']] }),
      }),
    });

    const ctx = makeCtx(env);
    const response = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID, cache: false }),
      }),
      ctx,
      'fetch',
    );
    expect(response.status).toBe(200);
    expect(googleAuth.refreshAccessToken).toHaveBeenCalled();
  });

  it('returns null access when refresh fails', async () => {
    const state = createDbState();
    const env = makeSheetsEnv(state);
    await storeArtifactToken(state, env, { expiresInMs: -120_000 });

    vi.mocked(decryptCredentials).mockResolvedValue({ access_token: 'expired-access', refresh_token: 'valid-refresh' });
    vi.mocked(googleAuth.refreshAccessToken).mockRejectedValue(new Error('refresh failed'));

    const ctx = makeCtx(env);
    const response = await handleSheets(
      sheetsRequest('fetch', {
        method: 'POST',
        body: JSON.stringify({ spreadsheetId: SPREADSHEET_ID }),
      }),
      ctx,
      'fetch',
    );
    expect(response.status).toBe(401);
  });
});
