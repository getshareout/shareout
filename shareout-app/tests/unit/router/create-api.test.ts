// P0/P1 robustness: /v1/create/generate guards (gate, body, auth, plan fallback).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { createFetchContext } from '../../../src/router/context';

const getSessionUser = vi.hoisted(() => vi.fn());
const hostWorkspaceId = vi.hoisted(() => vi.fn());
const requireCreateEnabled = vi.hoisted(() => vi.fn());
const chat = vi.hoisted(() => vi.fn());
const checkSlidingWindowRateLimit = vi.hoisted(() => vi.fn());
const publishGeneratedHtml = vi.hoisted(() => vi.fn());
const streamChat = vi.hoisted(() => vi.fn());
const extractHtml = vi.hoisted(() => vi.fn());
const checkRateLimit = vi.hoisted(() => vi.fn());
const incrementRateLimit = vi.hoisted(() => vi.fn());
const checkStorageQuota = vi.hoisted(() => vi.fn());
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
const resolveAllowOpen = vi.hoisted(() => vi.fn());

vi.mock('../../../src/auth/session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSessionUser,
}));
vi.mock('../../../src/pages/home/host', () => ({ hostWorkspaceId }));
vi.mock('../../../src/pages/create-gate', () => ({ requireCreateEnabled }));
vi.mock('../../../src/data/agent/anthropic', () => ({
  chat,
  streamChat,
  getAgentChatModel: vi.fn(() => 'model'),
  getBuildConfig: vi.fn(() => ({})),
}));
vi.mock('../../../src/rate-limit', () => ({
  checkSlidingWindowRateLimit,
  getClientIp: vi.fn(() => '1.2.3.4'),
}));
vi.mock('../../../src/publish/publish-generated-html', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  publishGeneratedHtml,
}));
vi.mock('../../../src/api-auth', () => ({ checkRateLimit, incrementRateLimit, RATE_LIMIT_MAX: 100 }));
vi.mock('../../../src/quota', () => ({ checkStorageQuota }));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));
vi.mock('../../../src/access/allow-open', () => ({ resolveAllowOpen }));
vi.mock('../../../src/logging', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  logError: vi.fn(),
}));
vi.mock('../../../src/data/agent/build-page', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  BUILD_MAX_TOKENS: 100,
  buildSystemPrompt: vi.fn(),
  extractHtml,
  deriveName: vi.fn((p: string) => p.slice(0, 20)),
}));
vi.mock('../../../src/pages/themes', () => ({ getPackDirective: vi.fn(() => 'clean') }));

import { routeCreateApi } from '../../../src/router/api/create';

const env = { RATE_LIMIT_KV: {} } as Env;

function post(body: unknown) {
  const req = new Request('https://shareout.site/v1/create/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return routeCreateApi(createFetchContext(req, env));
}

beforeEach(() => {
  getSessionUser.mockReset().mockResolvedValue(null);
  hostWorkspaceId.mockReset().mockResolvedValue(null);
  requireCreateEnabled.mockReset().mockResolvedValue(null);
  chat.mockReset();
  checkSlidingWindowRateLimit.mockReset().mockResolvedValue({ allowed: true });
  publishGeneratedHtml.mockReset();
  streamChat.mockReset();
  extractHtml.mockReset();
  checkRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 99, reset: 0 });
  incrementRateLimit.mockReset().mockResolvedValue(undefined);
  checkStorageQuota.mockReset().mockResolvedValue({ allowed: true, used: 0, incoming: 0, max: 0 });
  getInternalWorkspaceRole.mockReset().mockResolvedValue(null);
});

afterEach(() => vi.restoreAllMocks());

describe('routeCreateApi', () => {
  it('ignores non-create paths', async () => {
    const req = new Request('https://shareout.site/v1/other', { method: 'POST' });
    expect(await routeCreateApi(createFetchContext(req, env))).toBeNull();
  });

  it('returns the create-gate response when AI create is disabled', async () => {
    requireCreateEnabled.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'off', code: 'FEATURE_DISABLED' }), { status: 403 }),
    );
    const res = await post({ phase: 'plan', prompt: 'build a page' });
    expect(res?.status).toBe(403);
  });

  it('400s invalid JSON and empty prompt', async () => {
    expect((await post('nope'))?.status).toBe(400);
    const empty = await post({ phase: 'plan', prompt: '   ' });
    expect(empty?.status).toBe(400);
    expect((await empty!.json() as { error: string }).error).toMatch(/what to build/i);
  });

  it('plans via the LLM and maps clarify/reply modes', async () => {
    chat.mockResolvedValueOnce({
      content: JSON.stringify({
        mode: 'clarify',
        message: 'Quick — two things.',
        questions: [{ q: 'Tone?', options: ['Warm', 'Bold'] }],
      }),
    });
    const clarify = await post({ phase: 'plan', prompt: 'landing page' });
    expect(clarify?.status).toBe(200);
    expect(await clarify!.json()).toMatchObject({ ok: true, type: 'clarify' });

    chat.mockResolvedValueOnce({
      content: JSON.stringify({ mode: 'reply', message: 'Sure!', suggestions: ['Build it'] }),
    });
    const reply = await post({ phase: 'plan', prompt: 'thanks' });
    expect(await reply!.json()).toMatchObject({ ok: true, type: 'reply', message: 'Sure!' });
  });

  it('falls back to build when the planner errors', async () => {
    chat.mockRejectedValueOnce(new Error('llm down'));
    const res = await post({ phase: 'plan', prompt: 'dashboard' });
    expect(res?.status).toBe(200);
    expect(await res!.json()).toMatchObject({ ok: true, type: 'build' });
  });

  it('401s publish/build without a session', async () => {
    const res = await post({ phase: 'publish', prompt: 'x', html: '<html><body>hi</body></html>' });
    expect(res?.status).toBe(401);
    expect((await res!.json() as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('429s anonymous preview when the IP limit trips', async () => {
    checkSlidingWindowRateLimit.mockResolvedValueOnce({ allowed: false });
    const res = await post({ phase: 'preview', prompt: 'a page' });
    expect(res?.status).toBe(429);
    expect((await res!.json() as { code: string }).code).toBe('PREVIEW_LIMIT');
  });

  it('publishes previewed HTML for a signed-in user', async () => {
    getSessionUser.mockResolvedValue({ id: 'u1', email: 'a@x.com' });
    publishGeneratedHtml.mockResolvedValue({
      artifact: { id: 'art1' },
      deployment: { url: 'https://shareout.site/a/s/', slug: 's' },
    });
    const html = '<!doctype html><html><body><h1>Hi</h1></body></html>';
    const res = await post({ phase: 'publish', prompt: 'hi page', html });
    expect(res?.status).toBe(200);
    expect(await res!.json()).toMatchObject({ ok: true, artifactId: 'art1', slug: 's' });
    expect(publishGeneratedHtml).toHaveBeenCalled();
  });

  const html = '<!doctype html><html><body><h1>Hi</h1></body></html>';
  const deployed = { artifact: { id: 'art1' }, deployment: { url: 'https://shareout.site/a/s/', slug: 's' } };

  async function sseEvents(res: Response | null) {
    const text = await res!.text();
    return text.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')));
  }

  it('reports a live public publish as public with no moderation hold', async () => {
    getSessionUser.mockResolvedValue({ id: 'u1', email: 'a@x.com' });
    publishGeneratedHtml.mockResolvedValue({ ...deployed, visibility: 'public' });
    const body = await (await post({ phase: 'publish', prompt: 'hi page', html }))!.json();
    expect(body).toMatchObject({ ok: true, visibility: 'public' });
    expect(body).not.toHaveProperty('moderation');
    expect(incrementRateLimit).toHaveBeenCalledWith(env, 'u1', 'publish', 'a@x.com');
  });

  it('reports a moderation hold instead of claiming the page is live', async () => {
    getSessionUser.mockResolvedValue({ id: 'u1', email: 'a@x.com' });
    publishGeneratedHtml.mockResolvedValue({
      ...deployed,
      visibility: 'private',
      moderation: { status: 'pending', reason: 'looks like a login form', message: 'held', forced_private: true },
    });
    const body = await (await post({ phase: 'publish', prompt: 'hi page', html }))!.json();
    expect(body).toMatchObject({ ok: true, visibility: 'private', moderation: { status: 'pending', message: 'held' } });
  });

  it('carries the moderation hold through the streamed build done event', async () => {
    getSessionUser.mockResolvedValue({ id: 'u1', email: 'a@x.com' });
    streamChat.mockImplementation(async function* () { yield { type: 'content', content: html }; });
    extractHtml.mockReturnValue(html);
    publishGeneratedHtml.mockResolvedValue({
      ...deployed,
      visibility: 'private',
      moderation: { status: 'pending', message: 'held', forced_private: true },
    });
    const events = await sseEvents(await post({ phase: 'build', prompt: 'hi page' }));
    expect(events.at(-1)).toMatchObject({
      type: 'done', url: deployed.deployment.url, visibility: 'private', moderation: { status: 'pending' },
    });
  });

  it('streams a public done event with no moderation when the page is approved', async () => {
    getSessionUser.mockResolvedValue({ id: 'u1', email: 'a@x.com' });
    streamChat.mockImplementation(async function* () { yield { type: 'content', content: html }; });
    extractHtml.mockReturnValue(html);
    publishGeneratedHtml.mockResolvedValue({ ...deployed, visibility: 'public' });
    const done = (await sseEvents(await post({ phase: 'build', prompt: 'hi page' }))).at(-1);
    expect(done).toMatchObject({ type: 'done', visibility: 'public' });
    expect(done).not.toHaveProperty('moderation');
  });

  it('never publishes a build the model could not finish, and says why', async () => {
    getSessionUser.mockResolvedValue({ id: 'u1', email: 'a@x.com' });
    streamChat.mockImplementation(async function* () {
      yield { type: 'content', content: '<!doctype html><html><body><script>toast(\'No se pud' };
      yield { type: 'done', truncated: true };
    });
    extractHtml.mockReturnValue(html);
    const events = await sseEvents(await post({ phase: 'build', prompt: 'hi page' }));
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'BUILD_TRUNCATED' });
    expect(events.at(-1).error).toMatch(/too long to finish/);
    expect(publishGeneratedHtml).not.toHaveBeenCalled();
  });

  describe('who can see it', () => {
    const lastOpts = () => publishGeneratedHtml.mock.calls.at(-1)![2];
    beforeEach(() => {
      getSessionUser.mockResolvedValue({ id: 'u1', email: 'a@x.com' });
      publishGeneratedHtml.mockResolvedValue({ ...deployed, visibility: 'private' });
      resolveAllowOpen.mockResolvedValue(true);
    });

    it('publishes private when the client says nothing', async () => {
      await post({ phase: 'publish', prompt: 'hi page', html });
      expect(lastOpts()).toMatchObject({ visibility: 'private', workspaceId: null });
    });

    it('publishes private for an unknown visibility value', async () => {
      await post({ phase: 'publish', prompt: 'hi page', html, visibility: 'unlisted' });
      expect(lastOpts()).toMatchObject({ visibility: 'private' });
    });

    it('passes public through on publish and on the streamed build', async () => {
      await post({ phase: 'publish', prompt: 'hi page', html, visibility: 'public' });
      expect(lastOpts()).toMatchObject({ visibility: 'public', workspaceId: null, allowOpen: true });
      streamChat.mockImplementation(async function* () { yield { type: 'content', content: html }; });
      extractHtml.mockReturnValue(html);
      await sseEvents(await post({ phase: 'build', prompt: 'hi page', visibility: 'public' }));
      expect(lastOpts()).toMatchObject({ visibility: 'public' });
    });

    it('does not let public through when open visibility is off, and says it was downgraded', async () => {
      resolveAllowOpen.mockResolvedValue(false);
      const res = await post({ phase: 'publish', prompt: 'hi page', html, visibility: 'public' });
      expect(lastOpts()).toMatchObject({ visibility: 'public', allowOpen: false });
      expect(await res!.json()).toMatchObject({ visibility: 'private', visibility_downgraded: true });
    });

    it('does not call a chosen-private page downgraded', async () => {
      const res = await post({ phase: 'publish', prompt: 'hi page', html, visibility: 'private' });
      expect(await res!.json()).not.toHaveProperty('visibility_downgraded');
    });

    it('team needs a workspace the user belongs to', async () => {
      getInternalWorkspaceRole.mockResolvedValue('member');
      await post({ phase: 'publish', prompt: 'hi page', html, visibility: 'workspace', workspace_id: 'wsp_1' });
      expect(getInternalWorkspaceRole).toHaveBeenCalledWith(env, 'wsp_1', 'u1');
      expect(lastOpts()).toMatchObject({ visibility: 'workspace', workspaceId: 'wsp_1' });
    });

    it('team falls back to private for a non-member or no workspace', async () => {
      await post({ phase: 'publish', prompt: 'hi page', html, visibility: 'workspace', workspace_id: 'wsp_other' });
      expect(lastOpts()).toMatchObject({ visibility: 'private', workspaceId: null });
      await post({ phase: 'publish', prompt: 'hi page', html, visibility: 'workspace' });
      expect(lastOpts()).toMatchObject({ visibility: 'private', workspaceId: null });
    });
  });

  it('429s build and publish at the daily publish limit, stating the limit and reset', async () => {
    getSessionUser.mockResolvedValue({ id: 'u1', email: 'a@x.com' });
    const reset = Math.floor(Date.UTC(2030, 0, 2) / 1000);
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, reset });
    for (const req of [{ phase: 'build', prompt: 'x' }, { phase: 'publish', prompt: 'x', html }]) {
      const res = await post(req);
      expect(res?.status).toBe(429);
      const body = await res!.json() as { code: string; error: string; limit: number };
      expect(body).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', limit: 100 });
      expect(body.error).toMatch(/100 per day/);
      expect(body.error).toMatch(/resets at 00:00 UTC/);
    }
    expect(streamChat).not.toHaveBeenCalled();
    expect(publishGeneratedHtml).not.toHaveBeenCalled();
  });

  it('413s a publish over the storage quota without publishing', async () => {
    getSessionUser.mockResolvedValue({ id: 'u1', email: 'a@x.com' });
    checkStorageQuota.mockResolvedValue({ allowed: false, used: 50_000_000, incoming: 10, max: 50_000_000 });
    const res = await post({ phase: 'publish', prompt: 'x', html });
    expect(res?.status).toBe(413);
    const body = await res!.json() as { code: string; error: string };
    expect(body.code).toBe('STORAGE_LIMIT_EXCEEDED');
    expect(body.error).toMatch(/50 MB of 50 MB/);
    expect(body.error).not.toMatch(/upgrade/i);
    expect(publishGeneratedHtml).not.toHaveBeenCalled();
    expect(incrementRateLimit).not.toHaveBeenCalled();
  });

  it('streams the storage-limit message when a build would exceed the quota', async () => {
    getSessionUser.mockResolvedValue({ id: 'u1', email: 'a@x.com' });
    streamChat.mockImplementation(async function* () { yield { type: 'content', content: html }; });
    extractHtml.mockReturnValue(html);
    checkStorageQuota.mockResolvedValue({ allowed: false, used: 50_000_000, incoming: 10, max: 50_000_000 });
    const done = (await sseEvents(await post({ phase: 'build', prompt: 'x' }))).at(-1);
    expect(done).toMatchObject({ type: 'error', code: 'STORAGE_LIMIT_EXCEEDED' });
    expect(publishGeneratedHtml).not.toHaveBeenCalled();
  });
});
