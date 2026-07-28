// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { handleServeSDK } from '../../src/sdk-serve';
import { handleServeMobileSDK } from '../../src/sdk-mobile-serve';
import { handleServeChartsSDK } from '../../src/sdk-charts-serve';
import { handleServeArtifactCSS } from '../../src/css-serve';
import { handleServeArtifactUI } from '../../src/ui-serve';

function sdkRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://shareout.example.com/sdk/shareout.js', { headers });
}

// The SDK is now served from the ASSETS binding; mock it for handler-logic tests.
// Real bundle content is verified in the workers-pool test below.
const mockEnv = {
  ASSETS: { fetch: async () => new Response('ShareOut '.repeat(200)) },
} as never;

describe('handleServeSDK', () => {
  it('returns 403 when fetched as a document navigation', async () => {
    const response = await handleServeSDK(sdkRequest({ 'Sec-Fetch-Dest': 'document' }), mockEnv);
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Forbidden');
  });

  it('returns 403 when Sec-Fetch-Mode is navigate', async () => {
    const response = await handleServeSDK(sdkRequest({ 'Sec-Fetch-Mode': 'navigate' }), mockEnv);
    expect(response.status).toBe(403);
  });

  it('serves JavaScript with cache and CORS headers', async () => {
    const response = await handleServeSDK(sdkRequest({ 'Sec-Fetch-Dest': 'script' }), mockEnv);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/javascript');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300, must-revalidate');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await response.text()).toContain('ShareOut');
  });

  it('uses an immutable cache for versioned (frozen) delivery', async () => {
    const response = await handleServeSDK(sdkRequest({ 'Sec-Fetch-Dest': 'script' }), mockEnv, true);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });
});

describe('handleServeMobileSDK', () => {
  it('returns 403 for document navigations', async () => {
    const response = await handleServeMobileSDK(sdkRequest({ 'Sec-Fetch-Dest': 'document' }), mockEnv);
    expect(response.status).toBe(403);
  });

  it('serves mobile SDK bundle with security headers', async () => {
    const mobileBody = '/** ShareOut Mobile SDK */ global.ShareOut.mobile';
    const mobileEnv = {
      ASSETS: {
        fetch: async (url: URL) =>
          url.pathname.endsWith('shareout-mobile.js')
            ? new Response(mobileBody)
            : new Response('not found', { status: 404 }),
      },
    } as never;

    const response = await handleServeMobileSDK(sdkRequest({ 'Sec-Fetch-Dest': 'script' }), mobileEnv);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const body = await response.text();
    expect(body).toContain('ShareOut Mobile SDK');
    expect(body).toContain('ShareOut.mobile');
  });
});

describe('handleServeChartsSDK', () => {
  it('returns 403 for document navigations', () => {
    const response = handleServeChartsSDK(sdkRequest({ 'Sec-Fetch-Mode': 'navigate' }));
    expect(response.status).toBe(403);
  });

  it('serves charts SDK bundle', async () => {
    const response = handleServeChartsSDK(sdkRequest({ 'Sec-Fetch-Dest': 'script' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/javascript');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const body = await response.text();
    expect(body).toContain('ShareOutCharts');
    expect(body).toContain('plotly');
  });
});

describe('handleServeArtifactCSS', () => {
  it('returns 403 for document navigations', () => {
    const response = handleServeArtifactCSS(sdkRequest({ 'Sec-Fetch-Dest': 'document' }));
    expect(response.status).toBe(403);
  });

  it('serves brand CSS with cache and CORS headers', async () => {
    const response = handleServeArtifactCSS(sdkRequest({ 'Sec-Fetch-Dest': 'style' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/css; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300, must-revalidate');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const body = await response.text();
    expect(body).toContain('--so-color-primary');
    expect(body).toContain('.so-btn');
  });
});

describe('handleServeArtifactUI', () => {
  it('returns 403 for document navigations', () => {
    const response = handleServeArtifactUI(sdkRequest({ 'Sec-Fetch-Mode': 'navigate' }));
    expect(response.status).toBe(403);
  });

  it('serves the ShareOutUI behavior layer', async () => {
    const response = handleServeArtifactUI(sdkRequest({ 'Sec-Fetch-Dest': 'script' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const body = await response.text();
    expect(body).toContain('ShareOutUI');
    expect(body).toContain('toast');
    // tabs are wired off the editor's spec attribute (single source for app + outline)
    expect(body).toContain('data-shareout-tabs');
    expect(body).not.toContain('data-so-tabs');
  });
});
