import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { createFetchContext } from '../../../src/router/context';
import { routeAuth } from '../../../src/router/auth-router';

const handleSessionInfo = vi.hoisted(() => vi.fn());
const getSsoConfigForEmail = vi.hoisted(() => vi.fn());

vi.mock('../../../src/auth/sso-config', async (orig) => ({
  ...(await orig<typeof import('../../../src/auth/sso-config')>()),
  getSsoConfigForEmail,
}));

vi.mock('../../../src/auth-otp', () => ({
  handleEmailOtpStart: vi.fn().mockResolvedValue(new Response('ok')),
  handleEmailOtpVerify: vi.fn().mockResolvedValue(new Response('ok')),
  handleSessionInfo,
  handleLinkEmailOtpStart: vi.fn().mockResolvedValue(new Response('ok')),
  handleLinkEmailOtpVerify: vi.fn().mockResolvedValue(new Response('ok')),
  handleListLinkedAccounts: vi.fn().mockResolvedValue(new Response('ok')),
  handleUnlinkAccount: vi.fn().mockResolvedValue(new Response('ok')),
}));

vi.mock('../../../src/auth/google-oauth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  handleGoogleLogin: vi.fn().mockResolvedValue(new Response('ok')),
  handleGoogleCallback: vi.fn().mockResolvedValue(new Response('ok')),
  handleLinkGoogleStart: vi.fn().mockResolvedValue(new Response('ok')),
}));
vi.mock('../../../src/auth/google-one-tap', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  handleGoogleOneTap: vi.fn().mockResolvedValue(new Response('ok')),
}));
vi.mock('../../../src/auth/logout', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  handleLogout: vi.fn().mockResolvedValue(new Response('ok')),
}));
vi.mock('../../../src/auth/artifact-auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  handlePasswordAuth: vi.fn().mockResolvedValue(new Response('ok')),
  handleCredentialsAuth: vi.fn().mockResolvedValue(new Response('ok')),
}));
vi.mock('../../../src/auth/dev-login', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  handleDevLogin: vi.fn().mockResolvedValue(new Response('ok')),
}));

vi.mock('../../../src/api-auth', () => ({
  handleCreateAccount: vi.fn().mockResolvedValue(new Response('ok')),
  handleLinkEmail: vi.fn().mockResolvedValue(new Response('ok')),
  handleGetProfile: vi.fn().mockResolvedValue(new Response('ok')),
  handleUpdateProfile: vi.fn().mockResolvedValue(new Response('ok')),
  validateToken: vi.fn().mockResolvedValue(null),
  handleCreateAdminSession: vi.fn().mockResolvedValue(new Response('ok')),
}));

vi.mock('../../../src/workspaces-invite-email', () => ({
  handleClaimInvite: vi.fn().mockResolvedValue(new Response('ok')),
}));

vi.mock('../../../src/api-me-tokens', () => ({
  handleListMyTokens: vi.fn().mockResolvedValue(new Response('ok')),
  handleCreateMyToken: vi.fn().mockResolvedValue(new Response('ok')),
}));

vi.mock('../../../src/workspace-library', () => ({
  handleListMyLibraries: vi.fn().mockResolvedValue(new Response('ok')),
}));

vi.mock('../../../src/publish/library-module', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  handleCreateLibraryModule: vi.fn().mockResolvedValue(new Response('ok')),
}));

vi.mock('../../../src/data/sheets/artifact-auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  handleSheetsOAuthCallback: vi.fn().mockResolvedValue(new Response('ok')),
}));

vi.mock('../../../src/data/github/handler', () => ({
  handleGitHubOAuthCallback: vi.fn().mockResolvedValue(new Response('ok')),
}));

vi.mock('../../../src/router/helpers/auth-guard', () => ({
  getTokenOrSessionUser: vi.fn().mockResolvedValue(null),
}));

const env = {} as Env;

function ctx(path: string, method = 'GET') {
  return createFetchContext(new Request(`https://shareout.site${path}`, { method }), env);
}

beforeEach(() => {
  handleSessionInfo.mockReset();
  handleSessionInfo.mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
});

afterEach(() => vi.restoreAllMocks());

describe('routeAuth', () => {
  it('returns null when no auth route matches', async () => {
    expect(await routeAuth(ctx('/v1/unknown'))).toBeNull();
  });

  it('returns consistent JSON 500 when an auth handler throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handleSessionInfo.mockRejectedValue(new Error('boom'));

    const res = await routeAuth(ctx('/v1/auth/session', 'GET'));
    expect(res?.status).toBe(500);
    expect(await res!.json()).toEqual({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
    expect(consoleError).toHaveBeenCalled();
    expect(consoleError.mock.calls[0][0]).toMatchObject({
      level: 'error',
      message: 'auth route handler threw',
      event: 'auth.handler_error',
      path: '/v1/auth/session',
      error_message: 'boom',
    });
  });

  it('looks up the SSO that owns an email domain for the email-first login form', async () => {
    getSsoConfigForEmail.mockResolvedValueOnce({ workspaceSlug: 'acme', buttonLabel: 'Sign in with Okta', enforced: true });
    const res = await routeAuth(ctx('/v1/auth/sso/lookup?email=Ana%40Acme.com'));
    expect(getSsoConfigForEmail).toHaveBeenCalledWith(env, 'ana@acme.com');
    expect(await res!.json()).toEqual({
      sso: { label: 'Sign in with Okta', enforced: true, url: '/auth/sso?workspace=acme&login_hint=ana%40acme.com' },
    });

    getSsoConfigForEmail.mockResolvedValueOnce(null);
    expect(await (await routeAuth(ctx('/v1/auth/sso/lookup?email=x%40example.com')))!.json()).toEqual({ sso: null });
    expect(await (await routeAuth(ctx('/v1/auth/sso/lookup?email=not-an-email')))!.json()).toEqual({ sso: null });
  });
});
