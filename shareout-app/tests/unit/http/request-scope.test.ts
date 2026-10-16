// vitest-isolate: role helpers keep module-level state.
// Request scope: per-request memo for visibility scope + internal role, and the
// Server-Timing meter (D1/KV calls, waves, phases) on the timed routes.
import { env as workerEnv } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { getVisibilityScope } from '../../../src/account-links';
import { getInternalWorkspaceRole, invalidateWorkspaceRole } from '../../../src/workspaces/roles';
import { markAuthenticated, requestMemo, scopeRequest, serverTimingValue, timePhase, withServerTiming } from '../../../src/http/request-scope';
import { handleFetch } from '../../../src/router/handle-fetch';
import { createSessionToken } from '../../../src/token';
import type { Env } from '../../../src/types';

const alice = { id: 'usr_alice', email: 'alice@example.com' };
const WS = 'wsp_acme';

/** D1 double that records every SQL it runs; `role` is alice's internal role in WS. */
function countingDb(opts: { role?: string | null; member?: boolean } = {}) {
  const calls: string[] = [];
  const answer = (sql: string): unknown => {
    if (sql.includes('identity_id')) return [{ id: alice.id, email: alice.email, name: null, picture: null }];
    if (sql.includes("member_class = 'internal'")) return opts.role ? { role: opts.role } : null;
    if (sql.includes('SELECT id FROM workspaces WHERE slug = ?')) return { id: WS };
    if (sql.includes('SELECT 1 FROM workspace_members')) return opts.member ? { 1: 1 } : null;
    if (sql.includes('AS n FROM users')) return { n: 1 };
    return null;
  };
  const stmt = (sql: string) => ({
    first: async () => { calls.push(sql); const r = answer(sql); return Array.isArray(r) ? (r[0] ?? null) : r; },
    all: async () => { calls.push(sql); const r = answer(sql); return { results: Array.isArray(r) ? r : r ? [r] : [] }; },
    run: async () => { calls.push(sql); return { success: true, meta: { changes: 0 } }; },
  });
  const DB = { prepare: (sql: string) => ({ ...stmt(sql), bind: () => stmt(sql) }), batch: async (s: unknown[]) => s.map(() => ({ results: [] })) };
  const env = { DB, SHAREOUT_BASE_URL: 'https://x.test', SESSION_SECRET: 'test-session-secret' } as unknown as Env;
  return { env, calls, count: (frag: string) => calls.filter((s) => s.includes(frag)).length };
}

describe('request memo', () => {
  it('getVisibilityScope hits D1 once per request scope, every time outside one', async () => {
    const db = countingDb();
    const scoped = scopeRequest(db.env, { memo: true, timing: false });
    const [a, b] = await Promise.all([getVisibilityScope(scoped, alice), getVisibilityScope(scoped, alice)]);
    await getVisibilityScope(scoped, alice);
    expect(a).toEqual(b);
    expect(db.count('identity_id')).toBe(1);

    await getVisibilityScope(db.env, alice);
    await getVisibilityScope(db.env, alice);
    expect(db.count('identity_id')).toBe(3);
  });

  it('getInternalWorkspaceRole hits D1 once per (workspace, user) per request', async () => {
    const db = countingDb({ role: 'admin' });
    const scoped = scopeRequest(db.env, { memo: true, timing: false });
    expect(await getInternalWorkspaceRole(scoped, WS, alice.id)).toBe('admin');
    expect(await getInternalWorkspaceRole(scoped, WS, alice.id)).toBe('admin');
    await getInternalWorkspaceRole(scoped, 'wsp_other', alice.id);
    expect(db.count("member_class = 'internal'")).toBe(2);
  });

  it('a role change in the same request is not served stale', async () => {
    const db = countingDb({ role: 'member' });
    const scoped = scopeRequest(db.env, { memo: true, timing: false });
    await getInternalWorkspaceRole(scoped, WS, alice.id);
    await invalidateWorkspaceRole(scoped, WS, alice.id);
    await getInternalWorkspaceRole(scoped, WS, alice.id);
    expect(db.count("member_class = 'internal'")).toBe(2);
  });

  it('a failed load is not kept', async () => {
    const scoped = scopeRequest(countingDb().env, { memo: true, timing: false });
    let n = 0;
    const load = async () => { n++; if (n === 1) throw new Error('boom'); return n; };
    await expect(requestMemo(scoped, 'k', load)).rejects.toThrow('boom');
    expect(await requestMemo(scoped, 'k', load)).toBe(2);
    expect(await requestMemo(scoped, 'k', load)).toBe(2);
  });

  it('a routed GET resolves the visibility scope once', async () => {
    const db = countingDb({ role: 'member', member: true });
    const cookie = `shareout_session=${await createSessionToken(alice.id, alice.email, db.env)}`;
    const res = await handleFetch(new Request('https://x.test/v1/home/recent?limit=8&workspace=' + WS, { headers: { Cookie: cookie } }), db.env);
    expect(res.status).toBe(200);
    expect(db.count('identity_id')).toBe(1);
  });
});

describe('Server-Timing', () => {
  it('counts D1 calls and waves (overlapping calls are one wave) plus named phases', async () => {
    const db = countingDb();
    const scoped = scopeRequest(db.env, { memo: false, timing: true });
    await timePhase(scoped, 'host', async () => {
      await Promise.all([scoped.DB.prepare('SELECT 1').first(), scoped.DB.prepare('SELECT 2').bind(1).all()]);
    });
    await scoped.DB.prepare('SELECT 3').bind(1).first();
    await scoped.DB.batch([scoped.DB.prepare('SELECT 4')]);
    // Not authenticated → nothing exposed.
    expect(serverTimingValue(scoped)).toBeNull();
    markAuthenticated(scoped);
    const v = serverTimingValue(scoped)!;
    expect(v).toMatch(/^host;dur=\d+/);
    expect(v).toContain('d1;desc="4 calls, 3 waves";dur=');
    expect(v).toMatch(/app;dur=\d+$/);
    expect(v).not.toMatch(/SELECT|usr_|alice/);
    expect(withServerTiming(scoped, new Response('ok')).headers.get('Server-Timing')).toBe(serverTimingValue(scoped));
    // Immutable headers (e.g. Response.redirect) are copied, not thrown on.
    expect(withServerTiming(scoped, Response.redirect('https://x.test/', 302)).headers.get('Server-Timing')).toContain('d1;');
  });

  it('metering keeps real D1 statements working (bind, first, batch)', async () => {
    const real = workerEnv as unknown as Env;
    const scoped = scopeRequest(real, { memo: false, timing: true });
    const row = await scoped.DB.prepare('SELECT ? AS n').bind(7).first<{ n: number }>();
    expect(row?.n).toBe(7);
    const [r] = await scoped.DB.batch([scoped.DB.prepare('SELECT ? AS n').bind(8)]);
    expect((r.results[0] as { n: number }).n).toBe(8);
    markAuthenticated(scoped);
    expect(serverTimingValue(scoped)).toContain('d1;desc="2 calls, 2 waves"');
  });

  it('timed routes answer an authenticated caller with Server-Timing', async () => {
    const db = countingDb({ role: 'member', member: true });
    const cookie = `shareout_session=${await createSessionToken(alice.id, alice.email, db.env)}`;
    const res = await handleFetch(new Request(`https://x.test/v1/home/recent?limit=8&workspace=${WS}`, { headers: { Cookie: cookie } }), db.env);
    expect(res.status).toBe(200);
    const st = res.headers.get('Server-Timing')!;
    expect(st).toMatch(/auth;dur=\d+/);
    expect(st).toMatch(/d1;desc="\d+ calls, \d+ waves";dur=\d+/);
  });

  it('anonymous callers and untimed routes get no Server-Timing', async () => {
    const db = countingDb();
    const anon = await handleFetch(new Request('https://x.test/v1/home/recent'), db.env);
    expect(anon.status).toBe(401);
    expect(anon.headers.get('Server-Timing')).toBeNull();

    const cookie = `shareout_session=${await createSessionToken(alice.id, alice.email, db.env)}`;
    const untimed = await handleFetch(new Request('https://x.test/v1/me', { headers: { Cookie: cookie } }), db.env);
    expect(untimed.headers.get('Server-Timing')).toBeNull();
  });

  it('/home: the head carries the pre-stream phases, the body ends with the full breakdown', async () => {
    const db = countingDb({ role: 'member', member: true });
    const cookie = `shareout_session=${await createSessionToken(alice.id, alice.email, db.env)}`;
    const res = await handleFetch(new Request('https://x.test/home', { headers: { Cookie: cookie } }), db.env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Server-Timing')).toMatch(/auth;dur=\d+.*d1;desc="\d+ calls, \d+ waves"/);
    const html = await res.text();
    expect(html).toMatch(/<!-- server-timing: [^>]*render;dur=\d+[^>]*d1;desc="\d+ calls, \d+ waves";dur=\d+[^>]*-->/);
  });
});
