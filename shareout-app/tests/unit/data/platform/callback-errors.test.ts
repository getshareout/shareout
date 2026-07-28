// Artifact platform OAuth callback error handling — HTML pages, no internal leaks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePlatformRequest } from '../../../../src/data/platform';
import {
  ARTIFACT_ID,
  BASE_URL,
  makeDataContext,
  publicArtifactEnv,
} from './helpers';

const logError = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/logging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/logging')>();
  return { ...actual, logError };
});

afterEach(() => {
  vi.restoreAllMocks();
  logError.mockReset();
});

function validState(overrides: Partial<{ artifactId: string; connectionName: string; returnUrl: string }> = {}) {
  return btoa(JSON.stringify({
    artifactId: ARTIFACT_ID,
    connectionName: 'my-conn',
    returnUrl: '/done',
    ts: Date.now(),
    ...overrides,
  }));
}

function callbackReq(qs: string) {
  return new Request(`${BASE_URL}/google-sheets/callback?${qs}`, { method: 'GET' });
}

describe('platform OAuth callback error handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'tok',
      expires_in: 3600,
    }), { status: 200 })));
  });

  it('returns HTML denial page for OAuth error query param', async () => {
    const res = await handlePlatformRequest(
      callbackReq('error=access_denied&error_description=User%20denied'),
      makeDataContext(publicArtifactEnv()),
      ['google-sheets', 'callback'],
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toMatch(/html/);
    const html = await res.text();
    expect(html).toMatch(/User denied/);
    expect(html).toMatch(/shareout:platform:connection:error/);
    expect(html).not.toMatch(/D1_ERROR/);
  });

  it('returns HTML error when handleCallback throws — no token exchange leak', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'invalid_grant',
      error_description: 'Token has been expired or revoked',
    }), { status: 400 })));

    const res = await handlePlatformRequest(
      callbackReq(`code=authcode&state=${encodeURIComponent(validState())}`),
      makeDataContext(publicArtifactEnv()),
      ['google-sheets', 'callback'],
    );
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toMatch(/Google Sheets authorization failed/);
    expect(html).not.toMatch(/invalid_grant/);
    expect(html).not.toMatch(/revoked/);
    expect(logError).toHaveBeenCalled();
  });

  it('returns HTML validation error for state artifact mismatch', async () => {
    const res = await handlePlatformRequest(
      callbackReq(`code=c&state=${encodeURIComponent(validState({ artifactId: 'other' }))}`),
      makeDataContext(publicArtifactEnv()),
      ['google-sheets', 'callback'],
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toMatch(/html/);
    expect(await res.text()).toMatch(/mismatch/i);
  });

  it('returns HTML success with connected postMessage', async () => {
    const res = await handlePlatformRequest(
      callbackReq(`code=authcode&state=${encodeURIComponent(validState())}`),
      makeDataContext(publicArtifactEnv({}, { run: () => ({ meta: { changes: 1 } }) })),
      ['google-sheets', 'callback'],
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/shareout:platform:connected/);
    expect(html).toMatch(/Connected successfully/);
  });
});
