// D1 read replication via the Sessions API (D1_READ_REPLICAS=1): safe requests read
// through a session that may start on a replica, writes start on the primary, and a
// write hands its bookmark back so the caller's next read is at least that fresh.
// The non-request-path guard (cron, queues, DOs) lives in d1-session-sources.test.ts.
import { env as workerEnv } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { d1SessionStart, markAuthenticated, scopeRequest, serverTimingValue, withD1Bookmark } from '../../../src/http/request-scope';
import { handleFetch } from '../../../src/router/handle-fetch';
import { createSessionToken } from '../../../src/token';
import type { Env } from '../../../src/types';

const alice = { id: 'usr_alice', email: 'alice@example.com' };

/** D1 double with a Sessions API: records each withSession constraint and which handle ran each query. */
function sessionDb(bookmark: string | null = '00000001-00000002-00004f5e-abc') {
  const constraints: string[] = [];
  const ran: { via: 'db' | 'session'; sql: string }[] = [];
  const answer = (sql: string): unknown => {
    if (sql.includes('identity_id')) return [{ id: alice.id, email: alice.email, name: null, picture: null }];
    if (sql.includes('AS n FROM users')) return { n: 1 };
    return null;
  };
  const prep = (via: 'db' | 'session') => (sql: string) => {
    const stmt = () => ({
      first: async () => { ran.push({ via, sql }); const r = answer(sql); return Array.isArray(r) ? (r[0] ?? null) : r; },
      all: async () => { ran.push({ via, sql }); const r = answer(sql); return { results: Array.isArray(r) ? r : r ? [r] : [] }; },
      run: async () => { ran.push({ via, sql }); return { success: true, meta: { changes: 1 } }; },
    });
    return { ...stmt(), bind: () => stmt() };
  };
  const batch = (via: 'db' | 'session') => async (s: unknown[]) => { ran.push({ via, sql: 'batch' }); return s.map(() => ({ results: [] })); };
  const DB = {
    prepare: prep('db'),
    batch: batch('db'),
    exec: async (sql: string) => { ran.push({ via: 'db', sql }); return { count: 0, duration: 0 }; },
    withSession: (c?: string) => {
      constraints.push(c ?? '');
      return { prepare: prep('session'), batch: batch('session'), getBookmark: () => bookmark };
    },
  };
  const env = (flag?: string) => ({ DB, SHAREOUT_BASE_URL: 'https://x.test', SESSION_SECRET: 'test-session-secret', D1_READ_REPLICAS: flag }) as unknown as Env;
  return { env, constraints, ran };
}

const authed = async (env: Env, path: string, init: RequestInit = {}) => {
  const cookie = `shareout_session=${await createSessionToken(alice.id, alice.email, env)}`;
  const headers = new Headers(init.headers);
  headers.set('Cookie', [cookie, headers.get('Cookie')].filter(Boolean).join('; '));
  return handleFetch(new Request(`https://x.test${path}`, { ...init, headers }), env);
};

describe('flag off (default)', () => {
  it('no session is opened and responses carry no bookmark', async () => {
    const db = sessionDb();
    const env = db.env();
    expect(d1SessionStart(new Request('https://x.test/v1/home/recent'), env)).toBeNull();
    expect(d1SessionStart(new Request('https://x.test/v1/x', { method: 'POST' }), env)).toBeNull();
    expect(scopeRequest(env, { memo: false, timing: false, d1: null })).toBe(env);

    const get = await authed(env, '/v1/home/recent?limit=8');
    const post = await authed(env, '/v1/home/dismiss', { method: 'POST', body: '{}' });
    expect(db.constraints).toEqual([]);
    expect(db.ran.every((r) => r.via === 'db')).toBe(true);
    for (const res of [get, post]) {
      expect(res.headers.get('x-d1-bookmark')).toBeNull();
      expect(res.headers.get('Set-Cookie') ?? '').not.toContain('__d1b=');
    }
  });

  it('a flag value other than "1" stays off', () => {
    expect(d1SessionStart(new Request('https://x.test/'), sessionDb().env('true'))).toBeNull();
  });
});

describe('flag on (D1_READ_REPLICAS=1)', () => {
  it('GET starts unconstrained, POST starts on the primary, HEAD/OPTIONS are reads', () => {
    const env = sessionDb().env('1');
    expect(d1SessionStart(new Request('https://x.test/v1/home/recent'), env)).toEqual({ constraint: 'first-unconstrained', write: false });
    expect(d1SessionStart(new Request('https://x.test/', { method: 'OPTIONS' }), env)).toEqual({ constraint: 'first-unconstrained', write: false });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(d1SessionStart(new Request('https://x.test/v1/x', { method }), env)).toEqual({ constraint: 'first-primary', write: true });
    }
  });

  it('a read resumes from the caller bookmark (header over cookie); malformed bookmarks are ignored', () => {
    const env = sessionDb().env('1');
    const req = (headers: Record<string, string>) => new Request('https://x.test/v1/home/recent', { headers });
    expect(d1SessionStart(req({ Cookie: 'a=1; __d1b=0000-cookie' }), env)?.constraint).toBe('0000-cookie');
    expect(d1SessionStart(req({ Cookie: '__d1b=0000-cookie', 'x-d1-bookmark': '0000-header' }), env)?.constraint).toBe('0000-header');
    expect(d1SessionStart(req({ Cookie: '__d1b=bad"value%2F' }), env)?.constraint).toBe('first-unconstrained');
    expect(d1SessionStart(req({ 'x-d1-bookmark': 'x'.repeat(300) }), env)?.constraint).toBe('first-unconstrained');
  });

  it('a write ignores any bookmark and starts on the primary', () => {
    const env = sessionDb().env('1');
    const post = new Request('https://x.test/v1/x', { method: 'POST', headers: { 'x-d1-bookmark': '0000-header' } });
    expect(d1SessionStart(post, env)?.constraint).toBe('first-primary');
  });

  it('a binding without the Sessions API stays plain', () => {
    const env = { DB: { prepare() {} }, D1_READ_REPLICAS: '1' } as unknown as Env;
    expect(d1SessionStart(new Request('https://x.test/'), env)).toBeNull();
  });

  it('prepare/batch go through the session, exec stays on the binding, Server-Timing still meters', async () => {
    const db = sessionDb();
    const env = db.env('1');
    const scoped = scopeRequest(env, { memo: false, timing: true, d1: { constraint: 'first-unconstrained', write: false } });
    await scoped.DB.prepare('SELECT 1').first();
    await scoped.DB.prepare('SELECT ?').bind(2).all();
    await scoped.DB.batch([scoped.DB.prepare('SELECT 3')]);
    await scoped.DB.exec('PRAGMA optimize');
    expect(db.constraints).toEqual(['first-unconstrained']);
    expect(db.ran.map((r) => r.via)).toEqual(['session', 'session', 'session', 'db']);
    markAuthenticated(scoped);
    expect(serverTimingValue(scoped)).toContain('d1;desc="4 calls, 4 waves"');
    expect(env.DB).toBe(db.env('1').DB); // the binding itself is untouched
  });

  it('a real D1 binding works through the session proxy (prepare, bind, batch, bookmark)', async () => {
    const real = { ...(workerEnv as unknown as Env), D1_READ_REPLICAS: '1' } as Env;
    const start = d1SessionStart(new Request('https://x.test/v1/x', { method: 'POST' }), real)!;
    const scoped = scopeRequest(real, { memo: false, timing: true, d1: start });
    expect((await scoped.DB.prepare('SELECT ? AS n').bind(7).first<{ n: number }>())?.n).toBe(7);
    const [r] = await scoped.DB.batch([scoped.DB.prepare('SELECT ? AS n').bind(8)]);
    expect((r.results[0] as { n: number }).n).toBe(8);
    const res = withD1Bookmark(scoped, new Request('https://x.test/v1/x', { method: 'POST' }), new Response('ok'));
    // Local D1 may or may not issue bookmarks; when it does, it is handed back.
    const bm = res.headers.get('x-d1-bookmark');
    if (bm) expect(res.headers.get('Set-Cookie')).toContain(`__d1b=${bm}`);
  });

  it('routed GET reads through an unconstrained session and sets no cookie', async () => {
    const db = sessionDb();
    const res = await authed(db.env('1'), '/v1/home/recent?limit=8');
    expect(res.status).toBe(200);
    expect(db.constraints).toEqual(['first-unconstrained']);
    expect(db.ran.length).toBeGreaterThan(0);
    expect(db.ran.every((r) => r.via === 'session')).toBe(true);
    expect(res.headers.get('x-d1-bookmark')).toBeNull();
    expect(res.headers.get('Set-Cookie') ?? '').not.toContain('__d1b=');
    expect(res.headers.get('Server-Timing')).toMatch(/d1;desc="\d+ calls, \d+ waves"/);
  });

  it('bookmark round trip: a POST hands the bookmark back, the next GET resumes from it', async () => {
    const db = sessionDb('00000001-00000002-00004f5e-abc');
    const env = db.env('1');
    const post = await authed(env, '/v1/home/dismiss', { method: 'POST', body: '{}' });
    expect(db.constraints).toEqual(['first-primary']);
    const bm = post.headers.get('x-d1-bookmark');
    expect(bm).toBe('00000001-00000002-00004f5e-abc');
    const cookie = post.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain(`__d1b=${bm}; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=.x.test; Max-Age=300`);

    await authed(env, '/v1/home/recent?limit=8', { headers: { Cookie: `__d1b=${bm}` } });
    expect(db.constraints).toEqual(['first-primary', bm]);
    await authed(env, '/v1/home/recent?limit=8', { headers: { 'x-d1-bookmark': bm! } });
    expect(db.constraints).toEqual(['first-primary', bm, bm]);
  });

  it('no bookmark (nothing ran) leaves the response unchanged', () => {
    const env = sessionDb(null).env('1');
    const scoped = scopeRequest(env, { memo: false, timing: false, d1: { constraint: 'first-primary', write: true } });
    const res = new Response('ok');
    expect(withD1Bookmark(scoped, new Request('https://x.test/', { method: 'POST' }), res)).toBe(res);
    expect(res.headers.get('x-d1-bookmark')).toBeNull();
  });

  it('immutable responses (redirects) get the bookmark on a copy', () => {
    const env = sessionDb().env('1');
    const scoped = scopeRequest(env, { memo: false, timing: false, d1: { constraint: 'first-primary', write: true } });
    const res = withD1Bookmark(scoped, new Request('https://x.test/', { method: 'POST' }), Response.redirect('https://x.test/home', 302));
    expect(res.status).toBe(302);
    expect(res.headers.get('x-d1-bookmark')).toBe('00000001-00000002-00004f5e-abc');
  });
});
