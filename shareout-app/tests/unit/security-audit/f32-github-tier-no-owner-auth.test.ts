import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleDataRequest } from '../../../src/data/router';
import { storeArtifactToken } from '../../../src/data/github/github-auth';
import { createSessionToken } from '../../../src/token';
import { applyMigrations, e } from '../helpers/migrated-db';

const ART = 'art_f32_public';
const OWNER_TOKEN = 'gho_OWNER_DUMMY_TOKEN';

beforeAll(async () => {
  await applyMigrations();
  (e as { CREDENTIALS_KEY?: string }).CREDENTIALS_KEY = 'test-key-32-chars-long-enough!!!';
  (e as { SESSION_SECRET?: string }).SESSION_SECRET ||= 'test-session-secret-f32';
  await e.DB.batch([
    e.DB.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').bind('usr_f32_owner', 'f32owner@x.test'),
    e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, ?, ?)')
      .bind(ART, ART, `slug-${ART}`, 'usr_f32_owner', 'public'),
  ]);
  await e.DB.batch([
    e.DB.prepare('INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, ?, ?)').bind('ver_f32', ART, 'index.html', '{}'),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES ('dep_f32', ?, 'ver_f32', 'production', ?)").bind(ART, `slug-${ART}`),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, ?, ?, ?, ?, 'x')").bind('ast_f32', 'ver_f32', 'index.html', 'f32/index.html', 'text/html', 5),
  ]);
  await e.ARTIFACTS.put('f32/index.html', 'hello');
  await storeArtifactToken(e, ART, OWNER_TOKEN, { login: 'owner-gh', id: 42 });
});

afterEach(() => vi.unstubAllGlobals());

function stubGitHub() {
  const calls: { url: string; method: string; auth: string | null; body: string | null }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? 'GET', auth: headers.get('Authorization'), body: (init?.body as string) ?? null });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/user/repos')) return json([{ name: 'secret-repo', full_name: 'owner-gh/secret-repo', private: true, html_url: 'https://github.com/owner-gh/secret-repo', default_branch: 'main' }]);
    if (url.includes('/contents/')) return json({ content: { sha: 's' } });
    return json({ name: 'r', full_name: 'owner-gh/r', html_url: 'https://github.com/owner-gh/r', default_branch: 'main', private: false, owner: { login: 'owner-gh' } });
  });
  return calls;
}

describe('f32 github tier', () => {
  const run = (path: string, method = 'GET') =>
    handleDataRequest(new Request(`https://so.test/v1/data/${ART}/github/${path}`, { method }), e, `${ART}/github/${path}`);

  it('blocks: anonymous visitor cannot use the owner token on any github route', async () => {
    const calls = stubGitHub();
    for (const [path, method] of [['repos', 'GET'], ['export', 'POST'], ['token-status', 'GET'], ['disconnect', 'POST']] as const) {
      const res = await run(path, method);
      expect([401, 403]).toContain(res.status);
    }
    expect(calls).toEqual([]);
    const row = await e.DB.prepare("SELECT id FROM connections WHERE scope_id = ? AND provider = 'github'").bind(ART).first();
    expect(row).not.toBeNull();
  });

  it('the owner can still list repos', async () => {
    const calls = stubGitHub();
    const token = await createSessionToken('usr_f32_owner', 'f32owner@x.test', e);
    const res = await handleDataRequest(
      new Request(`https://so.test/v1/data/${ART}/github/repos`, { headers: { Cookie: `shareout_session=${token}` } }),
      e, `${ART}/github/repos`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain('secret-repo');
    expect(calls.some((c) => c.auth === `Bearer ${OWNER_TOKEN}`)).toBe(true);
  });
});
