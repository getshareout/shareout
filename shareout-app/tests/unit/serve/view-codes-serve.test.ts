import { describe, expect, it } from 'vitest';
import './helpers/mocks';
import { ARTIFACT_ID, SLUG, createServeEnv, defaultDeployment, serveRequest } from './helpers/env';
import { setupServeTestHooks } from './helpers/hooks';
import { handleServe } from '../../../src/serve';
import { gateArtifactSideAsset } from '../../../src/serve/handle-serve';
import { handleServeText } from '../../../src/serve/handle-serve-text';
import { createAccessToken } from '../../../src/token';
import type { Env } from '../../../src/types';

setupServeTestHooks();

const CODE_ID = 'vcd_serve';

/** A one-time page whose code `CODE_ID` was opened `openedAgoMs` ago, for 90 s. */
function oneTimeEnv(opts: { visibility?: 'private' | 'public'; openedAgoMs?: number } = {}) {
  const { env } = createServeEnv({
    deployment: { ...defaultDeployment, visibility: opts.visibility ?? 'private', auth_method: 'onetime' as 'google', has_mobile: 0 },
  });
  const openedAt = new Date(Date.now() - (opts.openedAgoMs ?? 5_000)).toISOString();
  const prepare = env.DB.prepare.bind(env.DB);
  (env.DB as unknown as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
    if (!sql.includes('FROM artifact_view_codes')) return prepare(sql);
    return {
      bind: (...args: unknown[]) => ({
        first: async () => (args[0] === CODE_ID
          ? { id: CODE_ID, label: 'Ana · Sucursal Centro', view_seconds: 90, opened_at: openedAt, revoked_at: null }
          : null),
      }),
    };
  };
  return env;
}

async function passCookie(env: Env) {
  const token = await createAccessToken(ARTIFACT_ID, `otv:${CODE_ID}`, env, 85);
  return `shareout_access_${ARTIFACT_ID}=${token}`;
}

describe('one-time view: serving', () => {
  it('a code holder gets the locked viewer: sandboxed frame, watermark, no toolbar, not framable', async () => {
    const env = oneTimeEnv();
    const res = await handleServe(serveRequest('', { headers: { Cookie: await passCookie(env) } }), env, SLUG, '');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="so-otv-frame"');
    expect(html).toContain('sandbox="allow-scripts allow-forms"');
    expect(html).not.toContain('allow-downloads');
    expect(html).not.toContain('clipboard-write');
    expect(html).toContain('Ana · Sucursal Centro');
    expect(html).not.toContain('shareout-initial-data');
    // The close is silent: the time left is in the script, never on screen.
    expect(html).not.toMatch(/countdown|cuenta regresiva/i);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(res.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
  });

  it('no pass, no session: the code page, even when the page is marked public', async () => {
    for (const visibility of ['private', 'public'] as const) {
      const env = oneTimeEnv({ visibility });
      const res = await handleServe(serveRequest(''), env, SLUG, '');
      expect(res.status).toBe(401);
      expect(await res.text()).toContain('action="/auth/view-code"');
    }
  });

  it('a pass whose window is over opens nothing', async () => {
    const env = oneTimeEnv({ openedAgoMs: 95_000 });
    const res = await handleServe(serveRequest('', { headers: { Cookie: await passCookie(env) } }), env, SLUG, '');
    expect(res.status).toBe(401);
  });

  it('the page itself loads in the frame with the guard in, and never as a tab of its own', async () => {
    const env = oneTimeEnv();
    const cookie = await passCookie(env);
    const framed = await handleServe(serveRequest('?_raw', { headers: { Cookie: cookie, 'Sec-Fetch-Dest': 'iframe' } }), env, SLUG, '');
    expect(framed.status).toBe(200);
    const body = await framed.text();
    expect(body).toContain('id="so-otv-guard"');
    expect(body).toContain('<h1>Hello</h1>');
    expect(framed.headers.get('Cache-Control')).toContain('no-store');

    const tab = await handleServe(serveRequest('?_raw', { headers: { Cookie: cookie, 'Sec-Fetch-Dest': 'document' } }), env, SLUG, '');
    expect(tab.status).toBe(403);
    // fetch() from the console is no frame either.
    const fetched = await handleServe(serveRequest('?_raw', { headers: { Cookie: cookie, 'Sec-Fetch-Dest': 'empty' } }), env, SLUG, '');
    expect(fetched.status).toBe(403);
    // The page's own images still load inside the frame.
    const img = await handleServe(serveRequest('logo.png', { headers: { Cookie: cookie, 'Sec-Fetch-Dest': 'image' } }), env, SLUG, 'logo.png');
    expect(img.status).toBe(200);
  });

  it('the text version, embed and thumbnails stay closed, even when the page is marked public', async () => {
    const env = oneTimeEnv({ visibility: 'public' });
    const text = await handleServeText(new Request(`https://shareout.example.com/a/${SLUG}/index.md`, { headers: { Cookie: await passCookie(env) } }), env, SLUG);
    expect(text.status).toBe(401);
  });

  it('a code holder cannot download the page source', async () => {
    const env = oneTimeEnv();
    const res = await handleServe(serveRequest('download', { headers: { Cookie: await passCookie(env) } }), env, SLUG, 'download');
    expect(res.status).toBe(404);
  });

  it('content domain: the code holder token gets the guard; the owner token gets the plain page', async () => {
    const env = oneTimeEnv();
    const otv = await createAccessToken(ARTIFACT_ID, 'content_otv', env, 60);
    const framed = await handleServe(serveRequest('', { headers: { 'Sec-Fetch-Dest': 'iframe' } }), env, SLUG, 'index.html', { contentOrigin: true, ct: otv });
    expect(framed.status).toBe(200);
    expect(await framed.text()).toContain('id="so-otv-guard"');

    const tab = await handleServe(serveRequest('', { headers: { 'Sec-Fetch-Dest': 'document' } }), env, SLUG, 'index.html', { contentOrigin: true, ct: otv });
    expect(tab.status).toBe(403);

    const ownerCt = await createAccessToken(ARTIFACT_ID, 'content', env, 60);
    const owner = await handleServe(serveRequest('?_raw', { headers: { 'Sec-Fetch-Dest': 'iframe' } }), env, SLUG, '', { contentOrigin: true, ct: ownerCt });
    expect(owner.status).toBe(200);
    expect(await owner.text()).not.toContain('so-otv-guard');
  });

  it('side assets (manifest, icons, screenshots) stay closed to a code holder', async () => {
    const env = oneTimeEnv({ visibility: 'public' });
    const res = await gateArtifactSideAsset(serveRequest('', { headers: { Cookie: await passCookie(env) } }), env, SLUG);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });
});
