// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  platformOAuthDenialMessage,
  userFacingAuthTokenError,
  userFacingPlatformOAuthError,
  userFacingPrepareError,
  userFacingProviderUpstreamError,
  userFacingSnowflakeJwtError,
  userFacingVerifyUpstreamError,
  mapPrepareFailure,
} from '../../../../src/data/platform/errors';
import { googleAnalyticsProvider } from '../../../../src/data/platform/providers/google-analytics';
import { googleAdsProvider } from '../../../../src/data/platform/providers/google-ads';
import { bigQueryProvider } from '../../../../src/data/platform/providers/bigquery';
import { googleSheetsProvider } from '../../../../src/data/platform/providers/google-sheets';
import { facebookAdsProvider } from '../../../../src/data/platform/providers/facebook-ads';
import { shopifyProvider } from '../../../../src/data/platform/providers/shopify';
import { slackProvider } from '../../../../src/data/platform/providers/slack';
import { snowflakeProvider } from '../../../../src/data/platform/providers/snowflake';
import { tiendanubeProvider } from '../../../../src/data/platform/providers/tiendanube';
import type { Env } from '../../../../src/types';
import type { ExecutionContext } from '../../../../src/data/platform/types';

afterEach(() => vi.restoreAllMocks());

const ENV = {} as Env;

function gaCtx(credentials: Record<string, unknown>): ExecutionContext {
  return {
    artifactId: 'art_1',
    connectionId: 'conn_1',
    connectionConfig: {
      id: 'conn_1',
      name: 'GA',
      provider: 'google-analytics',
      preferredMode: 'proxy',
      config: { propertyId: '12345' },
      createdAt: '',
      updatedAt: '',
    },
    credentials: credentials as ExecutionContext['credentials'],
    env: ENV,
  };
}

describe('platform/errors', () => {
  it('returns generic auth token message without leaking upstream bodies', () => {
    const upstream = 'Authorized-user token refresh failed: {"error":"invalid_grant","error_description":"Bad Request"}';
    expect(userFacingAuthTokenError(new Error(upstream))).toBe('Failed to obtain access token');
    expect(userFacingAuthTokenError(new Error('D1_ERROR: no such table'))).toBe('Failed to obtain access token');
  });

  it('maps verify and execute upstream failures to HTTP status only', () => {
    expect(userFacingVerifyUpstreamError(403)).toBe('API request failed (HTTP 403)');
    expect(userFacingProviderUpstreamError(502)).toBe('Provider request failed (HTTP 502)');
  });

  it('returns generic Snowflake JWT message without leaking crypto internals', () => {
    expect(userFacingSnowflakeJwtError(new Error('Invalid PKCS#8: bad PEM'))).toBe('Failed to sign Snowflake credentials');
    expect(userFacingSnowflakeJwtError(new Error('D1_ERROR: no such table'))).toBe('Failed to sign Snowflake credentials');
  });

  it('returns generic platform OAuth message without leaking token exchange internals', () => {
    expect(userFacingPlatformOAuthError('google-sheets', new Error('invalid_grant: Token revoked'))).toBe('Google Sheets authorization failed');
    expect(userFacingPlatformOAuthError('unknown', new Error('D1_ERROR: no such table'))).toBe('Connection authorization failed');
  });

  it('maps OAuth denial query params to user-facing messages', () => {
    const url = new URL('https://shareout.site/callback?error=access_denied&error_description=User%20denied');
    expect(platformOAuthDenialMessage(url)).toBe('User denied');
    expect(platformOAuthDenialMessage(new URL('https://shareout.site/callback?code=abc'))).toBeNull();
  });

  it('returns generic prepare message without leaking D1 or token exchange bodies', () => {
    expect(userFacingPrepareError(new Error('D1_ERROR: no such table'))).toBe('Failed to prepare credentials');
    expect(userFacingPrepareError(new Error('invalid_grant: Token revoked'))).toBe('Failed to prepare credentials');
    expect(userFacingPrepareError(new Error('Connection not found'))).toBe('Connection not found');
    expect(userFacingPrepareError(new Error('CREDENTIALS_REQUIRED'))).toBe(
      'Connect your credentials for this connector before querying',
    );
  });

  it('mapPrepareFailure assigns correct status codes', () => {
    expect(mapPrepareFailure(new Error('Connection not found'))).toEqual({
      code: 'CONNECTION_NOT_FOUND',
      message: 'Connection not found',
      status: 404,
    });
    expect(mapPrepareFailure(new Error('Failed to obtain access token'))).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Failed to obtain access token',
      status: 401,
    });
    expect(mapPrepareFailure(new Error('D1_ERROR: boom'))).toEqual({
      code: 'PREPARE_ERROR',
      message: 'Failed to prepare credentials',
      status: 500,
    });
  });
});

describe('Google Analytics provider error sanitization', () => {
  it('verifyConnection does not leak token exchange bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"invalid_grant","error_description":"Token has been expired or revoked."}', { status: 400 }),
    );
    const sa = { client_email: 'svc@proj.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nMII\n-----END PRIVATE KEY-----' };
    const result = await googleAnalyticsProvider.verifyConnection!(
      ENV,
      { propertyId: '12345' },
      { access_token: '', extra: { service_account: sa } },
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Failed to obtain access token');
    expect(result.message).not.toContain('invalid_grant');
    expect(consoleError).toHaveBeenCalled();
  });

  it('verifyConnection does not leak upstream property probe bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'User does not have sufficient permissions for property 12345' } }), { status: 403 }),
    );
    const result = await googleAnalyticsProvider.verifyConnection!(
      ENV,
      { propertyId: '12345' },
      { access_token: 'valid-tok' },
    );
    expect(result).toMatchObject({ ok: false, message: 'API request failed (HTTP 403)' });
    expect(result.message).not.toContain('sufficient permissions');
    expect(consoleError).toHaveBeenCalled();
  });

  it('executeRequest does not leak auth token mint failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"invalid_grant"}', { status: 400 }),
    );
    const sa = { client_email: 'svc@proj.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nbad\n-----END PRIVATE KEY-----' };
    const res = await googleAnalyticsProvider.executeRequest(
      gaCtx({ access_token: '', extra: { service_account: sa } }),
      googleAnalyticsProvider.getEndpoint('metadata.get')!,
      {},
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatchObject({ code: 'AUTH_TOKEN_ERROR', message: 'Failed to obtain access token' });
    expect(res.error?.message).not.toContain('invalid_grant');
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('Google Ads provider error sanitization', () => {
  it('verifyConnection does not leak token refresh bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"invalid_client","error_description":"The OAuth client was not found."}', { status: 401 }),
    );
    const result = await googleAdsProvider.verifyConnection!(
      ENV,
      { customer_id: '1234567890' },
      {
        access_token: '',
        extra: {
          authorized_user: { client_id: 'cid', client_secret: 'sec', refresh_token: 'rtok' },
          developer_token: 'DEV',
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Failed to obtain access token');
    expect(result.message).not.toContain('invalid_client');
    expect(consoleError).toHaveBeenCalled();
  });

  it('executeRequest does not leak upstream error bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'ACCESS', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify([{ error: { message: 'Developer token is not approved for this account' } }]), { status: 403 });
    });
    const res = await googleAdsProvider.executeRequest(
      {
        artifactId: 'art_1',
        connectionId: 'conn_1',
        connectionConfig: {
          id: 'conn_1',
          name: 'gads',
          provider: 'google-ads',
          preferredMode: 'proxy',
          config: { customer_id: '1234567890' },
          createdAt: '',
          updatedAt: '',
        },
        credentials: {
          access_token: '',
          extra: {
            authorized_user: { client_id: 'cid', client_secret: 'sec', refresh_token: 'rtok' },
            developer_token: 'DEV',
          },
        },
        env: ENV,
      },
      googleAdsProvider.getEndpoint('search')!,
      { body: { query: 'SELECT campaign.id FROM campaign' } },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatchObject({ code: 'GOOGLE_ADS_ERROR_403', message: 'Provider request failed (HTTP 403)' });
    expect(res.error?.message).not.toContain('Developer token');
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('BigQuery provider error sanitization', () => {
  it('executeRequest does not leak auth token mint failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Service account token exchange failed: {"error":"invalid_grant"}', { status: 400 }),
    );
    const sa = { client_email: 'svc@proj.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nbad\n-----END PRIVATE KEY-----' };
    const res = await bigQueryProvider.executeRequest(
      {
        artifactId: 'art_1',
        connectionId: 'conn_1',
        connectionConfig: {
          id: 'conn_1',
          name: 'bq',
          provider: 'bigquery',
          preferredMode: 'proxy',
          config: { projectId: 'my-proj' },
          createdAt: '',
          updatedAt: '',
        },
        credentials: { access_token: '', extra: { service_account: sa } },
        env: ENV,
      },
      bigQueryProvider.getEndpoint('jobs.query')!,
      { body: { query: 'SELECT 1' } },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatchObject({ code: 'AUTH_TOKEN_ERROR', message: 'Failed to obtain access token' });
    expect(res.error?.message).not.toContain('invalid_grant');
    expect(consoleError).toHaveBeenCalled();
  });

  it('handleCallback does not leak token exchange bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"invalid_client","error_description":"The client credentials are invalid"}', { status: 401 }),
    );
    await expect(
      bigQueryProvider.handleCallback(
        {
          artifactId: '',
          connectionId: '',
          callbackUrl: 'https://shareout.site/cb',
          state: 's',
          params: {},
          env: { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'sec' } as Env,
        },
        'code',
      ),
    ).rejects.toThrow('Failed to obtain access token');
    expect(consoleError).toHaveBeenCalled();
  });

  it('refreshToken does not leak token refresh bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"invalid_grant","error_description":"Token has been expired or revoked."}', { status: 400 }),
    );
    await expect(
      bigQueryProvider.refreshToken(
        {
          artifactId: '',
          connectionId: '',
          callbackUrl: 'https://shareout.site/cb',
          state: 's',
          params: {},
          env: { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'sec' } as Env,
        },
        'refresh-tok',
      ),
    ).rejects.toThrow('Failed to obtain access token');
    expect(consoleError).toHaveBeenCalled();
  });
});

function sheetsCtx(credentials: Record<string, unknown>): ExecutionContext {
  return {
    artifactId: 'art_1',
    connectionId: 'conn_1',
    connectionConfig: {
      id: 'conn_1',
      name: 'Sheets',
      provider: 'google-sheets',
      preferredMode: 'proxy',
      config: {},
      createdAt: '',
      updatedAt: '',
    },
    credentials: credentials as ExecutionContext['credentials'],
    env: ENV,
  };
}

describe('Google Sheets provider OAuth error sanitization', () => {
  it('handleCallback does not leak token exchange bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"invalid_client","error_description":"The client credentials are invalid"}', { status: 401 }),
    );
    await expect(
      googleSheetsProvider.handleCallback(
        {
          artifactId: '',
          connectionId: '',
          callbackUrl: 'https://shareout.site/cb',
          state: 's',
          params: {},
          env: { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'sec' } as Env,
        },
        'code',
      ),
    ).rejects.toThrow('Failed to obtain access token');
    expect(consoleError).toHaveBeenCalled();
  });

  it('refreshToken does not leak token refresh bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"invalid_grant","error_description":"Token has been expired or revoked."}', { status: 400 }),
    );
    await expect(
      googleSheetsProvider.refreshToken(
        {
          artifactId: '',
          connectionId: '',
          callbackUrl: 'https://shareout.site/cb',
          state: 's',
          params: {},
          env: { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'sec' } as Env,
        },
        'refresh-tok',
      ),
    ).rejects.toThrow('Failed to obtain access token');
    expect(consoleError).toHaveBeenCalled();
  });

  it('executeRequest does not leak upstream error bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 403,
            message: 'The caller does not have permission',
            status: 'PERMISSION_DENIED',
          },
        }),
        { status: 403 },
      ),
    );
    const res = await googleSheetsProvider.executeRequest(
      sheetsCtx({ access_token: 'tok' }),
      googleSheetsProvider.getEndpoint('values.get')!,
      { pathParams: { spreadsheetId: 'abc', range: 'A1' } },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatchObject({
      code: 'SHEETS_ERROR_403',
      message: 'Provider request failed (HTTP 403)',
    });
    expect(res.error?.message).not.toContain('PERMISSION_DENIED');
    expect(res.error?.message).not.toContain('permission');
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('Facebook Ads provider error sanitization', () => {
  it('verifyConnection does not leak Graph API error bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token - Cannot parse access token' } }), { status: 401 }),
    );
    const result = await facebookAdsProvider.verifyConnection!(
      ENV,
      { account_id: '123456789' },
      { access_token: 'bad-tok' },
    );
    expect(result).toMatchObject({ ok: false, message: 'API request failed (HTTP 401)' });
    expect(result.message).not.toContain('Invalid OAuth');
    expect(consoleError).toHaveBeenCalled();
  });

  it('executeRequest does not leak upstream error bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: '(#200) Provide valid app ID' } }), { status: 403 }),
    );
    const res = await facebookAdsProvider.executeRequest(
      {
        artifactId: 'art_1',
        connectionId: 'conn_1',
        connectionConfig: {
          id: 'conn_1',
          name: 'meta',
          provider: 'facebook-ads',
          preferredMode: 'proxy',
          config: { account_id: '123456789' },
          createdAt: '',
          updatedAt: '',
        },
        credentials: { access_token: 'tok' },
        env: ENV,
      },
      facebookAdsProvider.getEndpoint('insights')!,
      {},
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatchObject({ code: 'FACEBOOK_ADS_ERROR_403', message: 'Provider request failed (HTTP 403)' });
    expect(res.error?.message).not.toContain('app ID');
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('Shopify provider error sanitization', () => {
  it('verifyConnection does not leak upstream shop probe bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ errors: '[API] Invalid API key or access token' }), { status: 500 }),
    );
    const result = await shopifyProvider.verifyConnection!(
      ENV,
      { shop: 'demo' },
      { access_token: 'tok' },
    );
    expect(result).toMatchObject({ ok: false, message: 'API request failed (HTTP 500)' });
    expect(result.message).not.toContain('Invalid API key');
    expect(consoleError).toHaveBeenCalled();
  });

  it('executeRequest does not leak upstream error bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ errors: 'Unavailable shop' }), { status: 503 }),
    );
    const res = await shopifyProvider.executeRequest(
      {
        artifactId: 'art_1',
        connectionId: 'conn_1',
        connectionConfig: {
          id: 'conn_1',
          name: 'shop',
          provider: 'shopify',
          preferredMode: 'proxy',
          config: { shop: 'demo' },
          createdAt: '',
          updatedAt: '',
        },
        credentials: { access_token: 'tok' },
        env: ENV,
      },
      shopifyProvider.getEndpoint('shop.get')!,
      {},
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatchObject({ code: 'SHOPIFY_503', message: 'Provider request failed (HTTP 503)' });
    expect(res.error?.message).not.toContain('Unavailable');
    expect(consoleError).toHaveBeenCalled();
  });

  it('handleCallback does not leak token exchange bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"invalid_client","error_description":"The client credentials are invalid"}', { status: 401 }),
    );
    await expect(
      shopifyProvider.handleCallback(
        {
          artifactId: '',
          connectionId: '',
          callbackUrl: 'https://shareout.site/cb',
          state: 's',
          params: { shop: 'demo' },
          env: { SHOPIFY_CLIENT_ID: 'id', SHOPIFY_CLIENT_SECRET: 'sec' } as Env,
        },
        'code',
      ),
    ).rejects.toThrow('Failed to obtain access token');
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('Tienda Nube provider error sanitization', () => {
  it('executeRequest does not leak upstream error bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 404, description: 'Product 999 not found in store 55' }), { status: 404 }),
    );
    const res = await tiendanubeProvider.executeRequest(
      {
        artifactId: 'art_1',
        connectionId: 'conn_1',
        connectionConfig: {
          id: 'conn_1',
          name: 'tn',
          provider: 'tiendanube',
          preferredMode: 'proxy',
          config: { store_id: '55' },
          createdAt: '',
          updatedAt: '',
        },
        credentials: { access_token: 'tok' },
        env: ENV,
      },
      tiendanubeProvider.getEndpoint('products.get')!,
      { pathParams: { id: '999' } },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatchObject({ code: 'TIENDANUBE_404', message: 'Provider request failed (HTTP 404)' });
    expect(res.error?.message).not.toContain('Product 999');
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('Slack provider error sanitization', () => {
  it('handleCallback does not leak Slack OAuth error codes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'invalid_code' }), { status: 200 }),
    );
    await expect(
      slackProvider.handleCallback(
        {
          artifactId: '',
          connectionId: '',
          callbackUrl: 'https://shareout.site/v1/oauth/slack/callback',
          state: 's',
          params: {},
          env: { SLACK_CLIENT_ID: 'id', SLACK_CLIENT_SECRET: 'sec' } as Env,
        },
        'expired-code',
      ),
    ).rejects.toThrow('Failed to obtain access token');
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('Snowflake provider error sanitization', () => {
  it('executeRequest does not leak JWT signing internals', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await snowflakeProvider.executeRequest(
      {
        artifactId: 'art_1',
        connectionId: 'conn_1',
        connectionConfig: {
          id: 'conn_1',
          name: 'sf',
          provider: 'snowflake',
          preferredMode: 'proxy',
          config: {
            account: 'xy12345',
            user: 'svc',
            publicKeyFingerprint: 'SHA256:abc',
          },
          createdAt: '',
          updatedAt: '',
        },
        credentials: { access_token: '', extra: { private_key: 'not-a-valid-pem' } },
        env: ENV,
      },
      snowflakeProvider.getEndpoint('statements.execute')!,
      { body: { statement: 'SELECT 1' } },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatchObject({ code: 'SNOWFLAKE_JWT_ERROR', message: 'Failed to sign Snowflake credentials' });
    expect(res.error?.message).not.toContain('PEM');
    expect(consoleError).toHaveBeenCalled();
  });
});
