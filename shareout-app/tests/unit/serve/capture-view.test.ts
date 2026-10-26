import { describe, expect, it, vi } from 'vitest';
import './helpers/mocks';
import { ARTIFACT_ID, SLUG, createServeEnv, serveRequest } from './helpers/env';
import { setupServeTestHooks } from './helpers/hooks';
import { handleServe } from '../../../src/serve';
import { createAccessToken, type AccessTokenPayload } from '../../../src/token';
import { WRITABLE_CAPTURE_SESSION_TTL_SEC, mintCaptureLinkToken } from '../../../src/auth/capture-session';

setupServeTestHooks();

const HTML = '<html><head><title>Report</title></head><body><h1>Q3</h1></body></html>';
const decode = (token: string) => JSON.parse(atob(token.split('.')[0])) as AccessTokenPayload;
const nowSec = () => Math.floor(Date.now() / 1000);

function captureEnv() {
  return createServeEnv({ r2: { 'artifacts/demo/index.html': { body: HTML } } }).env;
}

async function openCapture(env: ReturnType<typeof captureEnv>, link: string) {
  const response = await handleServe(serveRequest(`?_capture=${encodeURIComponent(link)}`), env, SLUG, '');
  const html = await response.text();
  const json = html.match(/<script id="shareout-initial-data" type="application\/json">(.*?)<\/script>/)?.[1];
  const initial = json ? JSON.parse(json) as { artifactId: string; baseUrl: string; sessionToken?: string } : null;
  return { response, html, initial, session: initial?.sessionToken ? decode(initial.sessionToken) : null };
}

describe('capture view session', () => {
  it('a read-only render puts no credential in the page', async () => {
    const env = captureEnv();
    const link = await mintCaptureLinkToken(env, ARTIFACT_ID);

    const { response, html, initial, session } = await openCapture(env, link);

    expect(response.status).toBe(200);
    expect(initial).toEqual({ artifactId: ARTIFACT_ID, baseUrl: expect.any(String) });
    expect(session).toBeNull();
    expect(html).not.toContain('sessionToken');
    // Nothing is minted for the page, so the owner is not even looked up.
    const sqls = vi.mocked(env.DB.prepare).mock.calls.map(([sql]) => sql);
    expect(sqls.some((sql) => sql.includes('SELECT email FROM users'))).toBe(false);
  });

  it('reopening a read-only link yields no session either', async () => {
    const env = captureEnv();
    const link = await createAccessToken(ARTIFACT_ID, 'capture', env, 20);

    await openCapture(env, link);
    const { session } = await openCapture(env, link);

    expect(session).toBeNull();
  });

  it('a pilot_verify link gets the short writable owner session, ending with its link', async () => {
    const env = captureEnv();
    const link = await createAccessToken(ARTIFACT_ID, 'capture_verify', env, 300);

    const { session } = await openCapture(env, link);

    expect(session?.authType).toBe('owner');
    expect(session!.exp).toBeLessThanOrEqual(nowSec() + WRITABLE_CAPTURE_SESSION_TTL_SEC);
    expect(session!.exp).toBeLessThanOrEqual(decode(link).exp);
  });

  it('a page session cannot open the capture view', async () => {
    const env = captureEnv();
    const session = await createAccessToken(ARTIFACT_ID, 'owner_test', env, 600);

    const { response } = await openCapture(env, session);

    expect(response.status).toBe(403);
  });
});
