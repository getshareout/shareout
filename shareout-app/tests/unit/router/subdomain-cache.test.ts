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

function makeDb(deploySlug: string | null) {
  const first = vi.fn(async () => (deploySlug ? { deploy_slug: deploySlug } : null));
  const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ first })) }));
  return { prepare, first };
}

function makeSlugs(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => void store.set(k, v)),
  };
}

const req = () => new Request(`https://${WS}.shareout.site/${ART}/`);

afterEach(() => vi.clearAllMocks());

describe('resolveSubdomainRoute shorthand cache', () => {
  it('caches the deploy slug so the second call skips D1', async () => {
    const db = makeDb(DEPLOY);
    const slugs = makeSlugs();
    const env = { DB: db, SLUGS: slugs } as unknown as Env;

    const first = await resolveSubdomainRoute(req(), env, WS, `/${ART}`);
    expect(first).toEqual({ rewritePath: `/a/${DEPLOY}/` });
    expect(db.prepare).toHaveBeenCalledTimes(1);
    expect(slugs.put).toHaveBeenCalledWith(`wsslug:${WS}/${ART}`, DEPLOY, { expirationTtl: 300 });

    const second = await resolveSubdomainRoute(req(), env, WS, `/${ART}`);
    expect(second).toEqual({ rewritePath: `/a/${DEPLOY}/` });
    expect(db.prepare).toHaveBeenCalledTimes(1); // no second D1 query
  });

  it('passes /app/* through unchanged so product pages mirror the apex on a subdomain', async () => {
    const db = makeDb(null);
    const env = { DB: db, SLUGS: makeSlugs() } as unknown as Env;
    const res = await resolveSubdomainRoute(req(), env, WS, '/app/catalog');
    expect(res).toEqual({}); // passthrough — not rewritten to an artifact lookup
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('does not cache a negative result and falls through to the namespaced rewrite', async () => {
    const db = makeDb(null);
    const slugs = makeSlugs();
    const env = { DB: db, SLUGS: slugs } as unknown as Env;

    const res = await resolveSubdomainRoute(req(), env, WS, `/${ART}`);
    expect(res).toEqual({ rewritePath: `/@${WS}/${ART}` });
    expect(slugs.put).not.toHaveBeenCalled();
  });

  it('falls back to D1 when KV get throws', async () => {
    const db = makeDb(DEPLOY);
    const slugs = makeSlugs();
    slugs.get.mockRejectedValueOnce(new Error('kv down'));
    const env = { DB: db, SLUGS: slugs } as unknown as Env;

    const res = await resolveSubdomainRoute(req(), env, WS, `/${ART}`);
    expect(res).toEqual({ rewritePath: `/a/${DEPLOY}/` });
    expect(db.prepare).toHaveBeenCalledTimes(1);
  });

  it('preserves the asset sub-path on a cache hit', async () => {
    const db = makeDb(DEPLOY);
    const slugs = makeSlugs({ [`wsslug:${WS}/${ART}`]: DEPLOY });
    const env = { DB: db, SLUGS: slugs } as unknown as Env;

    const res = await resolveSubdomainRoute(req(), env, WS, `/${ART}/app.js`);
    expect(res).toEqual({ rewritePath: `/a/${DEPLOY}/app.js` });
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('passthrough and workspace-root paths short-circuit before any D1/KV work', async () => {
    const db = makeDb(DEPLOY);
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
