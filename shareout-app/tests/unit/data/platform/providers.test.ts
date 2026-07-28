// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleSheetsProvider } from '../../../../src/data/platform/providers/google-sheets';
import { googleAnalyticsProvider } from '../../../../src/data/platform/providers/google-analytics';
import { shopifyProvider } from '../../../../src/data/platform/providers/shopify';
import { tiendanubeProvider } from '../../../../src/data/platform/providers/tiendanube';
import type { AuthContext, ExecutionContext } from '../../../../src/data/platform/types';
import { ARTIFACT_ID, publicArtifactEnv } from './helpers';

const authCtx = (params: Record<string, string> = {}): AuthContext => ({
  artifactId: ARTIFACT_ID,
  connectionId: 'conn_1',
  callbackUrl: 'https://shareout.example.com/callback',
  state: 'state-token',
  params,
  env: publicArtifactEnv(),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Google Sheets provider', () => {
  it('lists endpoints and builds OAuth URLs', async () => {
    expect(googleSheetsProvider.listEndpoints().length).toBeGreaterThan(0);
    const url = await googleSheetsProvider.getAuthUrl(authCtx());
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('google-client-id');
  });

  it('exchanges OAuth codes and refreshes tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'access',
      refresh_token: 'refresh',
      expires_in: 3600,
      scope: 'sheets',
    }), { status: 200 })));

    const tokens = await googleSheetsProvider.handleCallback(authCtx(), 'auth-code');
    expect(tokens.accessToken).toBe('access');

    const refreshed = await googleSheetsProvider.refreshToken(authCtx(), 'refresh');
    expect(refreshed.accessToken).toBe('access');
  });

  it('prepares direct credentials and extracts spreadsheet ids from URLs', async () => {
    const direct = await googleSheetsProvider.prepareDirectCredentials(authCtx(), {
      access_token: 'tok',
      expires_at: Date.now() + 60_000,
    });
    expect(direct.allowedHosts).toContain('sheets.googleapis.com');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ values: [] }), {
      status: 200,
      headers: { 'X-RateLimit-Remaining': '5', 'X-RateLimit-Limit': '10' },
    })));

    const ctx: ExecutionContext = {
      artifactId: ARTIFACT_ID,
      connectionId: 'conn_1',
      connectionConfig: {
        id: 'conn_1',
        name: 's',
        provider: 'google-sheets',
        preferredMode: 'auto',
        config: {},
        createdAt: '',
        updatedAt: '',
      },
      credentials: { access_token: 'tok' },
      env: publicArtifactEnv(),
    };

    const missing = await googleSheetsProvider.executeRequest(ctx, googleSheetsProvider.getEndpoint('values.get')!, {});
    expect(missing.success).toBe(false);
    expect(missing.error?.code).toBe('MISSING_SPREADSHEET_ID');

    const ok = await googleSheetsProvider.executeRequest(
      ctx,
      googleSheetsProvider.getEndpoint('values.get')!,
      { pathParams: { spreadsheetId: 'abc', range: 'A1' } },
    );
    expect(ok.success).toBe(true);

    const fromUrl = await googleSheetsProvider.executeRequest(
      ctx,
      googleSheetsProvider.getEndpoint('values.get')!,
      { queryParams: { spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet123/edit' } },
    );
    expect(fromUrl.success).toBe(true);
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toContain('sheet123');
  });

  it('throws when token exchange fails without leaking upstream bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '{"error":"invalid_grant","error_description":"Token has been expired or revoked."}',
      { status: 400 },
    )));
    await expect(googleSheetsProvider.handleCallback(authCtx(), 'bad')).rejects.toThrow('Failed to obtain access token');
    expect(consoleError).toHaveBeenCalled();
  });

  it('applies update and append query defaults', async () => {
    const ctx: ExecutionContext = {
      artifactId: ARTIFACT_ID,
      connectionId: 'conn_1',
      connectionConfig: {
        id: 'conn_1',
        name: 's',
        provider: 'google-sheets',
        preferredMode: 'auto',
        config: {},
        createdAt: '',
        updatedAt: '',
      },
      credentials: { access_token: 'tok' },
      env: publicArtifactEnv(),
    };

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('values:append')) {
        expect(url).toContain('insertDataOption=INSERT_ROWS');
      }
      if (url.includes('values') && url.includes('PUT')) {
        expect(url).toContain('valueInputOption=USER_ENTERED');
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));

    await googleSheetsProvider.executeRequest(
      ctx,
      googleSheetsProvider.getEndpoint('values.update')!,
      { pathParams: { spreadsheetId: 's1', range: 'A1' }, body: { values: [['x']] } },
    );
    await googleSheetsProvider.executeRequest(
      ctx,
      googleSheetsProvider.getEndpoint('values.append')!,
      { pathParams: { spreadsheetId: 's1', range: 'A1' }, body: { values: [['y']] } },
    );
  });

  it('returns null pagination and parses rate limit headers', () => {
    expect(googleSheetsProvider.extractNextPage({ success: true })).toBeNull();
    const headers = new Headers({ 'X-RateLimit-Remaining': '3', 'X-RateLimit-Limit': '10' });
    expect(googleSheetsProvider.extractRateLimitInfo(new Response(null, { headers }))).toEqual({
      remaining: 3,
      limit: 10,
    });
  });
});

describe('Google Analytics provider', () => {
  it('fetches metadata with query params using the stored token', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      expect(String(input)).toContain('pageSize=10');
      return new Response(JSON.stringify({ dimensions: [] }), { status: 200 });
    }));
    const ctx: ExecutionContext = {
      artifactId: ARTIFACT_ID,
      connectionId: 'conn_1',
      connectionConfig: {
        id: 'conn_1',
        name: 'GA',
        provider: 'google-analytics',
        preferredMode: 'auto',
        config: { propertyId: '12345' },
        createdAt: '',
        updatedAt: '',
      },
      credentials: { access_token: 'tok' },
      env: publicArtifactEnv(),
    };
    const meta = await googleAnalyticsProvider.executeRequest(
      ctx,
      googleAnalyticsProvider.getEndpoint('metadata.get')!,
      { queryParams: { pageSize: 10 } },
    );
    expect(meta.success).toBe(true);
  });

  it('disables interactive OAuth (BYO service account)', async () => {
    await expect(googleAnalyticsProvider.getAuthUrl(authCtx())).rejects.toThrow('not OAuth');
    await expect(googleAnalyticsProvider.handleCallback(authCtx(), 'x')).rejects.toThrow('not OAuth');
    await expect(googleAnalyticsProvider.refreshToken(authCtx(), 'x')).rejects.toThrow('not refreshed');
  });

  it('requires property id and normalizes property paths', async () => {
    const endpoint = googleAnalyticsProvider.getEndpoint('reports.run')!;
    const ctx: ExecutionContext = {
      artifactId: ARTIFACT_ID,
      connectionId: 'conn_1',
      connectionConfig: {
        id: 'conn_1',
        name: 'GA',
        provider: 'google-analytics',
        preferredMode: 'auto',
        config: { propertyId: '12345' },
        createdAt: '',
        updatedAt: '',
      },
      credentials: { access_token: 'tok' },
      env: publicArtifactEnv(),
    };

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      expect(String(input)).toContain('properties%2F12345');
      return new Response(JSON.stringify({ rowCount: 2, rows: [{}, {}] }), { status: 200 });
    }));

    const result = await googleAnalyticsProvider.executeRequest(ctx, endpoint, {
      body: { dateRanges: [] },
    });
    expect(result.success).toBe(true);
    expect(result.pagination).toBeUndefined();
  });

  it('returns API errors and pagination when more rows exist', async () => {
    const endpoint = googleAnalyticsProvider.getEndpoint('reports.run')!;
    const ctx: ExecutionContext = {
      artifactId: ARTIFACT_ID,
      connectionId: 'conn_1',
      connectionConfig: {
        id: 'conn_1',
        name: 'GA',
        provider: 'google-analytics',
        preferredMode: 'auto',
        config: { propertyId: '12345' },
        createdAt: '',
        updatedAt: '',
      },
      credentials: { access_token: 'tok' },
      env: publicArtifactEnv(),
    };

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'Forbidden' },
    }), { status: 403 })));
    const err = await googleAnalyticsProvider.executeRequest(ctx, endpoint, { body: {} });
    expect(err.success).toBe(false);
    expect(err.error?.code).toBe('GA_ERROR_403');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      rowCount: 5,
      rows: [{}, {}],
    }), { status: 200 })));
    const paged = await googleAnalyticsProvider.executeRequest(ctx, endpoint, { body: {} });
    expect(paged.pagination).toEqual({ hasMore: true, nextOffset: 2 });
  });

  it('returns missing property error when id is absent', async () => {
    const ctx: ExecutionContext = {
      artifactId: ARTIFACT_ID,
      connectionId: 'conn_1',
      connectionConfig: {
        id: 'conn_1',
        name: 'GA',
        provider: 'google-analytics',
        preferredMode: 'auto',
        config: {},
        createdAt: '',
        updatedAt: '',
      },
      credentials: { access_token: 'tok' },
      env: publicArtifactEnv(),
    };

    const result = await googleAnalyticsProvider.executeRequest(
      ctx,
      googleAnalyticsProvider.getEndpoint('metadata.get')!,
      {},
    );
    expect(result.error?.code).toBe('MISSING_PROPERTY_ID');
  });
});

describe('Shopify provider', () => {
  it('requires shop for OAuth and rejects refresh/direct modes', async () => {
    await expect(shopifyProvider.getAuthUrl(authCtx())).rejects.toThrow('Shop name is required');
    await expect(shopifyProvider.refreshToken(authCtx(), 'x')).rejects.toThrow('cannot be refreshed');
    await expect(shopifyProvider.prepareDirectCredentials(authCtx(), { access_token: 'x' }))
      .rejects.toThrow('does not support direct mode');
  });

  it('exchanges tokens and executes shop-scoped requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('access_token')) {
        return new Response(JSON.stringify({ access_token: 'shop-tok', scope: 'read_products' }), { status: 200 });
      }
      return new Response(JSON.stringify({ shop: { name: 'Demo' } }), {
        status: 200,
        headers: {
          Link: '<https://demo.myshopify.com/admin/api/next?page_info=abc>; rel="next"',
          'X-Shopify-Shop-Api-Call-Limit': '1/40',
        },
      });
    }));

    const tokens = await shopifyProvider.handleCallback(authCtx({ shop: 'demo' }), 'code');
    expect(tokens.extra?.shop).toBe('demo');

    const ctx: ExecutionContext = {
      artifactId: ARTIFACT_ID,
      connectionId: 'conn_1',
      connectionConfig: {
        id: 'conn_1',
        name: 'Shop',
        provider: 'shopify',
        preferredMode: 'proxy',
        config: { shop: 'demo' },
        createdAt: '',
        updatedAt: '',
      },
      credentials: { access_token: 'shop-tok' },
      env: publicArtifactEnv(),
    };

    const missingShop = await shopifyProvider.executeRequest(
      {
        ...ctx,
        connectionConfig: { ...ctx.connectionConfig, config: {} },
      },
      shopifyProvider.getEndpoint('shop.get')!,
      {},
    );
    expect(missingShop.error?.code).toBe('MISSING_SHOP');

    const ok = await shopifyProvider.executeRequest(
      ctx,
      shopifyProvider.getEndpoint('shop.get')!,
      {},
    );
    expect(ok.success).toBe(true);
    expect(ok.pagination).toEqual({ hasMore: true, cursor: 'abc' });
    expect(ok.rateLimit).toEqual({ remaining: 39, limit: 40 });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errors: 'Unavailable' }), { status: 503 })));
    const err = await shopifyProvider.executeRequest(ctx, shopifyProvider.getEndpoint('shop.get')!, {});
    expect(err.success).toBe(false);
    expect(err.error?.code).toBe('SHOPIFY_503');
  });

  it('builds authorize URL when shop param is provided', async () => {
    const url = await shopifyProvider.getAuthUrl(authCtx({ shop: 'demo' }));
    expect(url).toContain('demo.myshopify.com');
  });
});

describe('Tiendanube provider', () => {
  it('builds authorize URLs and exchanges codes', async () => {
    const url = await tiendanubeProvider.getAuthUrl(authCtx());
    expect(url).toContain('tiendanube.com/apps/tn-client-id');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'tn-tok',
      token_type: 'bearer',
      scope: 'read',
      user_id: 42,
    }), { status: 200 })));

    const tokens = await tiendanubeProvider.handleCallback(authCtx(), 'code');
    expect(tokens.extra?.store_id).toBe('42');
  });

  it('requires store id and supports BR region host', async () => {
    await expect(tiendanubeProvider.refreshToken(authCtx(), 'x')).rejects.toThrow('cannot be refreshed');

    const ctx: ExecutionContext = {
      artifactId: ARTIFACT_ID,
      connectionId: 'conn_1',
      connectionConfig: {
        id: 'conn_1',
        name: 'TN',
        provider: 'tiendanube',
        preferredMode: 'proxy',
        config: { store_id: '99', region: 'br' },
        createdAt: '',
        updatedAt: '',
      },
      credentials: { access_token: 'tn-tok' },
      env: publicArtifactEnv(),
    };

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      expect(String(input)).toContain('api.nuvemshop.com.br');
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          'x-total-count': '0',
          'x-rate-limit-limit': '40',
          'x-rate-limit-remaining': '39',
        },
      });
    }));

    const ok = await tiendanubeProvider.executeRequest(
      ctx,
      tiendanubeProvider.getEndpoint('products.list')!,
      {},
    );
    expect(ok.success).toBe(true);
    expect(ok.pagination).toEqual({ hasMore: false, total: 0 });

    const missing = await tiendanubeProvider.executeRequest(
      { ...ctx, connectionConfig: { ...ctx.connectionConfig, config: {} } },
      tiendanubeProvider.getEndpoint('products.list')!,
      {},
    );
    expect(missing.error?.code).toBe('MISSING_STORE_ID');
  });

  it('returns API errors and uses AR host by default', async () => {
    const ctx: ExecutionContext = {
      artifactId: ARTIFACT_ID,
      connectionId: 'conn_1',
      connectionConfig: {
        id: 'conn_1',
        name: 'TN',
        provider: 'tiendanube',
        preferredMode: 'proxy',
        config: { store_id: '55' },
        createdAt: '',
        updatedAt: '',
      },
      credentials: { access_token: 'tn-tok' },
      env: publicArtifactEnv(),
    };

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      expect(String(input)).toContain('api.tiendanube.com');
      return new Response(JSON.stringify({ code: 404, description: 'Not found' }), { status: 404 });
    }));
    const err = await tiendanubeProvider.executeRequest(
      ctx,
      tiendanubeProvider.getEndpoint('products.get')!,
      { pathParams: { id: '1' } },
    );
    expect(err.error?.code).toBe('TIENDANUBE_404');
  });

  it('parses link pagination with next page cursor', () => {
    const headers = new Headers({
      Link: '<https://api.tiendanube.com/v1/99/products?page=2>; rel="next"',
      'x-total-count': '100',
    });
    const page = tiendanubeProvider.extractNextPage({
      success: true,
      headers,
      data: [],
    });
    expect(page).toEqual({ hasMore: true, cursor: '2', total: 100 });
  });
});
