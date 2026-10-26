// @vitest-environment node
//
// PUT /v1/workspaces/{id}/catalog/files accepts short relative .md paths and bounded content.
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/router/helpers/auth-guard', () => ({
  isAuthUser: (r: unknown) => !(r instanceof Response),
  requireTokenOrSession: async () => ({ id: 'usr_catv', email: 'catv@x.test' }),
}));
vi.mock('../../../src/workspaces/roles', async (orig) => ({ ...(await orig<object>()), getInternalWorkspaceRole: async () => 'member' }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { routeCatalogApi } from '../../../src/router/api/catalog';
import { isValidCatalogPath, listCatalogFiles, upsertCatalogFile, MAX_CATALOG_FILE_BYTES } from '../../../src/catalog/store';

const WS = 'wsp_catv';
const ENTRY = '---\nkind: source\nid: orders\ntitle: Orders\n---\nNotes.';

function call(method: string, path: string, body?: unknown): Promise<Response> {
  const request = new Request(`https://so.test/v1/workspaces/${WS}/catalog/${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const url = new URL(request.url);
  return routeCatalogApi({ request, env: e, url, path: url.pathname, addCORS: (r: Response) => r } as never) as Promise<Response>;
}
const paths = async () => (await listCatalogFiles(e, WS)).map((f) => f.path);

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email) VALUES ('usr_catv', 'catv@x.test')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'catv-w', 'usr_catv')").bind(WS),
  ]);
});

const GOOD = ['orders.md', 'sources/orders.md', 'datasets/snowflake-prod/orders.md', 'Sources/Orders_v2.MD', 'a/b/c/d.md'];
const BAD = [
  '', '../orders.md', 'sources/../../orders.md', 'sources/..', '/etc/orders.md', 'sources//orders.md', 'sources/orders.md/',
  'sources/orders.txt', 'sources/orders', '.md', 'sources/.hidden.md', '.git/config.md', 'sources\\orders.md',
  'my orders.md', 'a"b.md', "a'b.md", 'a<b>.md', 'a\u0000b.md', 'a\nb.md', 'métricas/ingresos.md', 'a/b/c/d/e.md',
  `${'a'.repeat(198)}.md`,
];

describe('isValidCatalogPath', () => {
  it('accepts short relative .md paths', () => {
    for (const p of GOOD) expect(isValidCatalogPath(p), p).toBe(true);
  });
  it('refuses traversal, absolute, non-.md, odd characters, and deep or long paths', () => {
    for (const p of BAD) expect(isValidCatalogPath(p), JSON.stringify(p)).toBe(false);
    for (const p of [5, null, undefined, {}]) expect(isValidCatalogPath(p)).toBe(false);
  });
});

describe('PUT …/catalog/files', () => {
  it('stores a valid entry', async () => {
    const res = await call('PUT', 'files', { path: 'sources/orders.md', content: ENTRY });
    expect(res.status).toBe(200);
    expect(await paths()).toContain('sources/orders.md');
  });

  it('refuses an invalid path with 400 INVALID_PATH and stores nothing', async () => {
    const before = await paths();
    for (const path of [...BAD.filter(Boolean), 42]) {
      const res = await call('PUT', 'files', { path, content: ENTRY });
      expect(res.status, JSON.stringify(path)).toBe(400);
      const body = await res.json() as { code: string; param: string; hint: string };
      expect([body.code, body.param]).toEqual(['INVALID_PATH', 'path']);
      expect(body.hint).toContain('.md');
    }
    expect(await paths()).toEqual(before);
  });

  it(`refuses content over ${MAX_CATALOG_FILE_BYTES / 1024} KB (counted in UTF-8 bytes) with 413 FILE_TOO_LARGE`, async () => {
    const atCap = await call('PUT', 'files', { path: 'sources/big.md', content: 'x'.repeat(MAX_CATALOG_FILE_BYTES) });
    expect(atCap.status).toBe(200);
    for (const content of ['x'.repeat(MAX_CATALOG_FILE_BYTES + 1), 'é'.repeat(MAX_CATALOG_FILE_BYTES / 2 + 1)]) {
      const res = await call('PUT', 'files', { path: 'sources/bigger.md', content });
      expect(res.status).toBe(413);
      expect(((await res.json()) as { code: string }).code).toBe('FILE_TOO_LARGE');
    }
    expect(await paths()).not.toContain('sources/bigger.md');
  });

  it('still requires path and content', async () => {
    expect((await call('PUT', 'files', { path: 'sources/x.md' })).status).toBe(400);
    expect((await call('PUT', 'files', { content: ENTRY })).status).toBe(400);
  });
});

describe('DELETE …/catalog/files', () => {
  it('still removes a file stored under a path the new rules would refuse', async () => {
    await upsertCatalogFile(e, WS, { path: 'Legacy Notes.md', content: ENTRY });
    const res = await call('DELETE', `files?path=${encodeURIComponent('Legacy Notes.md')}`);
    expect(res.status).toBe(200);
    expect(await paths()).not.toContain('Legacy Notes.md');
  });
});
