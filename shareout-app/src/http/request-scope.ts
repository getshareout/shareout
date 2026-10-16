/**
 * Per-request scope: a shallow copy of `env` that carries
 *  - a memo, so per-request lookups (visibility scope, internal role, session) that
 *    several helpers ask for hit D1 once (read requests only; writes can change them),
 *  - optional phase timings for a `Server-Timing` header: D1 and KV call counts, waves
 *    (runs of overlapping calls = sequential round-trips) and busy ms, plus named phases.
 *
 * Code that receives a plain env (tests, cron, DOs) gets no memo and no timings.
 * Workers clocks only advance across I/O, so a pure-CPU phase (render) reads ~0 on prod.
 */
import type { Env } from '../types';

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

interface RequestScope {
  memo: Map<string, Promise<unknown>> | null;
  timing: RequestTiming | null;
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

/** A request-scoped env. `memo` for read requests; `timing` where Server-Timing is emitted. */
export function scopeRequest(env: Env, opts: { memo: boolean; timing: boolean }): Env {
  if (!opts.memo && !opts.timing) return env;
  const timing = opts.timing ? new RequestTiming() : null;
  const scoped: Env = { ...env };
  if (timing) {
    if (env.DB) scoped.DB = timeD1(env.DB, timing.d1);
    if (env.SLUGS) scoped.SLUGS = timeKv(env.SLUGS, timing.kv);
  }
  scopes.set(scoped, { memo: opts.memo ? new Map() : null, timing });
  return scoped;
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
  try {
    res.headers.set('Server-Timing', value);
    return res;
  } catch {
    const copy = new Response(res.body, res);
    copy.headers.set('Server-Timing', value);
    return copy;
  }
}
