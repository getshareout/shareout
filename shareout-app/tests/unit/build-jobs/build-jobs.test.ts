// Page builds as durable jobs (src/build-jobs): the BuildJobs Durable Object, its SQLite, the D1
// notifications table and the Needs You query are real; only the build itself is a scripted fake
// (runBuildJob) and the operator ping is stubbed. Each case uses its own user, so its own object.
import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { BuildEvent, BuildJobOutcome, BuildJobSpec, BuildJobView, Emit } from '../../../src/build-jobs/types';

const h = vi.hoisted(() => ({ run: vi.fn(), alertOps: vi.fn(async () => true) }));
vi.mock('../../../src/support/alert', () => ({ alertOps: h.alertOps }));

import { applyMigrations } from '../helpers/migrated-db';
import { queryNeedsYou } from '../../../src/pages/home/queries/activity-needs-you';
import * as runners from '../../../src/build-jobs/runners';
import { useBuildRunners } from '../../../src/build-jobs/do';

// The real end-of-job path (notification, thread, ops ping); the build is the scripted fake.
useBuildRunners({ ...runners, runBuildJob: (...a: Parameters<typeof runners.runBuildJob>) => h.run(...a) });

const testEnv = env as unknown as Env;
const NAME = 'Team roster';

const spec = (userId: string, locale: 'en' | 'es' = 'en'): BuildJobSpec => ({
  kind: 'assistant', scopeKey: 'personal', userId, threadId: null, locale,
  action: { kind: 'build_artifact', name: NAME, prompt: 'a roster page for the team' },
});
const stubFor = (userId: string) => testEnv.BUILD_JOBS!.get(testEnv.BUILD_JOBS!.idFromName(userId));
const start = (userId: string, key: string, locale: 'en' | 'es' = 'en') =>
  stubFor(userId).fetch('https://build-jobs/start', { method: 'POST', body: JSON.stringify({ userId, spec: spec(userId, locale), key, name: NAME }) });
const view = async (userId: string, id: string) => (await stubFor(userId).fetch(`https://build-jobs/job?id=${id}`)).json<BuildJobView>();

const parse = (text: string): BuildEvent[] => text.split('\n\n').filter(Boolean).map((r) => JSON.parse(r.replace(/^data: /, '')) as BuildEvent);
const readAll = async (res: Response) => parse(await res.text());

/** Reads the first event, then hangs up: the user closed the tab. */
async function firstEventThenClose(res: Response): Promise<BuildEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (!buf.includes('\n\n')) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return parse(buf.slice(0, buf.indexOf('\n\n') + 2))[0];
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('condition never held');
}

/** Runs the job's alarm (if it has not fired by itself already) and waits until the job ended. */
async function settle(userId: string, id: string): Promise<BuildJobView> {
  await runDurableObjectAlarm(stubFor(userId));
  await waitFor(async () => !['queued', 'running'].includes((await view(userId, id)).status));
  return view(userId, id);
}

/** Polled from inside the object: a promise resolved from the test would resume the build in the test's context. */
async function until(gate: { open: boolean }): Promise<void> {
  while (!gate.open) await new Promise((r) => setTimeout(r, 5));
}

/** A build that reports `steps`, optionally pausing after the first one until `gate` opens. */
function scripted(steps: string[], result: Omit<BuildJobOutcome, 'name'>, gate?: { open: boolean }) {
  return async (_env: Env, _spec: BuildJobSpec, emit: Emit): Promise<BuildJobOutcome> => {
    for (const [i, label] of steps.entries()) {
      emit({ type: 'build_step', label });
      if (i === 0 && gate) await until(gate);
    }
    emit({ type: 'build_done', ok: result.ok, text: result.ok ? 'Listo' : result.error, slug: result.slug, name: NAME });
    emit({ type: 'done' });
    return { name: NAME, ...result };
  };
}

function opening(): { gate: { open: boolean }; open: () => void } {
  const gate = { open: false };
  return { gate, open: () => { gate.open = true; } };
}

const notices = async (userId: string) =>
  (await testEnv.DB.prepare("SELECT kind, subject_id, payload FROM notifications WHERE recipient_id = ? AND kind = 'page_build'").bind(userId).all<{ kind: string; subject_id: string; payload: string }>())
    .results.map((r) => ({ ...r, payload: JSON.parse(r.payload) as Record<string, unknown> }));

const USERS = ['usr_bj_life', 'usr_bj_gone', 'usr_bj_back', 'usr_bj_twice', 'usr_bj_cap', 'usr_bj_cap2', 'usr_bj_stop', 'usr_bj_cut', 'usr_bj_fail', 'usr_bj_after'];

beforeAll(async () => {
  await applyMigrations();
  await testEnv.DB.batch(USERS.map((id) => testEnv.DB.prepare('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)').bind(id, `${id}@studio.test`, id)));
});

beforeEach(() => {
  h.run.mockReset();
  h.alertOps.mockClear();
});

describe('BuildJobs', () => {
  it('runs a build start → progress → done, streams today\'s event shapes, records it, and does not notify a user who watched', async () => {
    const user = 'usr_bj_life';
    h.run.mockImplementation(scripted(['Planning your page…', 'Publishing it…'], { ok: true, url: 'https://shareout.test/a/roster/', slug: 'roster', artifactId: 'art_bj_1' }));
    const res = await start(user, 'k-life');
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const reading = readAll(res);
    await runDurableObjectAlarm(stubFor(user));
    const evs = await reading;

    expect(evs[0]).toMatchObject({ type: 'job', status: 'queued' });
    expect(evs.slice(1).map((e) => e.type)).toEqual(['build_step', 'build_step', 'build_done', 'done']);
    const v = await view(user, evs[0].id as string);
    expect(v).toMatchObject({ status: 'published', name: NAME, steps: ['Planning your page…', 'Publishing it…'], outcome: { ok: true, slug: 'roster', artifactId: 'art_bj_1' } });
    expect(v.started_at).toBeGreaterThan(0);
    expect(v.ended_at).toBeGreaterThanOrEqual(v.started_at!);
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(await notices(user)).toEqual([]);
  });

  it('keeps building after the client disconnects, records the result, and notifies the user in their language', async () => {
    const user = 'usr_bj_gone';
    h.run.mockImplementation(scripted(['Planeando tu página…', 'Escribiendo estilos…', 'Publicándola…'], { ok: true, url: 'https://shareout.test/a/roster-es/', slug: 'roster-es', artifactId: 'art_bj_2' }));
    const first = await firstEventThenClose(await start(user, 'k-gone', 'es'));
    expect(first).toMatchObject({ type: 'job' });

    const v = await settle(user, first.id as string);
    expect(v.status).toBe('published');
    expect(v.steps).toEqual(['Planeando tu página…', 'Escribiendo estilos…', 'Publicándola…']);
    expect(v.outcome).toMatchObject({ ok: true, slug: 'roster-es' });

    await waitFor(async () => (await notices(user)).length > 0);
    const [notice, ...rest] = await notices(user);
    expect(rest).toEqual([]);
    expect(notice).toMatchObject({ subject_id: 'art_bj_2', payload: { ok: true, summary: 'Tu artefacto está listo', artifact_name: NAME, slug: 'roster-es', job_id: first.id } });
    // …and it is on the bell / Home "Needs you".
    const needs = await queryNeedsYou(testEnv, { id: user, email: `${user}@studio.test` });
    expect(needs.find((e) => e.kind === 'page_build')).toMatchObject({ summary: 'Tu artefacto está listo', artifact_name: NAME, slug: 'roster-es', artifact_id: 'art_bj_2' });
  });

  it('an unwatched failure tells the user what went wrong, in English for an English reader', async () => {
    const user = 'usr_bj_fail';
    h.run.mockImplementation(scripted(['Planning your page…'], { ok: false, error: 'The builder hit a snag — try again.' }));
    const first = await firstEventThenClose(await start(user, 'k-fail'));
    const v = await settle(user, first.id as string);
    expect(v).toMatchObject({ status: 'failed', outcome: { ok: false, error: 'The builder hit a snag — try again.' } });
    await waitFor(async () => (await notices(user)).length > 0);
    const [notice] = await notices(user);
    expect(notice).toMatchObject({ subject_id: first.id, payload: { ok: false, slug: null, summary: 'Your page build didn’t finish · The builder hit a snag — try again.' } });
  });

  it('a client that reconnects gets the steps so far, then the live rest and the result', async () => {
    const user = 'usr_bj_back';
    const { gate, open } = opening();
    h.run.mockImplementation(scripted(['Planeando tu página…', 'Publicándola…'], { ok: true, slug: 'back', artifactId: 'art_bj_3' }, gate));
    const { id } = await firstEventThenClose(await start(user, 'k-back', 'es'));
    const alarm = runDurableObjectAlarm(stubFor(user));
    await waitFor(async () => (await view(user, id as string)).steps.length === 1);

    const reading = readAll(await stubFor(user).fetch(`https://build-jobs/attach?id=${id}`));
    open();
    await alarm;
    const evs = await reading;
    expect(evs[0]).toMatchObject({ type: 'job', id, status: 'running' });
    expect(evs[1]).toMatchObject({ type: 'build_step', label: 'Planeando tu página…' });
    expect(evs.slice(2).map((e) => e.type)).toEqual(['build_step', 'build_done', 'done']);
    expect(evs.at(-2)).toMatchObject({ type: 'build_done', ok: true, slug: 'back' });
    // Someone was watching when it ended: no notification.
    expect(await notices(user)).toEqual([]);
  });

  it('attaching after the end replays the steps and the result, then closes', async () => {
    const user = 'usr_bj_after';
    h.run.mockImplementation(scripted(['Planning your page…'], { ok: true, slug: 'after', artifactId: 'art_bj_4' }));
    const { id } = await firstEventThenClose(await start(user, 'k-after'));
    await settle(user, id as string);
    const evs = await readAll(await stubFor(user).fetch(`https://build-jobs/attach?id=${id}`));
    expect(evs.map((e) => e.type)).toEqual(['job', 'build_step', 'build_done', 'done']);
    expect(evs[0]).toMatchObject({ status: 'published' });
  });

  it('starting the same build twice (a double click) joins the one job instead of starting another', async () => {
    const user = 'usr_bj_twice';
    const { gate, open } = opening();
    h.run.mockImplementation(scripted(['Planning your page…'], { ok: true, slug: 'twice' }, gate));
    const a = await firstEventThenClose(await start(user, 'same-click'));
    const b = await firstEventThenClose(await start(user, 'same-click'));
    expect(b.id).toBe(a.id);
    open();
    await settle(user, a.id as string);
    expect(h.run).toHaveBeenCalledTimes(1);
    const list = await (await stubFor(user).fetch('https://build-jobs/jobs')).json<{ jobs: BuildJobView[] }>();
    expect(list.jobs.map((j) => j.id)).toEqual([a.id]);
  });

  it('caps a user at one running build: a different one is refused with the running job id; other users are unaffected', async () => {
    const user = 'usr_bj_cap';
    const { gate, open } = opening();
    h.run.mockImplementation(scripted(['Planning your page…'], { ok: true, slug: 'cap' }, gate));
    const a = await firstEventThenClose(await start(user, 'first'));
    const refused = await start(user, 'second');
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ code: 'BUILD_IN_PROGRESS', job: a.id });
    const other = await start('usr_bj_cap2', 'second');
    expect(other.status).toBe(200);
    const b = await firstEventThenClose(other);

    open();
    await settle(user, a.id as string);
    const again = await start(user, 'second');
    expect(again.status).toBe(200);
    const c = await firstEventThenClose(again);
    // Every job this case started ends inside it: a stray alarm would run in the next case.
    await settle('usr_bj_cap2', b.id as string);
    await settle(user, c.id as string);
  });

  it('a cancelled build stops at its next step, ends as cancelled, and notifies nobody', async () => {
    const user = 'usr_bj_stop';
    const { gate, open } = opening();
    h.run.mockImplementation(scripted(['Planning your page…', 'Publishing it…'], { ok: true, slug: 'stop' }, gate));
    const { id } = await firstEventThenClose(await start(user, 'k-stop'));
    const alarm = runDurableObjectAlarm(stubFor(user));
    await waitFor(async () => (await view(user, id as string)).steps.length === 1);

    const cancelled = await (await stubFor(user).fetch(`https://build-jobs/cancel?id=${id}`, { method: 'POST' })).json();
    expect(cancelled).toEqual({ ok: true, status: 'cancelled' });
    await alarm;
    open();
    await new Promise((r) => setTimeout(r, 20));
    const v = await view(user, id as string);
    expect(v).toMatchObject({ status: 'cancelled', outcome: { ok: false, reason: 'cancelled' }, steps: ['Planning your page…'] });
    expect(await notices(user)).toEqual([]);
  });

  it('a job cut off mid-build (deploy, eviction) is failed as interrupted, the user is notified and the operator pinged', async () => {
    const user = 'usr_bj_cut';
    const id = 'bjob_000000000000000000000001';
    // What a restarted object finds: a job marked running that no build in this instance owns.
    await runInDurableObject(stubFor(user), async (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO jobs (id, user_id, kind, name, idem_key, status, spec, created_at, started_at) VALUES (?, ?, 'assistant', ?, 'k-cut', 'running', ?, ?, ?)",
        id, user, NAME, JSON.stringify(spec(user, 'es')), Date.now(), Date.now(),
      );
    });
    const v = await view(user, id);
    expect(v).toMatchObject({ status: 'failed', outcome: { ok: false, reason: 'interrupted', error: 'El armado se interrumpió antes de terminar. Probá de nuevo.' } });
    expect(h.run).not.toHaveBeenCalled();
    expect(h.alertOps).toHaveBeenCalledWith(expect.anything(), '⚠️ Page build job interrupted', expect.arrayContaining([`Page: ${NAME}`]));
    const [notice] = await notices(user);
    expect(notice.payload).toMatchObject({ ok: false, summary: 'Tu artefacto no se terminó de armar · El armado se interrumpió antes de terminar. Probá de nuevo.' });
  });
});
