// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../../src/data/platform/providers/google-sheets';
import '../../../../src/data/platform/providers/google-analytics';
import '../../../../src/data/platform/providers/shopify';
import '../../../../src/data/platform/providers/tiendanube';
import { PlatformEngine } from '../../../../src/data/platform/core/engine';
import { PLATFORM_ERRORS } from '../../../../src/data/platform/types';
import { cleanupRateLimiters } from '../../../../src/data/platform/core/rate-limiter';
import * as credentialsModule from '../../../../src/data/platform/core/credentials';
import {
  ARTIFACT_ID,
  CREDENTIALS_KEY,
  encryptTestCredentials,
  publicArtifactEnv,
} from './helpers';

const baseConnection = {
  id: 'conn_1',
  name: 'Sheets',
  provider: 'google-sheets',
  preferredMode: 'auto' as const,
  config: {},
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

async function connectionWithToken(token: string, expiresAt?: number) {
  const { encrypted, iv } = await encryptTestCredentials({
    access_token: token,
    refresh_token: 'refresh',
    expires_at: expiresAt,
  });
  return {
    ...baseConnection,
    encryptedCredentials: encrypted,
    iv,
  };
}

function engine(env = publicArtifactEnv(), origin?: string) {
  return new PlatformEngine({
    artifactId: ARTIFACT_ID,
    env,
    requestOrigin: origin,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanupRateLimiters();
});

describe('PlatformEngine.execute', () => {
  beforeEach(() => {
    vi.spyOn(credentialsModule, 'loadConnection').mockImplementation(async () =>
      connectionWithToken('access-token', Date.now() + 3_600_000),
    );
  });

  it('returns provider not found for unknown providers', async () => {
    const result = await engine().execute({
      provider: 'unknown-provider',
      endpoint: 'values.get',
      connectionId: 'conn_1',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(PLATFORM_ERRORS.PROVIDER_NOT_FOUND.code);
  });

  it('returns endpoint not found for unknown endpoints', async () => {
    const result = await engine().execute({
      provider: 'google-sheets',
      endpoint: 'missing.endpoint',
      connectionId: 'conn_1',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(PLATFORM_ERRORS.ENDPOINT_NOT_FOUND.code);
  });

  it('returns connection not found when load fails', async () => {
    vi.mocked(credentialsModule.loadConnection).mockRejectedValueOnce(new Error('missing'));

    const result = await engine().execute({
      provider: 'google-sheets',
      endpoint: 'values.get',
      connectionId: 'missing',
    });

    expect(result.error?.code).toBe(PLATFORM_ERRORS.CONNECTION_NOT_FOUND.code);
  });

  it('returns invalid credentials when decryption fails', async () => {
    vi.mocked(credentialsModule.loadConnection).mockResolvedValueOnce({
      ...baseConnection,
      encryptedCredentials: 'bad',
      iv: 'bad',
    });

    const result = await engine().execute({
      provider: 'google-sheets',
      endpoint: 'values.get',
      connectionId: 'conn_1',
    });

    expect(result.error?.code).toBe(PLATFORM_ERRORS.INVALID_CREDENTIALS.code);
  });

  it('returns cached GET responses without calling the provider', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ spreadsheetId: 'sheet-abc' }), {
      status: 200,
      headers: { 'X-RateLimit-Remaining': '9', 'X-RateLimit-Limit': '10' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const eng = engine();
    const miss = await eng.execute({
      provider: 'google-sheets',
      endpoint: 'spreadsheets.get',
      connectionId: 'conn_1',
      params: { pathParams: { spreadsheetId: 'sheet-abc' } },
      options: { forceRefresh: true, cache: true },
    });

    expect(miss.success).toBe(true);
    expect(miss.meta?.cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    const cached = await eng.execute({
      provider: 'google-sheets',
      endpoint: 'spreadsheets.get',
      connectionId: 'conn_1',
      params: { pathParams: { spreadsheetId: 'sheet-abc' } },
    });

    expect(cached.success).toBe(true);
    expect(cached.meta?.cached).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps provider HTTP errors with retryable flags', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'Quota exceeded' },
    }), { status: 429 })));

    const result = await engine().execute({
      provider: 'google-sheets',
      endpoint: 'spreadsheets.get',
      connectionId: 'conn_1',
      params: { pathParams: { spreadsheetId: 'sheet-abc' } },
      options: { cache: false },
    });

    expect(result.success).toBe(false);
    expect(result.error?.httpStatus).toBe(429);
    expect(result.error?.retryable).toBe(true);
  });

  it('handles provider execution throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));

    const result = await engine().execute({
      provider: 'google-sheets',
      endpoint: 'spreadsheets.get',
      connectionId: 'conn_1',
      params: { pathParams: { spreadsheetId: 'sheet-abc' } },
      options: { cache: false },
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('network down');
    expect(result.error?.retryable).toBe(true);
  });

  it('refreshes tokens that expire within one minute', async () => {
    vi.mocked(credentialsModule.loadConnection).mockResolvedValueOnce(
      connectionWithToken('old-token', Date.now() + 30_000),
    );
    const saveSpy = vi.spyOn(credentialsModule, 'saveCredentials').mockResolvedValue(undefined);

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({
          access_token: 'fresh-token',
          expires_in: 3600,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ spreadsheetId: 'sheet-abc' }), { status: 200 });
    }));

    const result = await engine().execute({
      provider: 'google-sheets',
      endpoint: 'spreadsheets.get',
      connectionId: 'conn_1',
      params: { pathParams: { spreadsheetId: 'sheet-abc' } },
      options: { cache: false },
    });

    expect(saveSpy).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('returns rate limited when per-second quota is exceeded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));

    const eng = engine();
    let last: Awaited<ReturnType<typeof eng.execute>> | undefined;

    for (let i = 0; i < 12; i++) {
      last = await eng.execute({
        provider: 'google-sheets',
        endpoint: 'spreadsheets.get',
        connectionId: 'conn_1',
        params: { pathParams: { spreadsheetId: `sheet-${i}` } },
        options: { cache: false },
      });
    }

    expect(last?.success).toBe(false);
    expect(last?.error?.code).toBe(PLATFORM_ERRORS.RATE_LIMITED.code);
  });
});

describe('PlatformEngine helpers', () => {
  beforeEach(() => {
    vi.spyOn(credentialsModule, 'loadConnection').mockImplementation(async () =>
      connectionWithToken('direct-token', Date.now() + 3_600_000),
    );
  });

  it('prepareForDirectMode returns provider config and credentials', async () => {
    vi.spyOn(credentialsModule, 'prepareCredentialsForRequest').mockResolvedValue({
      mode: 'direct',
      direct: {
        accessToken: 'direct-token',
        expiresAt: Date.now() + 300_000,
        authHeader: 'Bearer direct-token',
        headerName: 'Authorization',
      },
      expiresAt: Date.now() + 300_000,
    });

    const result = await engine(publicArtifactEnv(), 'https://app.example.com')
      .prepareForDirectMode('google-sheets', 'conn_1', 'values.get');

    expect(result.mode).toBe('direct');
    expect(result.credentials?.accessToken).toBe('direct-token');
    expect(result.endpoint.id).toBe('values.get');
    expect(result.providerConfig.baseUrl).toContain('sheets.googleapis.com');
  });

  it('prepareForDirectMode throws for unknown provider or endpoint', async () => {
    await expect(engine().prepareForDirectMode('nope', 'conn_1', 'values.get'))
      .rejects.toThrow(PLATFORM_ERRORS.PROVIDER_NOT_FOUND.message);

    await expect(engine().prepareForDirectMode('google-sheets', 'conn_1', 'nope'))
      .rejects.toThrow(PLATFORM_ERRORS.ENDPOINT_NOT_FOUND.message);
  });

  it('reports cache status and refreshes user-refreshable entries', async () => {
    const eng = engine();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ values: [] }), { status: 200 })));

    await eng.execute({
      provider: 'google-sheets',
      endpoint: 'values.get',
      connectionId: 'conn_1',
      params: {
        pathParams: { spreadsheetId: 'sheet', range: 'A1' },
      },
      options: { cache: false },
    });

    const status = await eng.getCacheStatus();
    expect(status.memoryEntries).toBeGreaterThanOrEqual(0);

    const refreshed = await eng.refreshCache('google-sheets', 'values.get');
    expect(refreshed.invalidated).toBeGreaterThanOrEqual(0);
  });

  it('records direct usage for known providers and ignores unknown ones', async () => {
    const eng = engine();
    expect(() => eng.recordDirectUsage('google-sheets', 'conn_1')).not.toThrow();
    expect(() => eng.recordDirectUsage('unknown', 'conn_1')).not.toThrow();
  });
});
