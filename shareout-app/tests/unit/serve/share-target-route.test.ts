// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/types';
import manifestRaw from '../../../public/manifest.webmanifest?raw';

const getSessionUser = vi.hoisted(() => vi.fn());
const ingestBlobDirect = vi.hoisted(() => vi.fn());
const getOrCreateAssetBucket = vi.hoisted(() => vi.fn());

vi.mock('../../../src/auth/session', () => ({ getSessionUser }));
vi.mock('../../../src/data/blobs/handler', () => ({ ingestBlobDirect }));
vi.mock('../../../src/assets/bucket', () => ({ getOrCreateAssetBucket }));
vi.mock('../../../src/pages/home/host', () => ({ hostWorkspaceId: vi.fn(async () => null) }));

import { routeServe } from '../../../src/router/serve-router';
import { createFetchContext } from '../../../src/router/context';

function ctxFor(path: string, env: Partial<Env> = {}, method = 'GET', body?: BodyInit) {
  const url = `https://shareout.site${path}`;
  const request = new Request(url, { method, body });
  return createFetchContext(request, env as Env);
}

describe('routeServe — app PWA shell', () => {
  it('serves manifest.webmanifest from ASSETS', async () => {
    const manifestBody = '{"name":"ShareOut"}';
    const env = {
      ASSETS: { fetch: vi.fn(async () => new Response(manifestBody, { headers: { 'Content-Type': 'application/manifest+json' } })) },
    } as unknown as Env;
    const res = await routeServe(ctxFor('/manifest.webmanifest', env));
    expect(res!.status).toBe(200);
    expect(await res!.text()).toBe(manifestBody);
  });

  it('manifest file parses and includes share_target', () => {
    const m = JSON.parse(manifestRaw) as { share_target?: { action?: string }; start_url?: string };
    expect(m.share_target?.action).toBe('/share-target');
    expect(m.start_url).toBe('/home');
  });
});

describe('routeServe — /share-target', () => {
  beforeEach(() => {
    getSessionUser.mockReset();
    ingestBlobDirect.mockReset();
    getOrCreateAssetBucket.mockReset();
    getOrCreateAssetBucket.mockResolvedValue({ id: 'art_bucket' });
    ingestBlobDirect.mockResolvedValue({ ok: true, blobId: 'blob_abc' });
  });

  it('redirects unauthenticated POST to /home', async () => {
    getSessionUser.mockResolvedValue(null);
    const res = await routeServe(ctxFor('/share-target', {}, 'POST'));
    expect(res!.status).toBe(303);
    expect(res!.headers.get('Location')).toBe('https://shareout.site/home');
  });

  it('ingests file and redirects with chat_file params', async () => {
    getSessionUser.mockResolvedValue({ id: 'usr_1', email: 'a@b.com' });
    const form = new FormData();
    form.append('files', new File(['hello'], 'report.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const dbRun = vi.fn();
    const env = {
      DB: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run: dbRun })) })) },
    } as unknown as Env;
    const res = await routeServe(ctxFor('/share-target', env, 'POST', form));
    expect(res!.status).toBe(303);
    const loc = new URL(res!.headers.get('Location')!);
    expect(loc.pathname).toBe('/home');
    expect(loc.searchParams.get('chat_file')).toBe('blob_abc');
    expect(loc.searchParams.get('chat_name')).toBe('report.xlsx');
    expect(ingestBlobDirect).toHaveBeenCalledOnce();
    expect(dbRun).toHaveBeenCalled();
  });
});
