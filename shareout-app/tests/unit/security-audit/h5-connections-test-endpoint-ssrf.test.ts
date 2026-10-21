import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleDataRequest } from '../../../src/data/router';
import { createSessionToken } from '../../../src/token';
import { applyMigrations, e } from '../helpers/migrated-db';
import type { Env } from '../../../src/types';

const env = new Proxy(e, { get: (t, k, r) => (k === 'CREDENTIALS_KEY' ? 'h5-test-credentials-key-32bytes!!!' : Reflect.get(t, k, r)) }) as unknown as Env;
const ART = 'art_h5_conn';

beforeAll(async () => {
  await applyMigrations();
  (e as { SESSION_SECRET?: string }).SESSION_SECRET ||= 'test-session-secret-h5';
  await e.DB.batch([
    e.DB.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').bind('usr_h5_owner', 'h5owner@x.test'),
    e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, ?, ?)').bind(ART, ART, `slug-${ART}`, 'usr_h5_owner', 'private'),
  ]);
  const ins = (id: string, name: string, config: unknown) => e.DB.prepare(
    "INSERT INTO connections (id, scope_type, scope_id, name, kind, provider, config) VALUES (?, 'artifact', ?, ?, 'generic', 'rest_api', ?)",
  ).bind(id, ART, name, JSON.stringify(config)).run();
  await ins('con_h5_a', 'userinfo', { baseUrl: 'https://api.upstream.test', healthEndpoint: '@169.254.169.254/latest/meta-data' });
  await ins('con_h5_b', 'redirect', { baseUrl: 'https://api.upstream.test', healthEndpoint: '/health' });
  await ins('con_h5_c', 'ok', { baseUrl: 'https://api.upstream.test', healthEndpoint: '/health' });
});
afterEach(() => vi.unstubAllGlobals());

async function test(name: string) {
  const token = await createSessionToken('usr_h5_owner', 'h5owner@x.test', e);
  return handleDataRequest(new Request(`https://so.test/v1/data/${ART}/connections/${name}/test`, {
    method: 'POST', headers: { Cookie: `shareout_session=${token}` },
  }), env, `${ART}/connections/${name}/test`);
}

describe('h5 connection test endpoint SSRF', () => {
  it('blocks: healthEndpoint cannot retarget the request to an internal host', async () => {
    const hosts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: RequestInfo | URL) => { hosts.push(new URL(String(u)).host); return new Response('{}'); }));
    await test('userinfo');
    expect(hosts.filter(h => h.includes('169.254'))).toEqual([]);
  });

  it('blocks: redirects to internal hosts are not followed', async () => {
    const hosts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
      hosts.push(new URL(String(u)).host);
      if (init?.redirect !== 'manual') return new Response('{}');
      return new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest' } });
    }));
    const res = await test('redirect');
    expect(hosts).toEqual(['api.upstream.test']);
    expect(((await res.json()) as { data: { success: boolean } }).data.success).toBe(false);
  });

  it('a normal health check still works', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const res = await test('ok');
    expect(((await res.json()) as { data: { success: boolean; status: number } }).data).toMatchObject({ success: true, status: 200 });
  });
});
