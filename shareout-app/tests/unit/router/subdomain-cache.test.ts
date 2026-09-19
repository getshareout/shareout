// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

vi.mock('../../../src/pages/workspace', () => ({
  handleWorkspaceLanding: vi.fn(async () => new Response('landing', { status: 200 })),
}));

import { resolveSubdomainRoute } from '../../../src/subdomain';

const WS = 'acme';
const ART = 'permissions-report';
const DEPLOY = 'permissions-report-abc123';
const KEY = `wsslug:${WS}/${ART}`;

const row = {
  deploy_slug: DEPLOY,
  version_id: 'ver_1',
  entrypoint: 'index.html',
  mobile_entrypoint: null,
  artifact_id: 'art_1',
  visibility: 'public',
  has_mobile: 0,
  r2_key: 'k/index.html',
  mime: 'text/html',
  size_bytes: 10,
};

function makeDb(found: boolean) {
  const first = vi.fn(async () => (found ? row : null));
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn((_sql: string) => ({ bind }));
  return { prepare, bind, first };
}

function makeSlugs(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (k: string, type?: string) => {
      const v = store.get(k);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    }),
    put: vi.fn(async (k: string, v: string) => void store.set(k, v)),
  };
}

const req = () => new Request(`https://${WS}.shareout.site/${ART}/`);

afterEach(() => vi.clearAllMocks());

describe('resolveSubdomainRoute shorthand cache', () => {
  it('caches the full deployment record so the second call is one KV read and no D1', async () => {
    const db = makeDb(true);
    const slugs = makeSlugs();
    const env = { DB: db, SLUGS: slugs } as unknown as Env;

    const first = await resolveSubdomainRoute(req(), env, WS, `/${ART}`);
    expect(first.rewritePath).toBe(`/a/${DEPLOY}/`);
    expect(first.deployment).toMatchObject({
      slug: DEPLOY,
      record: { version_id: 'ver_1', entry_asset: { r2_key: 'k/index.html', mime: 'text/html', size_bytes: 10 } },
    });
    expect(db.prepare).toHaveBeenCalledTimes(1);
    // Bind order: asset path (null = entrypoint), then the workspace + display slug.
    expect(db.bind).toHaveBeenCalledWith(null, WS, ART);
    expect(slugs.put).toHaveBeenCalledWith(KEY, JSON.stringify(first.deployment), { expirationTtl: 300 });

    const second = await resolveSubdomainRoute(req(), env, WS, `/${ART}`);
    expect(second).toEqual(first);
    expect(db.prepare).toHaveBeenCalledTimes(1);
    expect(slugs.get).toHaveBeenCalledTimes(2);
  });

  it('hands the cache write to waitUntil instead of awaiting it', async () => {
    const db = makeDb(true);
    const slugs = makeSlugs();
    slugs.put.mockImplementation(() => new Promise(() => {})); // never settles
    const waitUntil = vi.fn();
    const env = { DB: db, SLUGS: slugs } as unknown as Env;

    const res = await resolveSubdomainRoute(req(), env, WS, `/${ART}`, { waitUntil } as unknown as ExecutionContext);
    expect(res.rewritePath).toBe(`/a/${DEPLOY}/`);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it('treats a legacy pointer-shaped entry as a miss and rewrites it', async () => {
    const db = makeDb(true);
    const slugs = makeSlugs({ [KEY]: DEPLOY });
    const env = { DB: db, SLUGS: slugs } as unknown as Env;

    const res = await resolveSubdomainRoute(req(), env, WS, `/${ART}`);
    expect(res.rewritePath).toBe(`/a/${DEPLOY}/`);
    expect(db.prepare).toHaveBeenCalledTimes(1);
    expect(JSON.parse(slugs.store.get(KEY)!)).toMatchObject({ slug: DEPLOY });
  });

  it('passes /app/* through unchanged so product pages mirror the apex on a subdomain', async () => {
    const db = makeDb(false);
    const env = { DB: db, SLUGS: makeSlugs() } as unknown as Env;
    const res = await resolveSubdomainRoute(req(), env, WS, '/app/catalog');
    expect(res).toEqual({});
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('does not cache a negative result and falls through to the namespaced rewrite', async () => {
    const db = makeDb(false);
    const slugs = makeSlugs();
    const env = { DB: db, SLUGS: slugs } as unknown as Env;

    const res = await resolveSubdomainRoute(req(), env, WS, `/${ART}`);
    expect(res).toEqual({ rewritePath: `/@${WS}/${ART}` });
    expect(slugs.put).not.toHaveBeenCalled();
  });

  it('falls back to D1 when KV get throws', async () => {
    const db = makeDb(true);
    const slugs = makeSlugs();
    slugs.get.mockRejectedValueOnce(new Error('kv down'));
    const env = { DB: db, SLUGS: slugs } as unknown as Env;

    const res = await resolveSubdomainRoute(req(), env, WS, `/${ART}`);
    expect(res.rewritePath).toBe(`/a/${DEPLOY}/`);
    expect(db.prepare).toHaveBeenCalledTimes(1);
  });

  it('preserves the asset sub-path on a cache hit', async () => {
    const db = makeDb(true);
    const slugs = makeSlugs();
    const env = { DB: db, SLUGS: slugs } as unknown as Env;
    await resolveSubdomainRoute(req(), env, WS, `/${ART}`);

    const res = await resolveSubdomainRoute(req(), env, WS, `/${ART}/app.js`);
    expect(res.rewritePath).toBe(`/a/${DEPLOY}/app.js`);
    expect(db.prepare).toHaveBeenCalledTimes(1);
  });

  it('passthrough and workspace-root paths short-circuit before any D1/KV work', async () => {
    const db = makeDb(true);
    const slugs = makeSlugs();
    const env = { DB: db, SLUGS: slugs } as unknown as Env;

    for (const p of ['/v1/x', '/auth/login', '/a/foo', '/home', '/settings/telegram', '/settings/slack']) {
      expect(await resolveSubdomainRoute(req(), env, WS, p)).toEqual({});
    }
    expect(await resolveSubdomainRoute(req(), env, WS, '/')).toHaveProperty('response');
    expect(db.prepare).not.toHaveBeenCalled();
    expect(slugs.get).not.toHaveBeenCalled();
  });
});
