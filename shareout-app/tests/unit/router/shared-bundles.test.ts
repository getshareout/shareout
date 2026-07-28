// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

// Mock every underlying bundle handler so these tests assert ONLY the routing/matching
// logic in serveSharedBundle (which path -> which handler, version gating, method
// guard, null fallthrough). The handlers themselves are covered by
// sdk-serve-handlers.test.ts.
const mocks = vi.hoisted(() => ({
  handleServeSDK: vi.fn(),
  handleServeCommentsAgent: vi.fn(),
  handleServeEditor: vi.fn(),
  handleServeMobileSDK: vi.fn(),
  handleServeChartsSDK: vi.fn(),
  handleServeArtifactCSS: vi.fn(),
  handleServeArtifactUI: vi.fn(),
}));

vi.mock('../../../src/sdk-serve', () => ({
  handleServeSDK: mocks.handleServeSDK,
  handleServeCommentsAgent: mocks.handleServeCommentsAgent,
}));
vi.mock('../../../src/editor-serve', () => ({ handleServeEditor: mocks.handleServeEditor }));
vi.mock('../../../src/sdk-mobile-serve', () => ({ handleServeMobileSDK: mocks.handleServeMobileSDK }));
vi.mock('../../../src/sdk-charts-serve', () => ({ handleServeChartsSDK: mocks.handleServeChartsSDK }));
vi.mock('../../../src/css-serve', () => ({ handleServeArtifactCSS: mocks.handleServeArtifactCSS }));
vi.mock('../../../src/ui-serve', () => ({ handleServeArtifactUI: mocks.handleServeArtifactUI }));

import { serveSharedBundle } from '../../../src/router/shared-bundles';

const env = {} as Env;
const sentinel = (name: string) => new Response(name, { status: 200 });
const get = (path: string) => new Request(`https://host.example${path}`);

// Minimal in-memory Cache API stand-in: node env has no `caches` global, and the
// edge-cache wrapper (016 Stage A) only needs match/put keyed by request URL.
function installFakeCache() {
  const store = new Map<string, Response>();
  const cache = {
    match: async (req: Request) => {
      const hit = store.get(req.url);
      return hit ? hit.clone() : undefined;
    },
    put: async (req: Request, res: Response) => {
      store.set(req.url, res.clone());
    },
  };
  (globalThis as unknown as { caches: { default: typeof cache } }).caches = { default: cache };
  return store;
}

beforeEach(() => {
  for (const [name, fn] of Object.entries(mocks)) {
    fn.mockReset();
    fn.mockReturnValue(sentinel(name));
  }
  installFakeCache();
});

afterEach(() => {
  vi.clearAllMocks();
  delete (globalThis as unknown as { caches?: unknown }).caches;
});

describe('serveSharedBundle — unversioned aliases (float to current major, mutable cache)', () => {
  const cases: Array<[string, keyof typeof mocks]> = [
    ['/sdk/shareout.js', 'handleServeSDK'],
    ['/sdk/shareout-mobile.js', 'handleServeMobileSDK'],
    ['/sdk/shareout-charts.js', 'handleServeChartsSDK'],
    ['/sdk/shareout.css', 'handleServeArtifactCSS'],
    ['/sdk/shareout-ui.js', 'handleServeArtifactUI'],
    ['/sdk/editor.js', 'handleServeEditor'],
    ['/sdk/comments-agent.js', 'handleServeCommentsAgent'],
  ];

  for (const [path, handler] of cases) {
    it(`${path} -> ${handler}`, async () => {
      const res = await serveSharedBundle(get(path), env, path);
      expect(res).not.toBeNull();
      expect(await (res as Response).text()).toBe(handler);
      expect(mocks[handler]).toHaveBeenCalledTimes(1);
    });
  }

  it('passes immutable=false to the SDK handler for the floating alias', async () => {
    await serveSharedBundle(get('/sdk/shareout.js'), env, '/sdk/shareout.js');
    expect(mocks.handleServeSDK).toHaveBeenCalledWith(expect.any(Request), env, false);
  });
});

describe('serveSharedBundle — versioned (immutable) paths', () => {
  it('/sdk/v1/shareout.js serves with immutable=true', async () => {
    await serveSharedBundle(get('/sdk/v1/shareout.js'), env, '/sdk/v1/shareout.js');
    expect(mocks.handleServeSDK).toHaveBeenCalledWith(expect.any(Request), env, true);
  });

  it('/sdk/v1/shareout-charts.js routes to the charts handler with immutable=true', async () => {
    await serveSharedBundle(get('/sdk/v1/shareout-charts.js'), env, '/sdk/v1/shareout-charts.js');
    expect(mocks.handleServeChartsSDK).toHaveBeenCalledWith(expect.any(Request), true);
  });

  it('returns 404 for an unsupported major instead of calling a handler', async () => {
    const res = await serveSharedBundle(get('/sdk/v9/shareout.js'), env, '/sdk/v9/shareout.js');
    expect((res as Response).status).toBe(404);
    expect(mocks.handleServeSDK).not.toHaveBeenCalled();
  });
});

describe('serveSharedBundle — non-matches fall through (return null)', () => {
  const nonMatches = [
    '/',
    '/a/demo/index.html',
    '/c/tok/app.js',
    '/sdk/unknown.js',
    '/sdk/shareout.js/extra',
    '/sdk/shareout.json',
    '/assets/sdk/shareout.js',
    '/sdk/v/shareout.js', // empty version
  ];

  for (const path of nonMatches) {
    it(`${path} -> null`, () => {
      expect(serveSharedBundle(get(path), env, path)).toBeNull();
    });
  }

  it('does not invoke any handler for a non-match', () => {
    serveSharedBundle(get('/a/demo/index.html'), env, '/a/demo/index.html');
    for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled();
  });
});

describe('serveSharedBundle — method guard', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
    it(`returns null for ${method} even on a bundle path`, () => {
      const req = new Request('https://host.example/sdk/shareout.js', { method });
      expect(serveSharedBundle(req, env, '/sdk/shareout.js')).toBeNull();
      expect(mocks.handleServeSDK).not.toHaveBeenCalled();
    });
  }
});

describe('serveSharedBundle — edge cache (016 Stage A)', () => {
  it('serves a second identical GET from cache without re-invoking the handler', async () => {
    const first = await serveSharedBundle(get('/sdk/shareout.js'), env, '/sdk/shareout.js');
    expect(await (first as Response).text()).toBe('handleServeSDK');
    expect(mocks.handleServeSDK).toHaveBeenCalledTimes(1);

    const second = await serveSharedBundle(get('/sdk/shareout.js'), env, '/sdk/shareout.js');
    expect(await (second as Response).text()).toBe('handleServeSDK');
    expect(mocks.handleServeSDK).toHaveBeenCalledTimes(1); // not called again
  });

  it('does not cache a non-200 response (handler returns 404)', async () => {
    mocks.handleServeArtifactCSS.mockReturnValue(new Response('nope', { status: 404 }));
    const first = await serveSharedBundle(get('/sdk/shareout.css'), env, '/sdk/shareout.css');
    expect((first as Response).status).toBe(404);

    mocks.handleServeArtifactCSS.mockReturnValue(sentinel('handleServeArtifactCSS'));
    const second = await serveSharedBundle(get('/sdk/shareout.css'), env, '/sdk/shareout.css');
    expect((second as Response).status).toBe(200);
    expect(mocks.handleServeArtifactCSS).toHaveBeenCalledTimes(2); // 404 was not stored
  });

  it('403s a document/navigate request for shareout.js and never caches it', async () => {
    const navReq = new Request('https://host.example/sdk/shareout.js', {
      headers: { 'Sec-Fetch-Dest': 'document' },
    });
    const res = await serveSharedBundle(navReq, env, '/sdk/shareout.js');
    expect((res as Response).status).toBe(403);
    expect(mocks.handleServeSDK).not.toHaveBeenCalled();

    // A subsequent legit script GET still produces a fresh 200 (no poisoned cache).
    const ok = await serveSharedBundle(get('/sdk/shareout.js'), env, '/sdk/shareout.js');
    expect((ok as Response).status).toBe(200);
    expect(mocks.handleServeSDK).toHaveBeenCalledTimes(1);
  });

  it('does not let distinct bundle paths collide in the cache', async () => {
    await serveSharedBundle(get('/sdk/shareout.js'), env, '/sdk/shareout.js');
    const css = await serveSharedBundle(get('/sdk/shareout.css'), env, '/sdk/shareout.css');
    expect(await (css as Response).text()).toBe('handleServeArtifactCSS');
    expect(mocks.handleServeArtifactCSS).toHaveBeenCalledTimes(1);
  });
});
