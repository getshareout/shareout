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

describe('legacy Google OAuth flow', () => {
  it('redirects to Google when initiating connect with a session', async () => {
    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: USER_ID, email: 'user@example.com' });
    const env = makeSheetsEnv();
    const ctx = makeCtx(env);
    const response = await handleSheets(
      sheetsRequest('connect', { method: 'GET' }, '?return=/back'),
      ctx,
      'connect',
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toContain('accounts.google.com/mock');
    expect(googleAuth.getGoogleAuthUrl).toHaveBeenCalled();
  });

  it('requires login to initiate connect', async () => {
    const env = makeSheetsEnv();
    const ctx = makeCtx(env);
    const response = await handleSheets(sheetsRequest('connect', { method: 'GET' }), ctx, 'connect');
    expect(response.status).toBe(401);
  });

  it('handles OAuth callback success and errors', async () => {
    const env = makeSheetsEnv();
    const ctx = makeCtx(env);
    const state = btoa(JSON.stringify({
      artifactId: ARTIFACT_ID,
      userId: USER_ID,
      returnUrl: '/done',
    }));

    const oauthError = await handleSheets(
      sheetsRequest('callback', { method: 'GET' }, '?error=access_denied'),
      ctx,
      'callback',
    );
    expect(oauthError.status).toBe(400);

    const missing = await handleSheets(
      sheetsRequest('callback', { method: 'GET' }),
      ctx,
      'callback',
    );
    expect(missing.status).toBe(400);

    const badState = await handleSheets(
      sheetsRequest('callback', { method: 'GET' }, '?code=abc&state=!!!'),
      ctx,
      'callback',
    );
    expect(badState.status).toBe(400);

    vi.mocked(googleAuth.exchangeCodeForTokens).mockRejectedValueOnce(
      new Error('Token exchange failed: {"error":"invalid_grant"}'),
    );
    const failed = await handleSheets(
      sheetsRequest('callback', { method: 'GET' }, `?code=abc&state=${state}`),
      ctx,
      'callback',
    );
    expect(failed.status).toBe(500);
    const failedBody = await failed.json() as { error: string; code: string };
    expect(failedBody.error).toBe('Google Sheets authorization failed');
    expect(failedBody.code).toBe('OAUTH_ERROR');
    expect(failedBody.error).not.toContain('invalid_grant');
    expect(failedBody.error).not.toContain('Token exchange failed');

    const success = await handleSheets(
      sheetsRequest('callback', { method: 'GET' }, `?code=abc&state=${state}`),
      ctx,
      'callback',
    );
    expect(success.status).toBe(302);
    expect(success.headers.get('Location')).toContain('connected=true');
    expect(googleAuth.storeUserTokens).toHaveBeenCalled();
  });

  it('reports connection status and disconnects', async () => {
    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: USER_ID, email: 'user@example.com' });
    vi.mocked(googleAuth.hasGoogleConnection).mockResolvedValue(true);

    const env = makeSheetsEnv();
    const ctx = makeCtx(env);

    const status = await handleSheets(sheetsRequest('status', { method: 'GET' }), ctx, 'status');
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      data: { connected: true, userId: USER_ID },
    });

    vi.mocked(auth.getSessionUser).mockResolvedValue(null);
    const anon = await handleSheets(sheetsRequest('status', { method: 'GET' }), ctx, 'status');
    await expect(anon.json()).resolves.toMatchObject({
      data: { connected: false, reason: 'not_logged_in' },
    });

    const disconnectUnauthorized = await handleSheets(
      sheetsRequest('disconnect', { method: 'POST' }),
      ctx,
      'disconnect',
    );
    expect(disconnectUnauthorized.status).toBe(401);

    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: USER_ID, email: 'user@example.com' });
    const disconnect = await handleSheets(
      sheetsRequest('disconnect', { method: 'POST' }),
      ctx,
      'disconnect',
    );
    expect(disconnect.status).toBe(200);
    expect(googleAuth.revokeGoogleConnection).toHaveBeenCalledWith(env, USER_ID);
  });
});

describe('simplified auth-url flow', () => {
  it('returns auth URL for first connect without owner token', async () => {
    const env = makeSheetsEnv();
    const ctx = makeCtx(env);
    const response = await handleSheets(sheetsRequest('auth-url', { method: 'GET' }), ctx, 'auth-url');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { authUrl: string } };
    expect(body.data.authUrl).toContain('accounts.google.com/mock');
  });

  it('requires owner when reconnecting existing tokens', async () => {
    const state = createDbState();
    await storeArtifactToken(state, makeSheetsEnv(state));
    const env = makeSheetsEnv(state);
    const ctx = makeCtx(env);

    const forbidden = await handleSheets(sheetsRequest('auth-url', { method: 'GET' }), ctx, 'auth-url');
    expect(forbidden.status).toBe(403);

    const allowed = await handleSheets(
      sheetsRequest('auth-url', { method: 'GET', headers: await ownerAuthHeaders(env) }),
      ctx,
      'auth-url',
    );
    expect(allowed.status).toBe(200);
  });

  it('handles auth-callback HTML responses', async () => {
    const env = makeSheetsEnv();
    const ctx = makeCtx(env);
    const state = btoa(JSON.stringify({ artifactId: ARTIFACT_ID, returnUrl: '/home' }));

    const errorPage = await handleSheets(
      sheetsRequest('auth-callback', { method: 'GET' }, '?error=denied'),
      ctx,
      'auth-callback',
    );
    expect(errorPage.status).toBe(400);
    expect(errorPage.headers.get('Content-Type')).toBe('text/html');

    const success = await handleSheets(
      sheetsRequest('auth-callback', { method: 'GET' }, `?code=abc&state=${state}`),
      ctx,
      'auth-callback',
    );
    expect(success.status).toBe(200);
    const html = await success.text();
    expect(html).toContain('Connected!');
  });

  it('reports token status', async () => {
    const state = createDbState();
    await storeArtifactToken(state, makeSheetsEnv(state));
    const env = makeSheetsEnv(state);
    const ctx = makeCtx(env);

    const response = await handleSheets(sheetsRequest('token-status', { method: 'GET' }), ctx, 'token-status');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { connected: true, artifactId: ARTIFACT_ID },
    });
  });
});

describe('handleSheetsOAuthCallback', () => {
  it('renders errors and success at the global callback route', async () => {
    const env = makeSheetsEnv();
    const state = btoa(JSON.stringify({ artifactId: ARTIFACT_ID, returnUrl: '/return' }));

    const missingArtifactEnv = makeSheetsEnv(createDbState());
    const badArtifactState = btoa(JSON.stringify({ artifactId: 'art_missing', returnUrl: '/return' }));
    const missingArtifact = await handleSheetsOAuthCallback(
      new Request(`${BASE_URL}/auth/callback?code=abc&state=${badArtifactState}`),
      missingArtifactEnv,
    );
    expect(missingArtifact.status).toBe(400);
    expect(await missingArtifact.text()).toContain('Artifact not found');

    vi.mocked(googleAuth.exchangeCodeForTokens).mockRejectedValueOnce(
      new Error('Token exchange failed: {"error":"invalid_grant"}'),
    );
    const failed = await handleSheetsOAuthCallback(
      new Request(`${BASE_URL}/auth/callback?code=abc&state=${state}`),
      env,
    );
    expect(failed.status).toBe(400);
    const failedHtml = await failed.text();
    expect(failedHtml).toContain('Google Sheets authorization failed');
    expect(failedHtml).not.toContain('invalid_grant');
    expect(failedHtml).not.toContain('Token exchange failed');

    const success = await handleSheetsOAuthCallback(
      new Request(`${BASE_URL}/auth/callback?code=abc&state=${state}`),
      env,
    );
    expect(success.status).toBe(200);
    expect(await success.text()).toContain('Connected!');
  });

  it('reports OAuth callback errors for missing code and invalid state', async () => {
    const env = makeSheetsEnv();

    const missing = await handleSheetsOAuthCallback(
      new Request(`${BASE_URL}/auth/callback`),
      env,
    );
    expect(missing.status).toBe(400);

    const invalidState = await handleSheetsOAuthCallback(
      new Request(`${BASE_URL}/auth/callback?code=abc&state=!!!`),
      env,
    );
    expect(invalidState.status).toBe(400);
  });

  it('fails auth-callback without leaking credentials config errors', async () => {
    const env = makeSheetsEnv();
    delete env.CREDENTIALS_KEY;
    const ctx = makeCtx(env);
    const state = btoa(JSON.stringify({ artifactId: ARTIFACT_ID, returnUrl: '/home' }));

    const response = await handleSheets(
      sheetsRequest('auth-callback', { method: 'GET' }, `?code=abc&state=${state}`),
      ctx,
      'auth-callback',
    );
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('Google Sheets authorization failed');
    expect(html).not.toContain('CREDENTIALS_KEY');
  });
});
