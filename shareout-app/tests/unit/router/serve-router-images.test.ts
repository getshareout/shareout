import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { routeServe } from '../../../src/router/serve-router';
import { createFetchContext } from '../../../src/router/context';
import type { Env } from '../../../src/types';

// 007 Stage D: /t (thumbnails) and /wl (workspace logos) read R2 once, then serve
// repeat cross-viewer requests from the edge cache (caches.default) without re-reading
// R2. The R2 keys are entity-addressed (reused on re-upload), so the bounded
// max-age=86400 doubles as the shared-cache TTL.
//
// Thumbnails now consult artifact visibility before serving. Default mock is public
// so existing edge-cache tests stay focused; private cases are covered separately.

function makeDb(visibilityById: Record<string, string> = {}) {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => {
          if (!sql.includes('FROM artifacts')) return null;
          const id = String(args[0] ?? '');
          // Default public so open artifacts still edge-cache freely.
          const visibility = visibilityById[id] ?? 'public';
          return {
            id,
            name: 'Demo',
            visibility,
            auth_method: 'google',
            owner_id: 'usr_owner',
            workspace_id: 'ws_1',
          };
        }),
        all: vi.fn(async () => ({ results: [] })),
      })),
    })),
  };
}

function makeEnv(
  r2Store: Record<string, string>,
  opts?: { visibilityById?: Record<string, string> },
) {
  const get = vi.fn(async (key: string) => {
    if (!(key in r2Store)) return null;
    return { body: r2Store[key] };
  });
  return {
    ARTIFACTS: { get },
    DB: makeDb(opts?.visibilityById),
    SHAREOUT_BASE_URL: 'https://shareout.site',
  } as unknown as Env & { ARTIFACTS: { get: ReturnType<typeof vi.fn> } };
}

function ctxFor(path: string, env: Env, executionCtx?: ExecutionContext) {
  return createFetchContext(new Request(`https://shareout.site${path}`), env, executionCtx);
}

let cacheStore: Map<string, Response>;
let waitUntil: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cacheStore = new Map();
  vi.stubGlobal('caches', {
    default: {
      match: vi.fn(async (key: Request) => cacheStore.get(key.url) ?? null),
      put: vi.fn(async (key: Request, response: Response) => {
        cacheStore.set(key.url, response.clone());
      }),
    },
  });
  waitUntil = vi.fn((p: Promise<unknown>) => p);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('routeServe — cached R2 images (007 Stage D)', () => {
  it('thumbnail: reads R2 once, serves the repeat view from the edge cache', async () => {
    const env = makeEnv({ 'thumbnails/art_1.webp': 'WEBPBYTES' });
    const exec = { waitUntil } as unknown as ExecutionContext;

    const first = await routeServe(ctxFor('/t/art_1.webp', env, exec));
    expect(first?.status).toBe(200);
    expect(first?.headers.get('Content-Type')).toBe('image/webp');
    expect(first?.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(env.ARTIFACTS.get).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);

    const second = await routeServe(ctxFor('/t/art_1.webp', env, exec));
    expect(second?.status).toBe(200);
    // No second R2 read — served from caches.default.
    expect(env.ARTIFACTS.get).toHaveBeenCalledTimes(1);
  });

  it('workspace logo: reads R2 once, serves the repeat view from the edge cache', async () => {
    const env = makeEnv({ 'workspace-logos/ws_1.png': 'PNGBYTES' });
    const exec = { waitUntil } as unknown as ExecutionContext;

    const first = await routeServe(ctxFor('/wl/ws_1.png', env, exec));
    expect(first?.headers.get('Content-Type')).toBe('image/png');
    expect(env.ARTIFACTS.get).toHaveBeenCalledTimes(1);

    await routeServe(ctxFor('/wl/ws_1.png', env, exec));
    expect(env.ARTIFACTS.get).toHaveBeenCalledTimes(1);
  });

  it('thumbnail and logo use distinct cache keys (no cross-collision)', async () => {
    const env = makeEnv({
      'thumbnails/x.webp': 'THUMB',
      'workspace-logos/x.webp': 'LOGO',
    });
    const exec = { waitUntil } as unknown as ExecutionContext;

    expect(await (await routeServe(ctxFor('/t/x.webp', env, exec)))!.text()).toBe('THUMB');
    expect(await (await routeServe(ctxFor('/wl/x.webp', env, exec)))!.text()).toBe('LOGO');
    expect(env.ARTIFACTS.get).toHaveBeenCalledTimes(2);
  });

  it('returns 404 (uncached) when the R2 object is missing', async () => {
    const env = makeEnv({});
    const res = await routeServe(ctxFor('/t/missing.webp', env));
    expect(res?.status).toBe(404);
    expect(caches.default.put).not.toHaveBeenCalled();
  });

  it('card variant: serves the card image when present', async () => {
    const env = makeEnv({
      'thumbnails/art_1.webp': 'FULL',
      'thumbnails/art_1_card.webp': 'CARD',
    });
    const exec = { waitUntil } as unknown as ExecutionContext;
    expect(await (await routeServe(ctxFor('/t/art_1_card.webp', env, exec)))!.text()).toBe('CARD');
  });

  it('card variant: falls back to the full preview when the card image is missing', async () => {
    const env = makeEnv({ 'thumbnails/art_1.webp': 'FULL' });
    const exec = { waitUntil } as unknown as ExecutionContext;
    const res = await routeServe(ctxFor('/t/art_1_card.webp', env, exec));
    expect(res?.status).toBe(200);
    expect(await res!.text()).toBe('FULL');
  });

  it('private thumbnail: 404 for unauthorized visitors and does not edge-cache', async () => {
    const env = makeEnv(
      { 'thumbnails/art_secret.webp': 'SECRET' },
      { visibilityById: { art_secret: 'private' } },
    );
    const res = await routeServe(ctxFor('/t/art_secret.webp', env));
    expect(res?.status).toBe(404);
    expect(env.ARTIFACTS.get).not.toHaveBeenCalled();
    expect(caches.default.put).not.toHaveBeenCalled();
  });

  it('unknown artifact id for /t/* returns 404 without R2 read', async () => {
    const env = makeEnv({ 'thumbnails/art_1.webp': 'WEBP' });
    // Empty visibility map still returns a synthetic row as public by default —
    // simulate missing artifact by making first() return null.
    (env as unknown as { DB: { prepare: ReturnType<typeof vi.fn> } }).DB = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => null),
          all: vi.fn(async () => ({ results: [] })),
        })),
      })),
    } as never;
    const res = await routeServe(ctxFor('/t/art_1.webp', env));
    expect(res?.status).toBe(404);
    expect(env.ARTIFACTS.get).not.toHaveBeenCalled();
  });
});
