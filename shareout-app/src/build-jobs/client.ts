/**
 * The Worker side of durable page builds: start a job on the user's BuildJobs object, and the
 * /v1/builds routes a client uses to find, reattach to, poll or stop its builds.
 *
 *   GET  /v1/builds              your last builds (newest first)
 *   GET  /v1/builds/:id          one build: status, progress steps, result
 *   GET  /v1/builds/:id/events   SSE: the job id, every step so far, then live until it ends
 *   POST /v1/builds/:id/cancel   stop it
 *
 * Without the BUILD_JOBS binding a build runs inline in its request, as before, and /v1/builds is 404.
 */
import type { Env } from '../types';
import type { FetchContext } from '../router/context';
import { getSessionUser } from '../auth/session';
import { jsonWithApiErrors } from '../http/api-error';
import type { StartRequest } from './do';

const JOB_ID = /^bjob_[a-f0-9]{24}$/;
const SSE_HEADERS = { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' };

export const buildJobsBound = (env: Env): boolean => !!env.BUILD_JOBS;

function jobs(env: Env, userId: string): DurableObjectStub {
  const ns = env.BUILD_JOBS!;
  return ns.get(ns.idFromName(userId));
}

/** The DO's SSE body, as this request's response. */
const relay = (res: Response): Response => new Response(res.body, { status: res.status, headers: SSE_HEADERS });

/**
 * Starts (or, same key while active, rejoins) a build and returns its event stream.
 * `busy`: the user already has a different build running (its id), nothing was started.
 */
export async function startBuildJob(env: Env, req: StartRequest): Promise<{ stream: Response } | { busy: string }> {
  const res = await jobs(env, req.userId).fetch('https://build-jobs/start', { method: 'POST', body: JSON.stringify(req) });
  if (res.status === 409) return { busy: ((await res.json()) as { job: string }).job };
  if (!res.ok) throw new Error(`build job start failed: ${res.status}`);
  return { stream: relay(res) };
}

/** The stream of the newest job started with this key, or null when there is none. */
export async function attachBuildJobByKey(env: Env, userId: string, key: string): Promise<Response | null> {
  const res = await jobs(env, userId).fetch(`https://build-jobs/attach?key=${encodeURIComponent(key)}`);
  return res.ok ? relay(res) : null;
}

/** A stable key for "the same build": a double click sends the same request twice. */
export async function buildJobKey(parts: unknown[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function routeBuildJobsApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;
  if (path !== '/v1/builds' && !path.startsWith('/v1/builds/')) return null;
  const json = (data: unknown, status = 200) => addCORS(jsonWithApiErrors(data, status));
  if (!env.BUILD_JOBS) return json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Sign in to see your builds.', code: 'UNAUTHENTICATED' }, 401);

  const [, , , id = '', action = ''] = path.split('/');
  const stub = jobs(env, user.id);
  if (!id) {
    if (request.method !== 'GET') return null;
    return json(await (await stub.fetch('https://build-jobs/jobs')).json());
  }
  if (!JOB_ID.test(id)) return json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  const q = `?id=${id}`;
  let res: Response;
  if (!action && request.method === 'GET') res = await stub.fetch(`https://build-jobs/job${q}`);
  else if (action === 'events' && request.method === 'GET') {
    res = await stub.fetch(`https://build-jobs/attach${q}`);
    if (res.ok) return addCORS(relay(res));
  } else if (action === 'cancel' && request.method === 'POST') res = await stub.fetch(`https://build-jobs/cancel${q}`, { method: 'POST' });
  else return null;
  return res.status === 404 ? json({ error: 'Not found', code: 'NOT_FOUND' }, 404) : json(await res.json(), res.status);
}
