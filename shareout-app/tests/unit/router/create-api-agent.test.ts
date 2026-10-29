// /v1/create/generate with BUILD_AGENT=on: the build phase runs the tool-using agent, streams `step`
// events in the reader's language, publishes the checked page, and tells a failure honestly.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { createFetchContext } from '../../../src/router/context';
import { GOOD_HTML, scriptedProvider, type Step } from '../build-agent/helpers';

const getSessionUser = vi.hoisted(() => vi.fn());
const publishGeneratedFiles = vi.hoisted(() => vi.fn());
const publishGeneratedHtml = vi.hoisted(() => vi.fn());
const streamChat = vi.hoisted(() => vi.fn());
const getCrewProvider = vi.hoisted(() => vi.fn());
const runVerify = vi.hoisted(() => vi.fn());
const alertOps = vi.hoisted(() => vi.fn(async () => true));
const checkRateLimit = vi.hoisted(() => vi.fn());
const incrementRateLimit = vi.hoisted(() => vi.fn());
const checkStorageQuota = vi.hoisted(() => vi.fn());

vi.mock('../../../src/auth/session', async (importOriginal) => ({ ...(await importOriginal<object>()), getSessionUser }));
const hostWorkspaceId = vi.hoisted(() => vi.fn(async (): Promise<string | null> => null));
vi.mock('../../../src/pages/home/host', () => ({ hostWorkspaceId }));
vi.mock('../../../src/pages/create-gate', () => ({ requireCreateEnabled: vi.fn(async () => null) }));
vi.mock('../../../src/data/agent/anthropic', () => ({ chat: vi.fn(), streamChat, getAgentChatModel: vi.fn(() => 'm'), getBuildConfig: vi.fn(() => ({})) }));
vi.mock('../../../src/rate-limit', () => ({ checkSlidingWindowRateLimit: vi.fn(async () => ({ allowed: true })), getClientIp: vi.fn(() => '1.2.3.4') }));
vi.mock('../../../src/publish/publish-generated-html', () => ({ publishGeneratedFiles, publishGeneratedHtml }));
vi.mock('../../../src/api-auth', () => ({ checkRateLimit, incrementRateLimit, RATE_LIMIT_MAX: 100 }));
vi.mock('../../../src/quota', () => ({ checkStorageQuota }));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole: vi.fn(async () => null) }));
vi.mock('../../../src/access/allow-open', () => ({ resolveAllowOpen: vi.fn(async () => true) }));
vi.mock('../../../src/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), logError: vi.fn() }));
vi.mock('../../../src/support/alert', () => ({ alertOps }));
vi.mock('../../../src/crew/provider', async (importOriginal) => ({ ...(await importOriginal<object>()), getCrewProvider }));
vi.mock('../../../src/verify/service', () => ({ runVerify }));
vi.mock('../../../src/pages/themes', () => ({ getPackDirective: vi.fn(() => 'clean') }));
vi.mock('../../../src/data/agent/build-page', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  buildSystemPrompt: vi.fn(async () => 'sys'),
  deriveName: vi.fn((p: string) => p.slice(0, 20)),
}));

import { routeCreateApi } from '../../../src/router/api/create';

const write = (path: string, content: string): [string, Record<string, unknown>] => ['write_file', { path, content }];
const good: Step = { calls: [write('index.html', GOOD_HTML), write('styles.css', 'b{}'), write('app.js', 'document.title="x";')] };
const publish: Step = { calls: [['publish_page', {}]] };

function post(env: Partial<Env>, body: unknown, headers: Record<string, string> = {}) {
  const req = new Request('https://shareout.site/v1/create/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return routeCreateApi(createFetchContext(req, env as Env));
}
async function events(res: Response | null) {
  return (await res!.text()).split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')));
}

const published = (visibility = 'private') => ({ artifact: { id: 'art1' }, deployment: { url: 'https://shareout.site/a/s/', slug: 's' }, visibility });

beforeEach(() => {
  hostWorkspaceId.mockReset().mockResolvedValue(null);
  getSessionUser.mockReset().mockResolvedValue({ id: 'u1', email: 'a@x.com' });
  publishGeneratedFiles.mockReset().mockResolvedValue(published());
  publishGeneratedHtml.mockReset();
  streamChat.mockReset().mockImplementation(async function* () { yield { type: 'content', content: '<!doctype html><html><body>old</body></html>' }; });
  getCrewProvider.mockReset();
  runVerify.mockReset();
  alertOps.mockClear();
  checkRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 99, reset: 0 });
  incrementRateLimit.mockReset().mockResolvedValue(undefined);
  checkStorageQuota.mockReset().mockResolvedValue({ allowed: true, used: 0, incoming: 0, max: 0 });
});

describe('/v1/create/generate build phase with BUILD_AGENT=on', () => {
  it('builds through tools, streams steps in Spanish, publishes all the files once, and sends done', async () => {
    getCrewProvider.mockReturnValue(scriptedProvider([good, publish]).provider);
    const evs = await events(await post({ BUILD_AGENT: 'on' }, { phase: 'build', prompt: 'una página' }, { 'Accept-Language': 'es-AR,es;q=0.9' }));
    expect(evs.filter((e) => e.type === 'step').map((e) => e.label)).toEqual(expect.arrayContaining(['Escribiendo estilos…', 'Publicándola…']));
    expect(evs.some((e) => e.type === 'delta')).toBe(false);
    expect(evs.at(-1)).toMatchObject({ type: 'done', mode: 'build', url: 'https://shareout.site/a/s/', slug: 's', artifactId: 'art1', visibility: 'private' });
    expect(publishGeneratedFiles).toHaveBeenCalledTimes(1);
    const files = publishGeneratedFiles.mock.calls[0][2].files.map((f: { path: string }) => f.path).sort();
    expect(files).toEqual(['app.js', 'index.html', 'styles.css']);
    expect(incrementRateLimit).toHaveBeenCalledTimes(1);
    expect(streamChat).not.toHaveBeenCalled();
  });

  it('with a browser: publishes a private draft, tests it, then makes it public as asked', async () => {
    getCrewProvider.mockReturnValue(scriptedProvider([good, publish]).provider);
    runVerify.mockResolvedValue({ ok: true, name: 'n', result: { status: 'pass', counts: { error: 0, warning: 0, info: 0 }, summary: 'pass — ok', issues: [], viewports: [], artifact_id: 'art1', version: 1, live: true } });
    publishGeneratedFiles.mockResolvedValueOnce(published('private')).mockResolvedValueOnce(published('public'));
    const evs = await events(await post({ BUILD_AGENT: 'on', BROWSER: {} as Fetcher }, { phase: 'build', prompt: 'a page', visibility: 'public' }));
    expect(publishGeneratedFiles.mock.calls.map((c) => c[2].visibility)).toEqual(['private', 'public']);
    expect(publishGeneratedFiles.mock.calls[1][2].slug).toBe('s');
    expect(runVerify).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'u1' }), 'art1', expect.objectContaining({ system: true }));
    expect(evs.map((e) => e.label).filter(Boolean)).toEqual(expect.arrayContaining(['Testing the page…']));
    expect(evs.at(-1)).toMatchObject({ type: 'done', visibility: 'public' });
    expect(incrementRateLimit).toHaveBeenCalledTimes(1);
  });

  it('a page that cannot pass its checks is not published: the user is told in their language, the operator is alerted', async () => {
    const broken: Step = { calls: [write('index.html', GOOD_HTML), write('app.js', 'let = ;')] };
    getCrewProvider.mockReturnValue(scriptedProvider([broken, publish]).provider);
    const evs = await events(await post({ BUILD_AGENT: 'on' }, { phase: 'build', prompt: 'una página' }, { 'Accept-Language': 'es' }));
    expect(evs.at(-1)).toMatchObject({ type: 'error' });
    expect(evs.at(-1).error).toMatch(/no la publiqué/);
    expect(evs.some((e) => e.type === 'done')).toBe(false);
    expect(publishGeneratedFiles).not.toHaveBeenCalled();
    expect(alertOps).toHaveBeenCalledTimes(1);
  });

  it('reports a storage-limit refusal with its code', async () => {
    getCrewProvider.mockReturnValue(scriptedProvider([good, publish]).provider);
    checkStorageQuota.mockResolvedValue({ allowed: false, used: 50_000_000, incoming: 10, max: 50_000_000 });
    const last = (await events(await post({ BUILD_AGENT: 'on' }, { phase: 'build', prompt: 'a page' }))).at(-1);
    expect(last).toMatchObject({ type: 'error', code: 'STORAGE_LIMIT_EXCEEDED' });
  });

  it('falls back to the one-shot builder when the flag is off', async () => {
    const evs = await events(await post({}, { phase: 'build', prompt: 'a page' }));
    expect(getCrewProvider).not.toHaveBeenCalled();
    expect(streamChat).toHaveBeenCalled();
    expect(evs.some((e) => e.type === 'delta')).toBe(true);
  });

  it('falls back to the one-shot builder when no provider is configured', async () => {
    getCrewProvider.mockReturnValue(null);
    publishGeneratedHtml.mockResolvedValue(published());
    const evs = await events(await post({ BUILD_AGENT: 'on' }, { phase: 'build', prompt: 'a page' }));
    expect(streamChat).toHaveBeenCalled();
    expect(evs.at(-1)).toMatchObject({ type: 'done' });
  });

  it('the preview phase keeps the streaming path even with the flag on', async () => {
    const evs = await events(await post({ BUILD_AGENT: 'on' }, { phase: 'preview', prompt: 'a page' }));
    expect(getCrewProvider).not.toHaveBeenCalled();
    expect(evs.at(-1)).toMatchObject({ type: 'done', mode: 'preview' });
  });
});

describe('/v1/create/generate with the per-workspace agent flag', () => {
  /** A DB where the build_agent flag is on for wsA only. */
  const DB = {
    prepare: (sql: string) => ({
      bind: (id: string) => ({
        first: async () => (sql.includes('feature_flags') ? (id === 'wsA' ? { feature_flags: '{"ai.build_agent":true}' } : null) : null),
      }),
    }),
  } as unknown as Env['DB'];

  it('runs the agent on the workspace that has the flag on', async () => {
    hostWorkspaceId.mockResolvedValue('wsA');
    getCrewProvider.mockReturnValue(scriptedProvider([good, publish]).provider);
    const evs = await events(await post({ DB }, { phase: 'build', prompt: 'a page' }));
    expect(getCrewProvider).toHaveBeenCalled();
    expect(streamChat).not.toHaveBeenCalled();
    expect(evs.at(-1)).toMatchObject({ type: 'done', mode: 'build' });
  });

  it('keeps the one-shot builder on a workspace without it', async () => {
    hostWorkspaceId.mockResolvedValue('wsB');
    await events(await post({ DB }, { phase: 'build', prompt: 'a page' }));
    expect(getCrewProvider).not.toHaveBeenCalled();
    expect(streamChat).toHaveBeenCalled();
  });

  it('BUILD_AGENT=off wins over the workspace flag', async () => {
    hostWorkspaceId.mockResolvedValue('wsA');
    await events(await post({ DB, BUILD_AGENT: 'off' }, { phase: 'build', prompt: 'a page' }));
    expect(getCrewProvider).not.toHaveBeenCalled();
    expect(streamChat).toHaveBeenCalled();
  });
});
