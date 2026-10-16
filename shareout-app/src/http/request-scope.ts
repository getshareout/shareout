/**
 * Per-request scope: a shallow copy of `env` that carries
 *  - a memo, so per-request lookups (visibility scope, internal role, session) that
 *    several helpers ask for hit D1 once (read requests only; writes can change them),
 *  - optional phase timings for a `Server-Timing` header: D1 and KV call counts, waves
 *    (runs of overlapping calls = sequential round-trips) and busy ms, plus named phases.
 *
 *  - optionally (D1_READ_REPLICAS=1) a D1 Sessions API session in place of `env.DB`, so
 *    safe reads can be served by a nearby read replica; see `d1SessionStart`.
 *
 * Code that receives a plain env (tests, cron, queues, DOs) gets no memo, no timings and
 * no session: those paths keep the plain primary-backed `env.DB`.
 * Workers clocks only advance across I/O, so a pure-CPU phase (render) reads ~0 on prod.
 */
import type { Env } from '../types';
import { cookieDomainAttr, cookieSecureAttr } from '../auth/cookies';
import { getPlatformHostname } from '../config/origins';

class IoMeter {
  calls = 0;
  waves = 0;
  private busy = 0;
  private inflight = 0;
  private since = 0;

  track<T>(p: Promise<T>): Promise<T> {
    this.calls++;
    if (this.inflight++ === 0) { this.waves++; this.since = Date.now(); }
    const done = () => { if (--this.inflight === 0) this.busy += Date.now() - this.since; };
    p.then(done, done);
    return p;
  }

  ms(): number {
    return this.busy + (this.inflight ? Date.now() - this.since : 0);
  }
}

class RequestTiming {
  readonly startedAt = Date.now();
  readonly d1 = new IoMeter();
  readonly kv = new IoMeter();
  readonly phases = new Map<string, number>();
  authed = false;

  add(name: string, ms: number): void {
    this.phases.set(name, (this.phases.get(name) ?? 0) + ms);
  }

  header(): string {
    const parts = [...this.phases].map(([name, ms]) => `${name};dur=${ms}`);
    for (const [name, m] of [['d1', this.d1], ['kv', this.kv]] as const) {
      if (m.calls) parts.push(`${name};desc="${m.calls} calls, ${m.waves} waves";dur=${m.ms()}`);
    }
    parts.push(`app;dur=${Date.now() - this.startedAt}`);
    return parts.join(', ');
  }
}

interface D1SessionState {
  session: D1DatabaseSession;
  /** Non-safe method: the response hands the bookmark back. */
  write: boolean;
}

interface RequestScope {
  memo: Map<string, Promise<unknown>> | null;
  timing: RequestTiming | null;
  d1: D1SessionState | null;
}

const scopes = new WeakMap<object, RequestScope>();

const TIMED_STMT = new Set(['first', 'all', 'run', 'raw']);
const realStatement = new WeakMap<object, D1PreparedStatement>();

function timeStatement(stmt: D1PreparedStatement, meter: IoMeter): D1PreparedStatement {
  const wrapped = new Proxy(stmt, {
    get(target, prop) {
      if (prop === 'bind') return (...args: unknown[]) => timeStatement(target.bind(...args), meter);
      const v = Reflect.get(target, prop, target) as unknown;
      if (typeof v !== 'function') return v;
      if (TIMED_STMT.has(prop as string)) return (...args: unknown[]) => meter.track((v as (...a: unknown[]) => Promise<unknown>).apply(target, args));
      return (v as (...a: unknown[]) => unknown).bind(target);
    },
  });
  realStatement.set(wrapped, stmt);
  return wrapped;
}

/** Wraps a D1 database (or a Sessions API session) so every query is metered. */
function timeD1<T extends object>(db: T, meter: IoMeter): T {
  return new Proxy(db, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown;
      if (typeof v !== 'function') return v;
      const fn = v as (...a: unknown[]) => unknown;
      if (prop === 'prepare') return (sql: string) => timeStatement(fn.call(target, sql) as D1PreparedStatement, meter);
      if (prop === 'batch') {
        return (stmts: D1PreparedStatement[]) => meter.track(fn.call(target, stmts.map((s) => realStatement.get(s) ?? s)) as Promise<unknown>);
      }
      if (prop === 'exec') return (...args: unknown[]) => meter.track(fn.apply(target, args) as Promise<unknown>);
      if (prop === 'withSession') return (...args: unknown[]) => timeD1(fn.apply(target, args) as object, meter);
      return fn.bind(target);
    },
  });
}

const TIMED_KV = new Set(['get', 'getWithMetadata', 'put', 'delete', 'list']);

function timeKv(kv: KVNamespace, meter: IoMeter): KVNamespace {
  return new Proxy(kv, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown;
      if (typeof v !== 'function') return v;
      const fn = v as (...a: unknown[]) => unknown;
      if (TIMED_KV.has(prop as string)) return (...args: unknown[]) => meter.track(fn.apply(target, args) as Promise<unknown>);
      return fn.bind(target);
    },
  });
}

/** Cookie (browsers) and header (API clients) that carry the D1 bookmark between requests. */
export const D1_BOOKMARK_COOKIE = '__d1b';
export const D1_BOOKMARK_HEADER = 'x-d1-bookmark';
const D1_BOOKMARK_MAX_AGE = 300;
const BOOKMARK_RE = /^[A-Za-z0-9-]{1,256}$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface D1SessionStart {
  constraint: string;
  /** The request may write: always hand the bookmark back. */
  write: boolean;
}

function requestBookmark(request: Request): string | null {
  const header = request.headers.get(D1_BOOKMARK_HEADER);
  const cookie = request.headers.get('Cookie')?.match(/(?:^|;\s*)__d1b=([^;]+)/)?.[1];
  const value = header?.trim() || cookie?.trim() || null;
  return value && BOOKMARK_RE.test(value) ? value : null;
}

/**
 * How this request's D1 session starts, or null for the plain binding (flag off, or a
 * binding without the Sessions API). Safe methods start from the caller's last bookmark
 * (read-your-writes) or anywhere; everything else starts on the primary. Writes on any
 * session are forwarded to the primary by D1.
 */
export function d1SessionStart(request: Request, env: Env): D1SessionStart | null {
  if (env.D1_READ_REPLICAS !== '1' || typeof env.DB?.withSession !== 'function') return null;
  if (!SAFE_METHODS.has(request.method)) return { constraint: 'first-primary', write: true };
  return { constraint: requestBookmark(request) ?? 'first-unconstrained', write: false };
}

/** `env.DB` backed by a session: prepare/batch go through it; anything else (exec) stays on the binding. */
function sessionD1(db: D1Database, state: D1SessionState): D1Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') {
        return (sql: string) => state.session.prepare(sql);
      }
      if (prop === 'batch') return (stmts: D1PreparedStatement[]) => state.session.batch(stmts);
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/**
 * A request-scoped env. `memo` for read requests; `timing` where Server-Timing is emitted;
 * `d1` (from d1SessionStart) swaps `env.DB` for a Sessions API session.
 */
export function scopeRequest(env: Env, opts: { memo: boolean; timing: boolean; d1?: D1SessionStart | null }): Env {
  if (!opts.memo && !opts.timing && !opts.d1) return env;
  const timing = opts.timing ? new RequestTiming() : null;
  const scoped: Env = { ...env };
  let d1: D1SessionState | null = null;
  if (opts.d1 && env.DB) {
    d1 = { session: env.DB.withSession(opts.d1.constraint), write: opts.d1.write };
    scoped.DB = sessionD1(env.DB, d1);
  }
  if (timing) {
    if (scoped.DB) scoped.DB = timeD1(scoped.DB, timing.d1);
    if (env.SLUGS) scoped.SLUGS = timeKv(env.SLUGS, timing.kv);
  }
  scopes.set(scoped, { memo: opts.memo ? new Map() : null, timing, d1 });
  return scoped;
}

function setHeaders(res: Response, apply: (h: Headers) => void): Response {
  try {
    apply(res.headers);
    return res;
  } catch {
    const copy = new Response(res.body, res);
    apply(copy.headers);
    return copy;
  }
}

/**
 * After a non-safe request, hand its D1 session bookmark back (cookie for browsers,
 * header for API clients) so the caller's next read starts at least that fresh.
 * Safe requests that write metadata on the side (view logs, recent views) still write
 * through the session — D1 forwards session writes to the primary — but do not set a
 * cookie, so read pages stay cookie-free. No session or no bookmark: unchanged.
 */
export function withD1Bookmark(env: Env, request: Request, res: Response): Response {
  const d1 = scopes.get(env)?.d1;
  if (!d1?.write || res.status === 101) return res;
  const bookmark = d1.session.getBookmark();
  if (!bookmark || !BOOKMARK_RE.test(bookmark)) return res;
  const url = new URL(request.url);
  const cookie = `${D1_BOOKMARK_COOKIE}=${bookmark}; Path=/; HttpOnly;${cookieSecureAttr(url)} SameSite=Lax;${cookieDomainAttr(url.hostname, getPlatformHostname(env))} Max-Age=${D1_BOOKMARK_MAX_AGE}`;
  return setHeaders(res, (h) => {
    h.set(D1_BOOKMARK_HEADER, bookmark);
    h.append('Set-Cookie', cookie);
  });
}

/** `load()` once per key per request scope; outside a scope it always runs. Rejections are not kept. */
export function requestMemo<T>(env: Env, key: string, load: () => Promise<T>): Promise<T> {
  const memo = scopes.get(env)?.memo;
  if (!memo) return load();
  const hit = memo.get(key);
  if (hit) return hit as Promise<T>;
  const p = load();
  memo.set(key, p);
  p.catch(() => { if (memo.get(key) === p) memo.delete(key); });
  return p;
}

/** Drop a memoized value (call after a write that changes it). */
export function forgetRequestMemo(env: Env, key: string): void {
  scopes.get(env)?.memo?.delete(key);
}

/** Adds the time `work` takes to the named Server-Timing phase. */
export async function timePhase<T>(env: Env, name: string, work: () => Promise<T>): Promise<T> {
  const timing = scopes.get(env)?.timing;
  if (!timing) return work();
  const t0 = Date.now();
  try { return await work(); } finally { timing.add(name, Date.now() - t0); }
}

/** Synchronous variant of timePhase. */
export function timeSync<T>(env: Env, name: string, work: () => T): T {
  const timing = scopes.get(env)?.timing;
  if (!timing) return work();
  const t0 = Date.now();
  try { return work(); } finally { timing.add(name, Date.now() - t0); }
}

/** Records that this request authenticated a user; only those get Server-Timing. */
export function markAuthenticated(env: Env): void {
  const timing = scopes.get(env)?.timing;
  if (timing) timing.authed = true;
}

/** The Server-Timing value so far, or null when not timed / not authenticated. */
export function serverTimingValue(env: Env): string | null {
  const timing = scopes.get(env)?.timing;
  return timing?.authed ? timing.header() : null;
}

/** Sets Server-Timing on an authenticated, timed response. */
export function withServerTiming(env: Env, res: Response): Response {
  const value = serverTimingValue(env);
  if (!value || res.status === 101) return res;
  return setHeaders(res, (h) => h.set('Server-Timing', value));
}
