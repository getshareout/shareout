// /v1/create/generate's build phase with BUILD_JOBS bound: the real route, the real BuildJobs
// object and the real create runner (streamGenerate, read to the end inside the object). Only the
// model stream, the publish write and the account limits are stubbed, as in create-api.test.ts.
import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { BuildEvent, BuildJobView } from '../../../src/build-jobs/types';
import { createFetchContext } from '../../../src/router/context';

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  streamChat: vi.fn(),
  publishGeneratedHtml: vi.fn(),
  incrementRateLimit: vi.fn(async () => undefined),
  gate: { open: true },
}));

vi.mock('../../../src/auth/session', async (orig) => ({ ...(await orig<object>()), getSessionUser: h.getSessionUser }));
vi.mock('../../../src/pages/home/host', () => ({ hostWorkspaceId: vi.fn(async () => null) }));
vi.mock('../../../src/pages/create-gate', () => ({ requireCreateEnabled: vi.fn(async () => null) }));
vi.mock('../../../src/data/agent/anthropic', () => ({ chat: vi.fn(), streamChat: h.streamChat, getAgentChatModel: vi.fn(() => 'm'), getBuildConfig: vi.fn(() => ({})) }));
vi.mock('../../../src/rate-limit', () => ({ checkSlidingWindowRateLimit: vi.fn(async () => ({ allowed: true })), getClientIp: vi.fn(() => '1.2.3.4') }));
vi.mock('../../../src/publish/publish-generated-html', async (orig) => ({ ...(await orig<object>()), publishGeneratedHtml: h.publishGeneratedHtml }));
vi.mock('../../../src/api-auth', () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99, reset: 0 })), incrementRateLimit: h.incrementRateLimit, RATE_LIMIT_MAX: 100 }));
vi.mock('../../../src/quota', () => ({ checkStorageQuota: vi.fn(async () => ({ allowed: true, used: 0, incoming: 0, max: 0 })) }));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole: vi.fn(async () => null) }));
vi.mock('../../../src/access/allow-open', () => ({ resolveAllowOpen: vi.fn(async () => true) }));
vi.mock('../../../src/build-agent/run', async (orig) => ({ ...(await orig<object>()), buildAgentEnabled: vi.fn(async () => false) }));
vi.mock('../../../src/pages/themes', () => ({ getPackDirective: vi.fn(() => 'clean') }));
vi.mock('../../../src/data/agent/build-page', async (orig) => ({
  ...(await orig<object>()),
  buildSystemPrompt: vi.fn(async () => 'sys'),
  resolveBuildGatewayModel: vi.fn(async () => null),
}));

import { routeCreateApi } from '../../../src/router/api/create';
import { routeBuildJobsApi } from '../../../src/build-jobs/client';
import { applyMigrations } from '../helpers/migrated-db';
import * as runners from '../../../src/build-jobs/runners';
import { useBuildRunners } from '../../../src/build-jobs/do';

// Loaded here: a Durable Object in the test pool cannot load modules itself.
useBuildRunners(runners);

const testEnv = env as unknown as Env;
const PAGE = '<!doctype html><html><head><title>Team</title></head><body><h1>The team</h1></body></html>';

function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const req = new Request('https://shareout.test/v1/create/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return routeCreateApi(createFetchContext(req, testEnv));
}
function builds(path: string, init: RequestInit = {}, e: Env = testEnv) {
  return routeBuildJobsApi(createFetchContext(new Request(`https://shareout.test${path}`, init), e));
}
const parse = (text: string): BuildEvent[] => text.split('\n\n').filter(Boolean).map((r) => JSON.parse(r.replace(/^data: /, '')) as BuildEvent);

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

const stubFor = (userId: string) => testEnv.BUILD_JOBS!.get(testEnv.BUILD_JOBS!.idFromName(userId));
async function settle(userId: string, id: string): Promise<BuildJobView> {
  await runDurableObjectAlarm(stubFor(userId));
  for (let i = 0; i < 200; i++) {
    const v = await (await builds(`/v1/builds/${id}`))!.json<BuildJobView>();
    if (v.status !== 'queued' && v.status !== 'running') return v;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('job never ended');
}

const asUser = (id: string) => h.getSessionUser.mockResolvedValue({ id, email: `${id}@studio.test` });

beforeAll(async () => {
  await applyMigrations();
  // The two who read Spanish set it on their account; the others have no setting (English).
  await testEnv.DB.batch([['usr_cj_watch', null], ['usr_cj_gone', 'es'], ['usr_cj_busy', 'es'], ['usr_cj_other', null]].map(([id, locale]) =>
    testEnv.DB.prepare('INSERT OR IGNORE INTO users (id, email, name, locale) VALUES (?, ?, ?, ?)').bind(id, `${id}@studio.test`, id, locale)));
});

beforeEach(() => {
  h.gate = { open: true };
  h.getSessionUser.mockReset();
  h.incrementRateLimit.mockClear();
  h.streamChat.mockReset().mockImplementation(async function* () {
    yield { type: 'content', content: PAGE.slice(0, 40) };
    while (!h.gate.open) await new Promise((r) => setTimeout(r, 5));
    yield { type: 'content', content: PAGE.slice(40) };
  });
  h.publishGeneratedHtml.mockReset().mockResolvedValue({ artifact: { id: 'art_cj' }, deployment: { url: 'https://shareout.test/a/team/', slug: 'team' }, visibility: 'private' });
});

describe('/v1/create/generate build phase as a durable job', () => {
  it('opens with the job id, then streams today\'s delta/done events; the job records the published page', async () => {
    asUser('usr_cj_watch');
    const res = (await post({ phase: 'build', prompt: 'a page about the team' }))!;
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const reading = res.text();
    await runDurableObjectAlarm(stubFor('usr_cj_watch'));
    const evs = parse(await reading);

    expect(evs[0]).toMatchObject({ type: 'job', status: 'queued' });
    expect(evs.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toBe(PAGE);
    expect(evs.at(-1)).toMatchObject({ type: 'done', mode: 'build', slug: 'team', url: 'https://shareout.test/a/team/', artifactId: 'art_cj', html: PAGE });
    expect(h.publishGeneratedHtml).toHaveBeenCalledTimes(1);
    expect(h.incrementRateLimit).toHaveBeenCalledTimes(1);

    const v = await (await builds(`/v1/builds/${evs[0].id}`))!.json<BuildJobView>();
    expect(v).toMatchObject({ kind: 'create', status: 'published', outcome: { ok: true, slug: 'team', artifactId: 'art_cj' } });
  });

  it('a closed tab does not stop the build: the page is still published and the user is notified', async () => {
    asUser('usr_cj_gone');
    h.gate = { open: false };
    const open = () => { h.gate.open = true; };
    const first = await firstEventThenClose((await post({ phase: 'build', prompt: 'a page about the team' }))!);
    const alarm = runDurableObjectAlarm(stubFor('usr_cj_gone'));
    open();
    await alarm;
    const v = await settle('usr_cj_gone', first.id as string);

    expect(v.status).toBe('published');
    expect(h.publishGeneratedHtml).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 400 && !(await testEnv.DB.prepare("SELECT 1 FROM notifications WHERE recipient_id = 'usr_cj_gone'").first()); i++) await new Promise((r) => setTimeout(r, 5));
    const row = await testEnv.DB.prepare("SELECT payload FROM notifications WHERE recipient_id = 'usr_cj_gone' AND kind = 'page_build'").first<{ payload: string }>();
    expect(JSON.parse(row!.payload)).toMatchObject({ ok: true, summary: 'Tu artefacto está listo', slug: 'team' });

    // Reattaching later replays the result.
    const replay = parse(await (await builds(`/v1/builds/${first.id}/events`))!.text());
    expect(replay[0]).toMatchObject({ type: 'job', id: first.id, status: 'published' });
    expect(replay.at(-1)).toMatchObject({ type: 'done', slug: 'team' });
  });

  it('a double click joins the running build; a different build while one runs is refused in the reader\'s language', async () => {
    asUser('usr_cj_busy');
    h.gate = { open: false };
    const open = () => { h.gate.open = true; };
    const a = await firstEventThenClose((await post({ phase: 'build', prompt: 'a page about the team' }))!);
    const b = await firstEventThenClose((await post({ phase: 'build', prompt: 'a page about the team' }))!);
    expect(b.id).toBe(a.id);

    const refused = (await post({ phase: 'build', prompt: 'something else entirely' }))!;
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'BUILD_IN_PROGRESS', error: expect.stringMatching(/^Ya tenés un artefacto armándose/) });

    open();
    await settle('usr_cj_busy', a.id as string);
    expect(h.publishGeneratedHtml).toHaveBeenCalledTimes(1);
  });

  it('a build is only visible to the user who started it', async () => {
    asUser('usr_cj_watch');
    const mine = await (await builds('/v1/builds'))!.json<{ jobs: BuildJobView[] }>();
    expect(mine.jobs.length).toBeGreaterThan(0);
    asUser('usr_cj_other');
    expect((await builds(`/v1/builds/${mine.jobs[0].id}`))!.status).toBe(404);
    expect((await builds(`/v1/builds/${mine.jobs[0].id}/events`))!.status).toBe(404);
    h.getSessionUser.mockResolvedValue(null);
    expect((await builds('/v1/builds'))!.status).toBe(401);
  });

  it('without the binding builds stay inline and /v1/builds is not there', async () => {
    asUser('usr_cj_other');
    const inlineEnv = { ...testEnv, BUILD_JOBS: undefined } as Env;
    expect((await builds('/v1/builds', {}, inlineEnv))!.status).toBe(404);
    const req = new Request('https://shareout.test/v1/create/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: 'build', prompt: 'a page' }) });
    const evs = parse(await (await routeCreateApi(createFetchContext(req, inlineEnv)))!.text());
    expect(evs.some((e) => e.type === 'job')).toBe(false);
    expect(evs.at(-1)).toMatchObject({ type: 'done', slug: 'team' });
  });
});
