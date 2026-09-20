import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  parseVendorPath,
  mapCdnUrl,
  rewriteVendorUrls,
  handleServeVendorLib,
  vendorR2Key,
  upstreamUrl,
  isPackageAllowed,
  resolveAllowedPackages,
  isValidPackageName,
} from '../../src/vendor-cdn';
import { vendorizePublishFiles } from '../../src/publish/vendorize';
import type { Env, FileEntry } from '../../src/types';

const BASE = 'https://shareout.test';

describe('parseVendorPath', () => {
  it('parses a vendored file path', () => {
    expect(parseVendorPath('/vendor/plotly.js-dist-min@2.35.2/plotly.min.js')).toEqual({
      pkg: 'plotly.js-dist-min', version: '2.35.2', file: 'plotly.min.js',
    });
  });

  it('parses a nested file and a loose version', () => {
    expect(parseVendorPath('/vendor/d3@7/dist/d3.min.js')).toEqual({
      pkg: 'd3', version: '7', file: 'dist/d3.min.js',
    });
  });

  it('parses the shape without judging the package — that is packages.ts', () => {
    expect(parseVendorPath('/vendor/left-pad@1.0.0/index.js')).toEqual({
      pkg: 'left-pad', version: '1.0.0', file: 'index.js',
    });
    expect(parseVendorPath('/vendor/@scope/pkg@1.0.0/index.js')).toEqual({
      pkg: '@scope/pkg', version: '1.0.0', file: 'index.js',
    });
  });

  it('refuses traversal, non-code files and bad versions', () => {
    expect(parseVendorPath('/vendor/d3@7/../../secret.js')).toBeNull();
    expect(parseVendorPath('/vendor/d3@7/package.json')).toBeNull();
    expect(parseVendorPath('/vendor/d3@latest/dist/d3.min.js')).toBeNull();
    expect(parseVendorPath('/sdk/shareout.js')).toBeNull();
  });
});

describe('mapCdnUrl', () => {
  it('maps the plotly bundles', () => {
    expect(mapCdnUrl('https://cdn.plot.ly/plotly-2.35.2.min.js')).toEqual({
      pkg: 'plotly.js-dist-min', version: '2.35.2', file: 'plotly.min.js',
    });
    expect(mapCdnUrl('https://cdn.plot.ly/plotly-basic-2.35.2.min.js')).toEqual({
      pkg: 'plotly.js-basic-dist-min', version: '2.35.2', file: 'plotly-basic.min.js',
    });
  });

  it('pins the frozen plotly -latest alias', () => {
    expect(mapCdnUrl('https://cdn.plot.ly/plotly-latest.min.js')?.version).toBe('1.58.5');
  });

  it('maps d3js.org, jsdelivr and unpkg npm paths', () => {
    expect(mapCdnUrl('https://d3js.org/d3.v7.min.js')).toEqual({
      pkg: 'd3', version: '7', file: 'dist/d3.min.js',
    });
    expect(mapCdnUrl('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js')).toEqual({
      pkg: 'chart.js', version: '4.4.1', file: 'dist/chart.umd.js',
    });
    expect(mapCdnUrl('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css')).toEqual({
      pkg: 'leaflet', version: '1.9.4', file: 'dist/leaflet.css',
    });
  });

  it('leaves alone what it cannot map exactly', () => {
    expect(mapCdnUrl('https://cdn.jsdelivr.net/npm/left-pad@1.0.0/index.js')).toBeNull();
    expect(mapCdnUrl('https://cdn.jsdelivr.net/npm/chart.js@4/+esm')).toBeNull();
    expect(mapCdnUrl('https://cdn.tailwindcss.com')).toBeNull();
    expect(mapCdnUrl('https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js')).toBeNull();
    expect(mapCdnUrl('https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js?v=1')).toBeNull();
    expect(mapCdnUrl('not a url')).toBeNull();
  });
});

describe('rewriteVendorUrls', () => {
  it('rewrites quoted script and link URLs', () => {
    const html = `<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>`;
    expect(rewriteVendorUrls(html, BASE)).toBe(
      `<script src="${BASE}/vendor/plotly.js-dist-min@2.35.2/plotly.min.js"></script>`,
    );
  });

  it('rewrites a protocol-relative URL and a dynamic import', () => {
    expect(rewriteVendorUrls(`import('//d3js.org/d3.v7.min.js')`, BASE))
      .toContain(`${BASE}/vendor/d3@7/dist/d3.min.js`);
  });

  it('leaves unquoted prose and unknown hosts untouched', () => {
    const prose = `<p>We load https://cdn.plot.ly/plotly-2.35.2.min.js today</p>`;
    expect(rewriteVendorUrls(prose, BASE)).toBe(prose);
    const other = `<script src="https://example.com/app.js"></script>`;
    expect(rewriteVendorUrls(other, BASE)).toBe(other);
  });
});

describe('vendorizePublishFiles', () => {
  const html: FileEntry = {
    path: 'index.html',
    mime: 'text/html',
    content: `<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>`,
  };
  const env = { SHAREOUT_BASE_URL: BASE } as unknown as Env;

  it('rewrites html files and the mobile entrypoint', async () => {
    const out = await vendorizePublishFiles(env, [html], html.content);
    expect(out.files[0].content).toContain(`${BASE}/vendor/plotly.js-dist-min@2.35.2/`);
    expect(out.mobileHtml).toContain(`${BASE}/vendor/`);
  });

  it('leaves non-html and base64 assets alone', async () => {
    const css: FileEntry = { path: 'a.css', mime: 'text/css', content: html.content };
    expect((await vendorizePublishFiles(env, [css])).files[0].content).toBe(html.content);
    const b64: FileEntry = { ...html, encoding: 'base64' };
    expect((await vendorizePublishFiles(env, [b64])).files[0].content).toBe(html.content);
  });

  it('is a no-op when the instance opts out', async () => {
    const off = { SHAREOUT_BASE_URL: BASE, VENDOR_LIBS_DISABLED: '1' } as unknown as Env;
    expect((await vendorizePublishFiles(off, [html])).files[0].content).toBe(html.content);
  });

  it('rewrites a package the workspace registered', async () => {
    const withWs = {
      SHAREOUT_BASE_URL: BASE,
      DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ package: 'highcharts' }] }) }) }) },
    } as unknown as Env;
    const src: FileEntry = {
      path: 'index.html', mime: 'text/html',
      content: `<script src="https://cdn.jsdelivr.net/npm/highcharts@11.4.8/highcharts.js"></script>`,
    };
    const out = await vendorizePublishFiles(withWs, [src], undefined, 'wsp_1');
    expect(out.files[0].content).toContain(`${BASE}/vendor/highcharts@11.4.8/highcharts.js`);
  });

  it('rewrites anything npm-shaped when the instance allows any package', async () => {
    const anyEnv = { SHAREOUT_BASE_URL: BASE, VENDOR_ALLOW_ANY: '1' } as unknown as Env;
    const src: FileEntry = {
      path: 'index.html', mime: 'text/html',
      content: `<script src="https://unpkg.com/left-pad@1.3.0/index.js"></script>`,
    };
    expect((await vendorizePublishFiles(anyEnv, [src])).files[0].content)
      .toContain(`${BASE}/vendor/left-pad@1.3.0/index.js`);
  });
});

describe('handleServeVendorLib', () => {
  const path = '/vendor/d3@7/dist/d3.min.js';
  const req = new Request(`https://cdn.test${path}`);

  afterEach(() => vi.unstubAllGlobals());

  it('serves stored bytes immutably without touching upstream', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const env = { ARTIFACTS: { get: vi.fn().mockResolvedValue({ body: 'BYTES', size: 5 }) } } as unknown as Env;

    const res = await handleServeVendorLib(req, env, path);
    expect(res!.status).toBe(200);
    expect(res!.headers.get('Cache-Control')).toContain('immutable');
    expect(res!.headers.get('Content-Type')).toContain('javascript');
    expect(env.ARTIFACTS.get).toHaveBeenCalledWith(vendorR2Key({ pkg: 'd3', version: '7', file: 'dist/d3.min.js' }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('pulls once from upstream on a cold miss and stores it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('UPSTREAM', { status: 200 })));
    const put = vi.fn().mockResolvedValue(undefined);
    const env = { ARTIFACTS: { get: vi.fn().mockResolvedValue(null), put } } as unknown as Env;
    const waitUntil = vi.fn();

    const res = await handleServeVendorLib(req, env, path, { waitUntil } as unknown as ExecutionContext);
    expect(await res!.text()).toBe('UPSTREAM');
    expect(put).toHaveBeenCalled();
    expect(waitUntil).toHaveBeenCalled();
  });

  it('falls back to the public CDN rather than breaking the artifact', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    const env = { ARTIFACTS: { get: vi.fn().mockResolvedValue(null), put: vi.fn() } } as unknown as Env;

    const res = await handleServeVendorLib(req, env, path);
    expect(res!.status).toBe(302);
    expect(res!.headers.get('Location')).toBe(upstreamUrl({ pkg: 'd3', version: '7', file: 'dist/d3.min.js' }));
  });

  it('404s a package nobody allowed and ignores non-vendor paths', async () => {
    const env = {
      ARTIFACTS: { get: vi.fn() },
      DB: { prepare: () => ({ all: async () => ({ results: [] }) }) },
    } as unknown as Env;
    const unknown = '/vendor/left-pad@1.0.0/i.js';
    expect((await handleServeVendorLib(new Request(`https://cdn.test${unknown}`), env, unknown))!.status).toBe(404);
    expect(env.ARTIFACTS.get).not.toHaveBeenCalled();
    expect(await handleServeVendorLib(new Request('https://cdn.test/sdk/shareout.js'), env, '/sdk/shareout.js')).toBeNull();
  });

  it('serves a package a workspace registered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('UPSTREAM', { status: 200 })));
    const path = '/vendor/highcharts@11.4.8/highcharts.js';
    const env = {
      ARTIFACTS: { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) },
      DB: { prepare: () => ({ all: async () => ({ results: [{ package: 'highcharts' }] }) }) },
    } as unknown as Env;
    const res = await handleServeVendorLib(new Request(`https://cdn.test${path}`), env, path);
    expect(res!.status).toBe(200);
  });
});

describe('package layers', () => {
  const plain = { DB: { prepare: () => ({ all: async () => ({ results: [] }) }) } } as unknown as Env;

  it('allows a built-in package without touching the database', async () => {
    const db = { prepare: vi.fn() };
    expect(await isPackageAllowed({ DB: db } as unknown as Env, 'd3')).toBe(true);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('allows what the operator listed in VENDOR_PACKAGES_EXTRA', async () => {
    const env = { ...plain, VENDOR_PACKAGES_EXTRA: ' highcharts , vis-network ' } as unknown as Env;
    expect(await isPackageAllowed(env, 'highcharts')).toBe(true);
    expect(await isPackageAllowed(env, 'vis-network')).toBe(true);
    expect(await isPackageAllowed(env, 'left-pad')).toBe(false);
  });

  it('allows any valid npm name when the operator opts into allow-any', async () => {
    const env = { VENDOR_ALLOW_ANY: '1' } as unknown as Env;
    expect(await isPackageAllowed(env, 'left-pad')).toBe(true);
    expect(await isPackageAllowed(env, '../etc/passwd')).toBe(false);
  });

  it('falls back to workspace-registered rows', async () => {
    const env = {
      DB: { prepare: () => ({ all: async () => ({ results: [{ package: 'highcharts' }] }) }) },
    } as unknown as Env;
    expect(await isPackageAllowed(env, 'highcharts')).toBe(true);
  });

  it('keeps serving the built-ins when the lookup fails', async () => {
    const broken = { DB: { prepare: () => { throw new Error('d1 down'); } } } as unknown as Env;
    expect(await isPackageAllowed(broken, 'd3')).toBe(true);
    expect(await isPackageAllowed(broken, 'highcharts')).toBe(false);
    expect([...(await resolveAllowedPackages(broken, 'wsp_1'))]).toContain('d3');
  });

  it('validates npm package names', () => {
    expect(isValidPackageName('chart.js')).toBe(true);
    expect(isValidPackageName('@scope/name')).toBe(true);
    expect(isValidPackageName('Chart.JS')).toBe(false);
    expect(isValidPackageName('../evil')).toBe(false);
    expect(isValidPackageName('')).toBe(false);
  });
});
