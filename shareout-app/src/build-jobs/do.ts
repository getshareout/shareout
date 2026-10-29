/**
 * BuildJobs: one Durable Object per user (idFromName(userId)) that runs that user's AI page
 * builds as durable jobs.
 *
 * A build used to live inside the HTTP response that started it: close the tab and the Worker
 * request was cancelled, and the build with it (its own `send` also threw on the closed stream).
 * Here the build runs in the object's alarm, which needs no client and may run 15 minutes. Its
 * events fan out to every attached stream; progress steps and the final result are kept in
 * SQLite, so a client that drops can reattach and replay them. A job that ends with nobody
 * attached tells its user (runners.ts: bell, assistant thread).
 *
 * The object is single-threaded per user, which keeps start idempotent (the same key while a
 * job is active attaches to it) and the per-user cap race-free. The runners load lazily so this
 * module stays light: the test worker exports every DO class.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import { t } from '../i18n';
import { generateId } from '../crypto-utils';
import { createLogger, logError } from '../logging';
import { BUILD_JOB_COPY } from './copy';
import {
  isActive, JOB_TIMEOUT_MS, KEEP_EVENTS, KEEP_JOBS, LANDING_MS, MAX_ACTIVE_BUILDS, MAX_BACKLOG, PING_MS,
  type BuildEvent, type BuildJobOutcome, type BuildJobSpec, type BuildJobStatus, type BuildJobView, type Emit,
} from './types';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    idem_key TEXT,
    status TEXT NOT NULL,
    spec TEXT,
    outcome TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    ended_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status, created_at)`,
  `CREATE TABLE IF NOT EXISTS job_events (
    job_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event TEXT NOT NULL,
    PRIMARY KEY (job_id, seq)
  )`,
];

type JobRow = {
  id: string; user_id: string; kind: BuildJobSpec['kind']; name: string; idem_key: string | null; status: BuildJobStatus;
  spec: string | null; outcome: string | null; created_at: number; started_at: number | null; ended_at: number | null;
};

/** A build running in this instance right now. */
interface Running {
  /** Token deltas so far (the one-shot builder), replayed as one delta to a client that reattaches. */
  draft: string;
  /** The job ended (cancelled, timed out): the build's next event stops it. */
  settled: boolean;
  /** Lets the alarm return when the job is ended from outside the build. */
  stop: () => void;
}

export interface StartRequest {
  userId: string;
  spec: BuildJobSpec;
  /** Same key while a job is active = the same build (a double click, a retried request). */
  key: string;
  name: string;
}

const SSE_HEADERS = { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' };
const encoder = new TextEncoder();
const frame = (ev: BuildEvent): Uint8Array => encoder.encode(`data: ${JSON.stringify(ev)}\n\n`);
const notFound = () => Response.json({ error: 'Not found' }, { status: 404 });

type Runners = typeof import('./runners');
let loadRunners = (): Promise<Runners> => import('./runners');
/** Hands the object its runners already loaded. For the test pool, where a Durable Object cannot load a module itself. */
export function useBuildRunners(runners: Runners): void {
  loadRunners = async () => runners;
}

/** Thrown into a build that is still going after its job ended. */
export class BuildJobSettled extends Error {
  constructor() {
    super('build job already ended');
  }
}

/** The closing events a client expects when the job, not the build, ended it. */
function closingEvents(kind: BuildJobSpec['kind'], o: BuildJobOutcome): BuildEvent[] {
  return kind === 'create'
    ? [{ type: 'error', error: o.error ?? '' }]
    : [{ type: 'build_done', ok: false, text: o.error ?? '', name: o.name }, { type: 'done' }];
}

export class BuildJobs extends DurableObject<Env> {
  private sql: SqlStorage;
  private listeners = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
  private running = new Map<string, Running>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    for (const stmt of SCHEMA) this.sql.exec(stmt);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const id = url.searchParams.get('id') ?? '';
    await this.sweep();
    switch (`${request.method} ${url.pathname}`) {
      case 'POST /start':
        return this.start(await request.json<StartRequest>());
      case 'GET /attach': {
        const job = id ? this.row(id) : this.latestByKey(url.searchParams.get('key') ?? '');
        return job ? this.stream(job) : notFound();
      }
      case 'GET /job': {
        const job = this.row(id);
        return job ? Response.json(this.view(job)) : notFound();
      }
      case 'GET /jobs':
        return Response.json({ jobs: this.sql.exec<JobRow>('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 10').toArray().map((j) => this.view(j)) });
      case 'POST /cancel':
        return this.cancel(id);
      default:
        return notFound();
    }
  }

  /** Runs the oldest queued build. Never throws: a retried alarm would only find it interrupted. */
  async alarm(): Promise<void> {
    await this.sweep();
    const next = this.sql.exec<JobRow>("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1").toArray()[0];
    if (next) await this.run(next);
    if (this.sql.exec("SELECT 1 FROM jobs WHERE status = 'queued' LIMIT 1").toArray().length) await this.ctx.storage.setAlarm(Date.now());
  }

  private async start(req: StartRequest): Promise<Response> {
    const same = req.key
      ? this.sql.exec<JobRow>("SELECT * FROM jobs WHERE idem_key = ? AND status IN ('queued', 'running') LIMIT 1", req.key).toArray()[0]
      : undefined;
    if (same) return this.stream(same);
    const active = this.sql.exec<{ id: string }>("SELECT id FROM jobs WHERE status IN ('queued', 'running') ORDER BY created_at").toArray();
    if (active.length >= MAX_ACTIVE_BUILDS) return Response.json({ code: 'BUILD_IN_PROGRESS', job: active[0].id }, { status: 409 });

    const id = generateId('bjob');
    this.sql.exec(
      "INSERT INTO jobs (id, user_id, kind, name, idem_key, status, spec, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)",
      id, req.userId, req.spec.kind, req.name.slice(0, 200), req.key || null, JSON.stringify(req.spec), Date.now(),
    );
    this.prune();
    // The caller is attached before the alarm can start the build, so it is never "unwatched" by accident.
    const res = this.stream(this.row(id)!);
    await this.ctx.storage.setAlarm(Date.now());
    return res;
  }

  private async run(job: JobRow): Promise<void> {
    const spec = JSON.parse(job.spec ?? 'null') as BuildJobSpec | null;
    if (!spec) return;
    const copy = t(spec.locale, BUILD_JOB_COPY);
    let stop!: () => void;
    const stopped = new Promise<null>((resolve) => { stop = () => resolve(null); });
    const live: Running = { draft: '', settled: false, stop };
    this.running.set(job.id, live);
    this.sql.exec("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?", Date.now(), job.id);

    const emit: Emit = (ev) => {
      if (live.settled) throw new BuildJobSettled();
      if (ev.type === 'delta') {
        live.draft += typeof ev.text === 'string' ? ev.text : '';
        this.broadcast(job.id, ev, false);
      } else this.broadcast(job.id, ev, true);
    };
    const ping = setInterval(() => this.broadcast(job.id, { type: 'ping' }, false), PING_MS);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<BuildJobOutcome>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, name: job.name, reason: 'timeout', error: copy.timeout }), JOB_TIMEOUT_MS);
    });
    const failed = (err: unknown): BuildJobOutcome | null => {
      if (live.settled || err instanceof BuildJobSettled) return null;
      logError(createLogger(this.env, { scope: 'build_jobs', event: 'build.threw' }), 'page build job threw', err);
      return { ok: false, name: job.name, error: copy.generic };
    };
    try {
      const build = loadRunners().then(({ runBuildJob }) => runBuildJob(this.env, spec, emit));
      // A build abandoned by a timeout or a cancel dies at its next event; its late end is not news.
      build.catch(() => undefined);
      const outcome = await Promise.race([build, timedOut, stopped]).catch(failed);
      if (outcome) await this.finish(job.id, outcome);
    } finally {
      clearInterval(ping);
      clearTimeout(timer);
      this.running.delete(job.id);
    }
  }

  /** Records how a job ended, closes its streams and tells the user when nobody was watching. Once per job. */
  private async finish(id: string, outcome: BuildJobOutcome): Promise<void> {
    const job = this.row(id);
    if (!job || !isActive(job.status)) return;
    const live = this.running.get(id);
    if (live) {
      live.settled = true;
      live.stop();
    }
    const spec = JSON.parse(job.spec ?? 'null') as BuildJobSpec | null;
    if (outcome.reason) for (const ev of closingEvents(job.kind, outcome)) this.broadcast(id, ev, true);
    const status: BuildJobStatus = outcome.ok ? 'published' : outcome.reason === 'cancelled' ? 'cancelled' : 'failed';
    this.sql.exec('UPDATE jobs SET status = ?, outcome = ?, ended_at = ?, spec = NULL WHERE id = ?', status, JSON.stringify(outcome), Date.now(), id);
    // A closed tab is only noticed when a write to it fails, which happens after the write was
    // queued: give the last events a moment to land before deciding whether anyone saw them.
    if (this.listeners.get(id)?.size) await new Promise((r) => setTimeout(r, LANDING_MS));
    const watched = this.closeStreams(id);
    if (!spec) return;
    try {
      const { buildJobEnded } = await loadRunners();
      await buildJobEnded(this.env, { id, userId: job.user_id, spec, outcome, watched });
    } catch (err) {
      logError(createLogger(this.env, { scope: 'build_jobs', event: 'ended.failed' }), 'page build job follow-up failed', err);
    }
  }

  private async cancel(id: string): Promise<Response> {
    const job = this.row(id);
    if (!job) return notFound();
    if (isActive(job.status)) {
      const spec = JSON.parse(job.spec ?? 'null') as BuildJobSpec | null;
      await this.finish(id, { ok: false, name: job.name, reason: 'cancelled', error: t(spec?.locale, BUILD_JOB_COPY).cancelled });
    }
    return Response.json({ ok: true, status: this.row(id)?.status ?? 'cancelled' });
  }

  /** A job marked running that this instance is not running was cut off (a deploy, an eviction); one queued too long lost its alarm. */
  private async sweep(): Promise<void> {
    const now = Date.now();
    const active = this.sql.exec<JobRow>("SELECT * FROM jobs WHERE status IN ('queued', 'running')").toArray();
    for (const job of active) {
      const lost = job.status === 'running' ? !this.running.has(job.id) : now - job.created_at > JOB_TIMEOUT_MS;
      if (!lost) continue;
      const spec = JSON.parse(job.spec ?? 'null') as BuildJobSpec | null;
      await this.finish(job.id, { ok: false, name: job.name, reason: 'interrupted', error: t(spec?.locale, BUILD_JOB_COPY).interrupted });
    }
    if (active.some((j) => j.status === 'queued') && (await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now());
  }

  /** An SSE stream of the job: who it is, what happened so far, then live events until it ends. */
  private stream(job: JobRow): Response {
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start: (c) => { ctl = c; },
      cancel: () => { this.listeners.get(job.id)?.delete(ctl); },
    });
    ctl.enqueue(frame({ type: 'job', id: job.id, status: job.status }));
    for (const ev of this.events(job.id)) ctl.enqueue(frame(ev));
    if (isActive(job.status)) {
      const draft = this.running.get(job.id)?.draft;
      if (draft) ctl.enqueue(frame({ type: 'delta', text: draft }));
      const set = this.listeners.get(job.id) ?? new Set();
      set.add(ctl);
      this.listeners.set(job.id, set);
    } else ctl.close();
    return new Response(body, { headers: SSE_HEADERS });
  }

  /**
   * Sends an event to every attached stream; `keep` also records it for replay. A stream that
   * fails, or whose client stopped reading (MAX_BACKLOG events behind), is dropped.
   */
  private broadcast(id: string, ev: BuildEvent, keep: boolean): void {
    if (keep) this.record(id, ev);
    const set = this.listeners.get(id);
    if (!set) return;
    for (const c of [...set]) {
      try {
        if ((c.desiredSize ?? -Infinity) < -MAX_BACKLOG) throw new Error('client stopped reading');
        c.enqueue(frame(ev));
      } catch (err) {
        set.delete(c);
        try {
          c.error(err);
        } catch {
          // Already closed.
        }
      }
    }
  }

  /**
   * Closes the job's streams. True when a client was attached and had read everything: it saw
   * the end. A closed tab does not always cancel its stream; it stops reading, so its events pile up.
   */
  private closeStreams(id: string): boolean {
    const set = this.listeners.get(id);
    this.listeners.delete(id);
    let caughtUp = 0;
    for (const c of set ?? []) {
      if ((c.desiredSize ?? 0) > 0) caughtUp++;
      try {
        c.close();
      } catch {
        // Already gone.
      }
    }
    return caughtUp > 0;
  }

  private record(id: string, ev: BuildEvent): void {
    const last = this.sql.exec<{ n: number | null }>('SELECT MAX(seq) AS n FROM job_events WHERE job_id = ?', id).one().n ?? 0;
    this.sql.exec('INSERT INTO job_events (job_id, seq, event) VALUES (?, ?, ?)', id, last + 1, JSON.stringify(ev));
    if (last + 1 > KEEP_EVENTS) this.sql.exec('DELETE FROM job_events WHERE job_id = ? AND seq <= ?', id, last + 1 - KEEP_EVENTS);
  }

  private events(id: string): BuildEvent[] {
    return this.sql.exec<{ event: string }>('SELECT event FROM job_events WHERE job_id = ? ORDER BY seq', id).toArray().map((r) => JSON.parse(r.event) as BuildEvent);
  }

  private row(id: string): JobRow | undefined {
    return this.sql.exec<JobRow>('SELECT * FROM jobs WHERE id = ?', id).toArray()[0];
  }

  private latestByKey(key: string): JobRow | undefined {
    if (!key) return undefined;
    return this.sql.exec<JobRow>('SELECT * FROM jobs WHERE idem_key = ? ORDER BY created_at DESC LIMIT 1', key).toArray()[0];
  }

  /** Keeps the newest KEEP_JOBS ended jobs. */
  private prune(): void {
    const old = this.sql.exec<{ id: string }>(
      "SELECT id FROM jobs WHERE status NOT IN ('queued', 'running') ORDER BY created_at DESC LIMIT -1 OFFSET ?", KEEP_JOBS,
    ).toArray();
    for (const { id } of old) {
      this.sql.exec('DELETE FROM job_events WHERE job_id = ?', id);
      this.sql.exec('DELETE FROM jobs WHERE id = ?', id);
    }
  }

  private view(job: JobRow): BuildJobView {
    const steps = this.events(job.id)
      .filter((e) => (e.type === 'step' || e.type === 'build_step') && typeof e.label === 'string')
      .map((e) => e.label as string);
    return {
      id: job.id, kind: job.kind, status: job.status, name: job.name, steps,
      outcome: job.outcome ? (JSON.parse(job.outcome) as BuildJobOutcome) : null,
      created_at: job.created_at, started_at: job.started_at, ended_at: job.ended_at,
    };
  }
}
