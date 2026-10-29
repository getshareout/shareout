// @vitest-environment node
// Every page build leaves a trace in page_build_traces, from both builders, and only a
// platform admin sees them in the Health view.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  provider: null as unknown,
  session: null as { id: string; email: string } | null,
  chat: [] as unknown[],
}));
vi.mock('../../../src/support/alert', () => ({ alertOps: vi.fn(async () => true) }));
vi.mock('../../../src/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }), logError: vi.fn() }));
vi.mock('../../../src/crew/provider', async (orig) => ({ ...(await orig<object>()), getCrewProvider: () => h.provider }));
vi.mock('../../../src/auth/session', async (orig) => ({ ...(await orig<object>()), getSessionUser: async () => h.session }));
vi.mock('../../../src/data/agent/anthropic', async (orig) => ({
  ...(await orig<object>()),
  streamChat: async function* () { for (const c of h.chat) yield c; },
}));

import { applyMigrations, e } from '../helpers/migrated-db';
import { runPageBuild } from '../../../src/build-agent/run';
import { MAX_STEPS_JSON, capSteps, cleanupBuildTraces, startBuildTrace, type TraceStep } from '../../../src/build-agent/trace';
import { getRecentBuildTraces } from '../../../src/build-agent/trace-store';
import { streamBuild } from '../../../src/data/agent/build-page';
import { routeAdminApi } from '../../../src/router/api/admin';
import { createFetchContext } from '../../../src/router/context';
import type { Env } from '../../../src/types';
import { GOOD_HTML, okPublish, scriptedProvider, type Step } from './helpers';

const env = { ...e, INSTANCE_ADMIN_EMAILS: 'ops@example.com' } as Env;
const meter = { workspaceId: null, userId: null, kind: 'page_build', source: 'create' };
const write = (path: string, content: string): [string, Record<string, unknown>] => ['write_file', { path, content }];
const writeAll: Step = { calls: [write('index.html', GOOD_HTML), write('styles.css', 'body{margin:0}'), write('app.js', 'document.title = "ok";')] };
const check: Step = { calls: [['check_page', {}]] };
const publish: Step = { calls: [['publish_page', {}]] };

async function build(steps: Step[]) {
  h.provider = scriptedProvider(steps).provider;
  return runPageBuild({
    env, user: { id: 'u1', email: null }, meter, locale: 'en', prompt: 'a landing page', isPublic: false,
    publish: okPublish(),
  });
}
const latest = async () => (await getRecentBuildTraces(env, 1))[0];

beforeAll(applyMigrations);
beforeEach(async () => { await env.DB.prepare('DELETE FROM page_build_traces').run(); h.chat = []; });

describe('agent traces', () => {
  it('records a published build: turns, tools, tokens, outcome', async () => {
    await build([writeAll, check, publish]);
    const t = await latest();
    expect(t).toMatchObject({ path: 'agent', outcome: 'published', turns: 3, tool_calls: 5, tool_errors: 0, check_rounds: 0, source: 'create', model: 'test-model' });
    expect(t.input_tokens).toBe(30);
    expect(t.output_tokens).toBe(150);
    expect(t.artifact_id).toBe('a1');
    expect(t.steps.filter((s) => s.k === 'tool').map((s) => (s as { name: string }).name)).toContain('publish_page');
    expect(t.steps).toContainEqual({ k: 'publish', ok: true, draft: false });
  });

  it('records failed check rounds with their error counts, and never file contents', async () => {
    await build([{ calls: [write('index.html', GOOD_HTML), write('styles.css', 'body{margin:0}'), write('app.js', 'document.title = ;')] }, check, { calls: [['edit_file', { path: 'app.js', old: 'title = ;', new: 'title = "ok";' }]] }, check, publish]);
    const t = await latest();
    expect(t.outcome).toBe('published');
    expect(t.check_rounds).toBe(1);
    expect(t.steps).toContainEqual({ k: 'check', errors: 1 });
    expect(JSON.stringify(t.steps)).not.toContain('document.title');
  });

  it('records a give-up with its reason', async () => {
    await build([{ text: 'I am done.' }]);
    const t = await latest();
    expect(t).toMatchObject({ outcome: 'gave_up', error_code: 'no_publish' });
    expect(t.turns).toBe(3);
  });

  it('records a model error as a failed build', async () => {
    await build([{ error: { type: 'error', error: 'The AI service is temporarily unavailable. Try again.', retryable: true } }]);
    const t = await latest();
    expect(t).toMatchObject({ outcome: 'failed', error_code: 'provider_error' });
    expect(t.error_message).toContain('temporarily unavailable');
    expect(t.steps.some((s) => s.k === 'note')).toBe(true);
  });

  it('records a tool error', async () => {
    await build([{ calls: [['read_file', { path: 'missing.js' }]] }, writeAll, publish]);
    const t = await latest();
    expect(t.tool_errors).toBe(1);
  });
});

describe('one-shot traces', () => {
  const stream = async (trace: ReturnType<typeof startBuildTrace>) => {
    for await (const _ of streamBuild(env, meter, [{ role: 'user', content: 'hi' }], 'sys', null, trace)) void _;
  };

  it('records turns and tokens; the caller closes it as published', async () => {
    h.chat = [{ type: 'content', content: '<!DOCTYPE html><html><body>hello there, friend</body></html>' }, { type: 'done', usage: { input_tokens: 100, output_tokens: 40 } }];
    const trace = startBuildTrace(env, meter, 'one_shot');
    await stream(trace);
    expect(await getRecentBuildTraces(env, 1)).toHaveLength(0);
    await trace.finish('published');
    expect(await latest()).toMatchObject({ path: 'one_shot', outcome: 'published', turns: 1, input_tokens: 100, output_tokens: 40 });
  });

  it('records a model error', async () => {
    h.chat = [{ type: 'error', error: 'AI API error: 500 boom' }];
    await stream(startBuildTrace(env, meter, 'one_shot'));
    expect(await latest()).toMatchObject({ outcome: 'failed', error_code: 'MODEL_ERROR' });
  });

  it('records a page still cut off after its continuations as truncated', async () => {
    h.chat = [{ type: 'content', content: '<!DOCTYPE html><html><body>cut off here, mid page' }, { type: 'done', usage: { input_tokens: 5, output_tokens: 5 }, truncated: true }];
    await stream(startBuildTrace(env, meter, 'one_shot'));
    const t = await latest();
    expect(t).toMatchObject({ outcome: 'truncated', error_code: 'BUILD_TRUNCATED', turns: 3 });
  });

  it('the first finish wins', async () => {
    const trace = startBuildTrace(env, meter, 'one_shot');
    await trace.finish('failed', { errorCode: 'A' });
    await trace.finish('published');
    const rows = await getRecentBuildTraces(env, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('failed');
  });
});

describe('size cap and retention', () => {
  it('keeps the stored steps under the cap and says how many were dropped', () => {
    const steps: TraceStep[] = Array.from({ length: 150 }, (_, i) => ({ k: 'note', text: `${i} ${'x'.repeat(400)}` }));
    const json = capSteps(steps, 0);
    expect(json.length).toBeLessThanOrEqual(MAX_STEPS_JSON);
    expect(JSON.parse(json).at(-1).k).toBe('dropped');
  });

  it('stops recording past the step limit', async () => {
    const trace = startBuildTrace(env, meter, 'agent');
    for (let i = 0; i < 400; i++) trace.checkRound(i);
    await trace.finish('gave_up');
    const t = await latest();
    expect(t.steps.length).toBeLessThanOrEqual(151);
    expect(t.steps.at(-1)).toMatchObject({ k: 'dropped' });
    expect(t.check_rounds).toBe(400);
  });

  it('deletes traces past 90 days', async () => {
    await env.DB.prepare(`INSERT INTO page_build_traces (id, path, outcome, started_at, finished_at, created_at) VALUES ('old', 'agent', 'failed', 'x', 'x', ?), ('new', 'agent', 'failed', 'x', 'x', ?)`)
      .bind(new Date(Date.now() - 91 * 86_400_000).toISOString(), new Date().toISOString()).run();
    expect(await cleanupBuildTraces(env)).toBe(1);
    expect((await getRecentBuildTraces(env)).map((r) => r.id)).toEqual(['new']);
  });
});

describe('admin Health view access', () => {
  const view = (as: { id: string; email: string } | null) => {
    h.session = as;
    return routeAdminApi(createFetchContext(new Request('https://shareout.test/v1/admin/view?view=health'), env));
  };

  it('shows the builds to a platform admin', async () => {
    await build([writeAll, publish]);
    const res = await view({ id: 'usr_ops', email: 'ops@example.com' });
    expect(res!.status).toBe(200);
    const { html } = await res!.json() as { html: string };
    expect(html).toContain('Page builds');
    expect(html).toContain('published');
    expect(html).toContain('model call 1');
  });

  it('refuses everyone else, and a signed-out caller', async () => {
    await build([writeAll, publish]);
    for (const who of [{ id: 'usr_x', email: 'x@example.com' }, null]) {
      const res = await view(who);
      expect(res!.status).toBe(403);
      expect(await res!.text()).not.toContain('model call');
    }
  });
});
