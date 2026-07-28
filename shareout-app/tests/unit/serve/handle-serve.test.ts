import { describe, expect, it, vi } from 'vitest';
import './helpers/mocks';
import {
  ARTIFACT_ID,
  BASE_URL,
  SLUG,
  assetsEntry,
  createServeEnv,
  defaultDeployment,
  readStreamResponse,
  serveRequest,
} from './helpers/env';
import { cacheStore, setupServeTestHooks } from './helpers/hooks';
import { handleServe } from '../../../src/serve';
import type { Env } from '../../../src/types';
import { createAccessToken } from '../../../src/token';
import * as auth from '../../../src/auth';

setupServeTestHooks();

describe('handleServe', () => {
  it('returns 404 when deployment is missing', async () => {
    const { env } = createServeEnv({ deployment: null });
    const response = await handleServe(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(404);
  });

  it('returns paused page when artifact is paused', async () => {
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, paused: 1 },
    });
    const response = await handleServe(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('temporarily unavailable');
  });

  it('requires login for private artifacts without session', async () => {
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'private' },
    });
    const response = await handleServe(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(401);
    expect(await response.text()).toContain('login:demo-app');
  });

  it('allows private artifact access for owner session', async () => {
    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: 'usr_1', email: 'owner@example.com' });
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'private' },
      ownerMatch: true,
    });
    const response = await handleServe(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(200);
  });

  it('shows the under-review page (503) to an anon visitor of a held-from-public page', async () => {
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'private', moderation_status: 'pending', moderation_held_visibility: 'public' },
    });
    const response = await handleServe(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('3600');
    const body = await response.text();
    expect(body).toContain('being reviewed');
    expect(body).not.toContain('login:'); // not the misleading login wall
  });

  it('serves a held-from-public page normally to its owner', async () => {
    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: 'usr_1', email: 'owner@example.com' });
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'private', moderation_status: 'pending', moderation_held_visibility: 'public' },
      ownerMatch: true,
    });
    const response = await handleServe(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(200);
  });

  it('keeps the login gate for a plain private page that is not held', async () => {
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'private', moderation_status: 'pending', moderation_held_visibility: null },
    });
    const response = await handleServe(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(401);
    expect(await response.text()).toContain('login:demo-app');
  });

  it('allows workspace-visible artifact access for a workspace member', async () => {
    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: 'usr_member', email: 'member@example.com' });
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'workspace' },
      artifactWorkspaceId: 'ws_1',
      workspaceMemberRole: 'member',
    });
    const response = await handleServe(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(200);
  });

  it('denies workspace-visible artifact for a non-member session', async () => {
    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: 'usr_outsider', email: 'outsider@example.com' });
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'workspace' },
      artifactWorkspaceId: 'ws_1',
      workspaceMemberRole: null,
    });
    const response = await handleServe(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('denied:demo-app');
  });

  it('denies a private workspace artifact to a workspace member who is not the owner', async () => {
    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: 'usr_member', email: 'member@example.com' });
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'private' },
      artifactWorkspaceId: 'ws_1',
      workspaceMemberRole: 'member',
    });
    const response = await handleServe(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('denied:demo-app');
  });

  it('shows password login for password-protected artifacts', async () => {
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'private', auth_method: 'password' },
    });
    const response = await handleServe(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(401);
    expect(await response.text()).toContain('password:demo-app');
  });

  it('shows credentials login for credentials-protected artifacts', async () => {
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'private', auth_method: 'credentials' },
    });
    const response = await handleServe(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(401);
    expect(await response.text()).toContain('credentials:demo-app');
  });

  it('serves sandboxed HTML viewer for public entrypoint', async () => {
    const { env } = createServeEnv();
    const response = await handleServe(serveRequest(''), env, SLUG, '');
    const html = await readStreamResponse(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(html).toContain('iframe');
    expect(html).toContain(`${BASE_URL}/a/${SLUG}/index.html?_raw`);
    // The viewer wrapper is framable by our own app (the Studio embeds artifacts as
    // tabs) but not by external sites — CSP frame-ancestors replaces the old XFO DENY.
    expect(response.headers.get('X-Frame-Options')).toBeNull();
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'self' shareout.example.com *.shareout.example.com");

    const sandbox = html.match(/sandbox="([^"]*)"/)?.[1] ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  it('serves raw HTML asset directly when _raw is set', async () => {
    // Disable the comments overlay so the served body needs no injection and the
    // cache variant is the plain `:raw` (deterministic ETag). See the `:cmt` variant
    // test below for the overlay path.
    const { env, slugsStore } = createServeEnv();
    slugsStore.set(`cmtcfg:${ARTIFACT_ID}`, '0');
    const response = await handleServe(
      serveRequest('index.html?_raw'),
      env,
      SLUG,
      'index.html',
    );

    expect(response.status).toBe(200);
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    // Opaque-origin sandbox: CSP must name the artifact origin so the artifact's
    // own sub-assets still load without 'self' matching.
    expect(csp).toContain(BASE_URL);
    // ETag carries the comments-overlay variant so a flip busts client revalidation.
    expect(response.headers.get('ETag')).toBe('"artifacts/demo/index.html:raw"');
    expect(await response.text()).toContain('<h1>Hello</h1>');
  });

  it('returns 304 when If-None-Match matches the version-addressed ETag', async () => {
    const { env, slugsStore } = createServeEnv();
    slugsStore.set(`cmtcfg:${ARTIFACT_ID}`, '0');
    const response = await handleServe(
      serveRequest('index.html?_raw', {
        headers: { 'If-None-Match': '"artifacts/demo/index.html:raw"' },
      }),
      env,
      SLUG,
      'index.html',
    );

    expect(response.status).toBe(304);
    expect(response.headers.get('ETag')).toBe('"artifacts/demo/index.html:raw"');
  });

  it('edge-caches the public raw HTML entrypoint and serves repeat views from cache (007)', async () => {
    const { env, slugsStore } = createServeEnv();
    slugsStore.set(`cmtcfg:${ARTIFACT_ID}`, '0');
    const r2 = env.ARTIFACTS!.get as ReturnType<typeof vi.fn>;

    const first = await handleServe(serveRequest('index.html?_raw'), env, SLUG, 'index.html');
    expect(first.status).toBe(200);
    expect(await first.text()).toContain('<h1>Hello</h1>');
    const r2CallsAfterFirst = r2.mock.calls.length;
    expect(r2CallsAfterFirst).toBeGreaterThan(0);
    // Cached under the immutable r2_key + comments variant, never the slug URL.
    expect(cacheStore.has('https://artifact-cache.internal/artifacts/demo/index.html:raw')).toBe(true);

    const second = await handleServe(serveRequest('index.html?_raw'), env, SLUG, 'index.html');
    expect(second.status).toBe(200);
    expect(await second.text()).toContain('<h1>Hello</h1>');
    // Served from the edge cache: no additional R2 read, no HTMLRewriter pass.
    expect(r2.mock.calls.length).toBe(r2CallsAfterFirst);
  });

  it('injects the comments agent and keys the cache by a distinct variant when overlay is on (007)', async () => {
    const { env, slugsStore } = createServeEnv();
    slugsStore.set(`cmtcfg:${ARTIFACT_ID}`, '1');
    const response = await handleServe(serveRequest('index.html?_raw'), env, SLUG, 'index.html');
    expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).toBe('"artifacts/demo/index.html:cmt"');
    const html = await response.text();
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('/sdk/comments-agent.js');
    // The overlay body is cached under its own key so it never collides with `:raw`.
    expect(cacheStore.has('https://artifact-cache.internal/artifacts/demo/index.html:cmt')).toBe(true);
    expect(cacheStore.has('https://artifact-cache.internal/artifacts/demo/index.html:raw')).toBe(false);
  });

  it('never edge-caches gated (private) raw HTML even though the public variant would (007)', async () => {
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'private' },
    });
    const ct = await createAccessToken(ARTIFACT_ID, 'content', { SESSION_SECRET: 'session-secret' } as Env, 600);
    const response = await handleServe(serveRequest('?_raw'), env, SLUG, '', { contentOrigin: true, ct });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(cacheStore.size).toBe(0);
  });

  it('uses KV cache on repeat requests and only fetches asset row', async () => {
    const cached = { ...defaultDeployment };
    delete (cached as { r2_key?: string }).r2_key;
    delete (cached as { mime?: string }).mime;
    delete (cached as { size_bytes?: number }).size_bytes;
    // Fattened cache record (entry assets ride the record); a sub-asset request
    // (app.js) still needs its own asset-row fetch.
    (cached as Record<string, unknown>).entry_asset = {
      r2_key: 'artifacts/demo/index.html', mime: 'text/html', size_bytes: 512,
    };
    (cached as Record<string, unknown>).mobile_entry_asset = null;

    const { env } = createServeEnv({
      deployment: null,
      cachedDeployment: cached,
    });

    const response = await handleServe(serveRequest('app.js'), env, SLUG, 'app.js');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('console.log');
  });

  it('serves the entrypoint from the fattened cache without a per-view asset query', async () => {
    const cached = { ...defaultDeployment };
    delete (cached as { r2_key?: string }).r2_key;
    delete (cached as { mime?: string }).mime;
    delete (cached as { size_bytes?: number }).size_bytes;
    (cached as Record<string, unknown>).entry_asset = {
      r2_key: 'artifacts/demo/index.html', mime: 'text/html', size_bytes: 512,
    };
    (cached as Record<string, unknown>).mobile_entry_asset = {
      r2_key: 'artifacts/demo/mobile/index.html', mime: 'text/html', size_bytes: 400,
    };

    // deployment:null ⇒ the combined query returns nothing; a 200 proves the
    // entrypoint was served entirely from the cache record.
    const { env } = createServeEnv({ deployment: null, cachedDeployment: cached });

    const response = await handleServe(serveRequest(''), env, SLUG, '');
    const html = await readStreamResponse(response);
    expect(response.status).toBe(200);
    expect(html).toContain('<iframe');

    const assetQueries = (env.DB!.prepare as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .filter((sql: string) => sql.includes('SELECT r2_key, mime, size_bytes FROM assets'));
    expect(assetQueries).toHaveLength(0);
  });

  it('writes deployment info to KV on cache miss', async () => {
    const { env, slugsStore } = createServeEnv({ cachedDeployment: null });
    await handleServe(serveRequest('app.js'), env, SLUG, 'app.js');
    expect(slugsStore.has(`deploy:${SLUG}`)).toBe(true);
  });

  it('serves mobile entrypoint for mobile user agents', async () => {
    const { env } = createServeEnv();
    const response = await handleServe(
      new Request(`${BASE_URL}/a/${SLUG}/`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
      }),
      env,
      SLUG,
      '',
    );

    const html = await readStreamResponse(response);
    expect(html).toContain('mobile/index.html?_raw');
  });

  it('forces web entrypoint with ?v=web even on mobile', async () => {
    const { env } = createServeEnv();
    const response = await handleServe(
      new Request(`${BASE_URL}/a/${SLUG}/?v=web`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
      }),
      env,
      SLUG,
      '',
    );

    const html = await readStreamResponse(response);
    expect(html).toContain('index.html?_raw');
    expect(html).not.toContain('mobile/index.html?_raw');
  });

  it('forces mobile entrypoint with ?v=mobile on desktop', async () => {
    const { env } = createServeEnv();
    const response = await handleServe(
      new Request(`${BASE_URL}/a/${SLUG}/?v=mobile`),
      env,
      SLUG,
      '',
    );

    const html = await readStreamResponse(response);
    expect(html).toContain('mobile/index.html?_raw');
  });

  it('serves static assets with cache-friendly headers', async () => {
    const { env } = createServeEnv();
    const response = await handleServe(serveRequest('logo.png'), env, SLUG, 'logo.png');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toContain('max-age=31536000');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
  });

  it('supports byte range requests', async () => {
    const { env } = createServeEnv({
      r2: {
        'artifacts/demo/app.js': {
          body: '0123456789',
          range: { offset: 2, length: 4 },
        },
      },
    });

    const response = await handleServe(
      serveRequest('app.js', { headers: { Range: 'bytes=2-5' } }),
      env,
      SLUG,
      'app.js',
    );

    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 2-5/2048');
    expect(await response.text()).toBe('2345');
  });

  it('falls back to index.html when entrypoint asset is missing', async () => {
    const { env } = createServeEnv({
      deployment: {
        ...defaultDeployment,
        entrypoint: 'app.html',
        r2_key: null as unknown as string,
        mime: null as unknown as string,
        size_bytes: null as unknown as number,
      },
      assets: {
        'index.html': {
          r2_key: 'artifacts/demo/index.html',
          mime: 'text/html',
          size_bytes: 100,
        },
      },
    });

    const response = await handleServe(
      serveRequest('?_raw'),
      env,
      SLUG,
      '',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html');
  });

  it('includes PWA meta tags when pwa_config is enabled', async () => {
    const pwaConfig = JSON.stringify({
      enabled: true,
      name: 'My PWA<script>',
      theme_color: '#ff0000',
    });

    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, pwa_config: pwaConfig },
    });

    const html = await readStreamResponse(await handleServe(serveRequest(''), env, SLUG, ''));
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('My PWA&lt;script&gt;');
    expect(html).toContain('shareout-mobile.js');
  });

  it('inlines critical CSS from manifest v2', async () => {
    const manifest = {
      version: 2,
      entrypoint: 'index.html',
      critical: { css: ['style.css'], js: ['app.js'], fonts: [] },
      assets: [
        { path: 'style.css', mime: 'text/css', size: 100, priority: 'critical', inlineable: true },
      ],
    };

    const { env } = createServeEnv({
      manifestJson: JSON.stringify(manifest),
      assets: {
        'index.html': assetsEntry('index.html'),
        'style.css': assetsEntry('style.css'),
        'app.js': assetsEntry('app.js'),
      },
      r2: {
        'artifacts/demo/index.html': { body: '<html></html>' },
        'artifacts/demo/style.css': { body: 'body{color:blue}' },
        'artifacts/demo/app.js': { body: 'console.log(1)' },
      },
    });

    const html = await readStreamResponse(await handleServe(serveRequest(''), env, SLUG, ''));
    expect(html).toContain('inlined-critical');
    expect(html).toContain('body{color:blue}');
    expect(html).toContain('rel="preload"');
  });

  it('injects initial JSON and table data into viewer', async () => {
    const { env } = createServeEnv({
      initialJsonRows: [{ key: 'greeting', value: '"hello"' }],
      initialTables: [{
        id: 'tbl_1',
        name: 'users',
        row_count: 2,
        rows: ['{"id":1}', '{"id":2}'],
      }],
    });

    const html = await readStreamResponse(await handleServe(serveRequest(''), env, SLUG, ''));
    expect(html).toContain('"greeting":"hello"');
    expect(html).toContain('"users"');
    expect(html).toContain('"hasMore":false');
  });

  it('shows admin toolbar for collaborator editor', async () => {
    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: 'usr_2', email: 'editor@example.com' });
    const { env } = createServeEnv({
      collaborator: { role: 'editor' },
    });

    const html = await readStreamResponse(await handleServe(serveRequest(''), env, SLUG, ''));
    expect(html).toContain('shareout-admin-toolbar');
    expect(html).toContain('/a/demo-app/edit');
  });

  it('resolves the viewer session exactly once for a logged-in wrapper view', async () => {
    vi.mocked(auth.getSessionUser).mockClear();
    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: 'usr_1', email: 'owner@example.com' });
    const { env } = createServeEnv(); // public, owner_id = usr_1

    await readStreamResponse(await handleServe(serveRequest(''), env, SLUG, ''));

    // Was resolved 5× before this optimization; now once, shared across the body
    // stream, the detectors, initial-data, and the tracking tail.
    expect(vi.mocked(auth.getSessionUser)).toHaveBeenCalledTimes(1);
  });

  it('shows access denied for authenticated non-collaborator', async () => {
    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: 'usr_9', email: 'stranger@example.com' });
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'private' },
      ownerMatch: false,
      collaborator: null,
    });
    const response = await handleServe(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('denied:demo-app');
  });

  it('allows password-protected artifact with valid access token', async () => {
    vi.mocked(auth.verifyAccessToken).mockResolvedValue(true);
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'private', auth_method: 'password' },
    });
    const response = await handleServe(serveRequest(''), env, SLUG, '');
    expect(response.status).toBe(200);
  });

  it('returns 404 for invalid byte range', async () => {
    const { env } = createServeEnv();
    const response = await handleServe(
      serveRequest('app.js', { headers: { Range: 'bytes=99999-' } }),
      env,
      SLUG,
      'app.js',
    );
    expect(response.status).toBe(200);
  });

  it('uses edge cache for repeated cacheable assets', async () => {
    const { env } = createServeEnv();
    const req = serveRequest('logo.png');
    const first = await handleServe(req, env, SLUG, 'logo.png');
    expect(first.status).toBe(200);

    const second = await handleServe(req, env, SLUG, 'logo.png');
    expect(second.status).toBe(200);
    expect(caches.default.put).toHaveBeenCalled();
  });

  it('returns 404 when a static asset is missing from R2', async () => {
    const { env } = createServeEnv({
      assets: {
        'app.js': { r2_key: 'artifacts/demo/missing.js', mime: 'application/javascript', size_bytes: 10 },
      },
      r2: {},
    });
    const response = await handleServe(serveRequest('app.js'), env, SLUG, 'app.js');
    expect(response.status).toBe(404);
  });

  it('ignores malformed range headers and serves the full asset', async () => {
    const { env } = createServeEnv();
    const response = await handleServe(
      serveRequest('app.js', { headers: { Range: 'bytes=not-a-range' } }),
      env,
      SLUG,
      'app.js',
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('console.log');
  });

  it('loads mobile entrypoint asset rows when serving mobile viewers', async () => {
    const { env } = createServeEnv({
      assets: {
        'index.html': assetsEntry('index.html'),
        'mobile/index.html': assetsEntry('mobile/index.html'),
      },
    });
    const response = await handleServe(
      new Request(`${BASE_URL}/a/${SLUG}/?v=mobile`),
      env,
      SLUG,
      '',
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('mobile/index.html?_raw');
  });

  it('injects table data with hasMore when row_count exceeds the initial limit', async () => {
    const { env } = createServeEnv({
      initialTables: [{
        id: 'tbl_big',
        name: 'events',
        row_count: 150,
        rows: ['{"id":1}'],
      }],
    });
    const html = await readStreamResponse(await handleServe(serveRequest(''), env, SLUG, ''));
    expect(html).toContain('"hasMore":true');
  });

  it('skips invalid initial JSON rows and respects the initial JSON size budget', async () => {
    const largeValue = JSON.stringify('x'.repeat(40 * 1024));
    const { env } = createServeEnv({
      initialJsonRows: [
        { key: 'bad', value: 'not-json' },
        { key: 'big1', value: largeValue },
        { key: 'big2', value: largeValue },
      ],
    });
    const html = await readStreamResponse(await handleServe(serveRequest(''), env, SLUG, ''));
    expect(html).not.toContain('"bad"');
    expect(html).toContain('"big1"');
    expect(html).not.toContain('"big2"');
  });

  it('preloads non-inlineable CSS, JS, and fonts from manifest v2', async () => {
    const manifest = {
      version: 2,
      entrypoint: 'index.html',
      critical: { css: ['style.css', 'theme.css'], js: ['app.js'], fonts: ['fonts/inter.woff2'] },
      assets: [
        { path: 'style.css', mime: 'text/css', size: 100, priority: 'critical', inlineable: true },
        { path: 'theme.css', mime: 'text/css', size: 100, priority: 'critical', inlineable: false },
        { path: 'fonts/inter.woff2', mime: 'font/woff2', size: 100, priority: 'critical', inlineable: false },
      ],
    };

    const { env } = createServeEnv({
      manifestJson: JSON.stringify(manifest),
      assets: {
        'index.html': assetsEntry('index.html'),
        'style.css': assetsEntry('style.css'),
        'theme.css': assetsEntry('theme.css'),
        'app.js': assetsEntry('app.js'),
        'fonts/inter.woff2': {
          r2_key: 'artifacts/demo/fonts/inter.woff2',
          mime: 'font/woff2',
          size_bytes: 128,
        },
      },
      r2: {
        'artifacts/demo/index.html': { body: '<html></html>' },
        'artifacts/demo/style.css': { body: 'body{color:blue}' },
        'artifacts/demo/theme.css': { body: 'body{color:red}' },
        'artifacts/demo/app.js': { body: 'console.log(1)' },
        'artifacts/demo/fonts/inter.woff2': { body: 'font-bytes' },
      },
    });

    const html = await readStreamResponse(await handleServe(serveRequest(''), env, SLUG, ''));
    expect(html).toContain('theme.css?_raw');
    expect(html).toContain('fonts/inter.woff2?_raw" as="font" crossorigin');
    expect(html).toContain('app.js?_raw" as="script"');
  });

  it('falls back to critical asset preloads when manifest v2 is unavailable', async () => {
    const { env } = createServeEnv({
      manifestJson: null,
      assets: {
        'index.html': assetsEntry('index.html'),
        'theme.woff2': {
          r2_key: 'artifacts/demo/theme.woff2',
          mime: 'font/woff2',
          size_bytes: 128,
        },
      },
    });

    const html = await readStreamResponse(await handleServe(serveRequest(''), env, SLUG, ''));
    expect(html).toContain('theme.woff2?_raw" as="font" crossorigin');
  });

  it('shows admin toolbar for artifact owners', async () => {
    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: 'usr_1', email: 'owner@example.com' });
    const { env } = createServeEnv({ ownerMatch: true });
    const html = await readStreamResponse(await handleServe(serveRequest(''), env, SLUG, ''));
    expect(html).toContain('shareout-admin-toolbar');
  });

  it('streams a fallback viewer shell when enrichment fails', async () => {
    const { env } = createServeEnv({ throwOnManifest: true });
    const html = await readStreamResponse(await handleServe(serveRequest(''), env, SLUG, ''));
    expect(html).toContain('<iframe');
    expect(html).toContain('index.html?_raw');
  });

  it('continues serving when initial JSON or table lookups fail', async () => {
    for (const scenario of [
      { throwOnInitialJson: true },
      { throwOnInitialTables: true },
    ] as const) {
      const { env } = createServeEnv(scenario);
      const html = await readStreamResponse(await handleServe(serveRequest(''), env, SLUG, ''));
      expect(html).toContain('<iframe');
    }
  });

  it('continues serving when admin detection fails', async () => {
    vi.mocked(auth.getSessionUser).mockRejectedValue(new Error('session unavailable'));
    const { env } = createServeEnv();
    const html = await readStreamResponse(await handleServe(serveRequest(''), env, SLUG, ''));
    expect(html).toContain('<iframe');
    expect(html).not.toContain('shareout-admin-toolbar');
  });
});
