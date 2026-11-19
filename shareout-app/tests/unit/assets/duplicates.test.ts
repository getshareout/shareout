// Duplicate pages, found by the content of the file each page came from (never its name),
// one workspace at a time; listing is read-only, and removing takes the workspace owner,
// a named page to keep, copies of it only and an explicit confirm. Removed pages go to the
// ordinary 30-day trash.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const queueKnowledgeSource = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../../src/knowledge/corpus/ingest', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  queueKnowledgeSource,
  relearnPage: vi.fn(async () => {}),
}));
const getSessionUser = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  validateToken: vi.fn(async () => null),
}));
vi.mock('../../../src/auth/session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSessionUser,
}));

import { applyMigrations, e } from '../helpers/migrated-db';
import { convertToPage } from '../../../src/file-imports/convert';
import { publishArtifact } from '../../../src/publish/publish-artifact';
import { findDuplicatePages } from '../../../src/assets/duplicates';
import { routeAssetApi } from '../../../src/router/api/assets';
import { createFetchContext } from '../../../src/router/context';

const OWNER = 'usr_dup_o';
const ADMIN = 'usr_dup_a';
const WS = 'wsp_dup';
const WS2 = 'wsp_dup2';
const enc = (s: string) => new TextEncoder().encode(s);

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(OWNER, 'owner@acme.test', 'Owner'),
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(ADMIN, 'admin@acme.test', 'Admin'),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'Acme', 'acme-dup', OWNER),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS2, 'Acme 2', 'acme-dup2', OWNER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_dup_o', ?, ?, 'owner')").bind(WS, OWNER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_dup_a', ?, ?, 'admin')").bind(WS, ADMIN),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_dup_o2', ?, ?, 'owner')").bind(WS2, OWNER),
  ]);
});

async function page(filename: string, body: string, ws = WS): Promise<string> {
  const p = await convertToPage(e, {
    user: { id: OWNER, email: 'owner@acme.test' }, workspaceId: ws, folderId: null, visibility: 'workspace',
    filename, displayName: filename, bytes: enc(body), slug: null,
  });
  if (!p.ok) throw new Error(p.message);
  return p.artifactId;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const publish = async (name: string, extra: Partial<Parameters<typeof publishArtifact>[2]>) => (await publishArtifact(e, { id: OWNER, email: 'owner@acme.test', username: null }, {
  name, slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${crypto.randomUUID().slice(0, 6)}`, entrypoint: 'index.md', files: [],
  visibility: 'workspace', authMethod: 'google', shareWith: [], credentials: [], workspaceId: WS, folderId: null, ...extra,
}, ctx)).artifact.id;

/** An imported document: the page shows a transcription, the original file is kept beside it. */
const imported = (name: string, transcription: string, original: string) => publish(name, {
  files: [
    { path: 'index.md', content: transcription, mime: 'text/markdown' },
    { path: 'original/acme.pdf', content: btoa(original), mime: 'application/pdf', encoding: 'base64' },
  ],
  artifactType: 'markdown', source: { original: 'original/acme.pdf' },
});
/** A hand-written page: no source file, never a duplicate. */
const handwritten = (name: string, html: string) => publish(name, {
  entrypoint: 'index.html', files: [{ path: 'index.html', content: html, mime: 'text/html' }], artifactType: 'html',
});

function call(as: string, path: string, init: { method?: string; body?: unknown } = {}) {
  getSessionUser.mockResolvedValue({ id: as, email: `${as}@acme.test` });
  const req = new Request(`https://shareout.site/v1/workspaces/${WS}/assets/${path}`, {
    method: init.method || 'GET', headers: { Cookie: 'shareout_session=x', 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return routeAssetApi(createFetchContext(req, e)) as Promise<Response>;
}

const deletedAt = (id: string) => e.DB.prepare('SELECT deleted_at FROM artifacts WHERE id = ?').bind(id).first<string | null>('deleted_at');

describe('duplicate pages', () => {
  let first = '';
  let copy = '';
  let scanA = '';
  let scanB = '';
  let sameName = '';

  it('groups pages by the content of their source file, not by name, within one workspace', async () => {
    first = await page('Acme report.md', '# Q3\n\nSame bytes.');
    copy = await page('Acme report.md', '# Q3\n\nSame bytes.');
    sameName = await page('Acme report.csv', 'a,b\n1,2');           // same name, different file
    await page('Acme other.md', '# Q3\n\nSame bytes.', WS2);         // same file, other workspace
    // Two transcriptions of one scan differ; the kept original is what matches.
    scanA = await imported('Acme scan', '# Scan\n\nfirst reading', 'PDF-BYTES');
    scanB = await imported('Acme scan', '# Scan\n\nsecond reading', 'PDF-BYTES');
    const html = '<!doctype html><title>Acme</title><p>Hello</p>';
    const pages = [await handwritten('Acme home', html), await handwritten('Acme home copy', html)];

    const groups = await findDuplicatePages(e, WS);
    expect(groups.map((g) => g.pages.map((p) => p.id).sort()).sort()).toEqual([[first, copy].sort(), [scanA, scanB].sort()].sort());
    for (const id of [sameName, ...pages]) expect(groups.flatMap((g) => g.pages.map((p) => p.id))).not.toContain(id);
    expect(groups.every((g) => /^[0-9a-f]{64}$/.test(g.sha256))).toBe(true);
    expect(await findDuplicatePages(e, WS2)).toEqual([]);
  });

  it('lists for owners and admins only, and never deletes anything', async () => {
    const res = await call(ADMIN, 'duplicates');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { groups: unknown[] }).groups).toHaveLength(2);
    expect(await deletedAt(copy)).toBeNull();
  });

  it('removes only with the owner, an explicit confirm, and copies of the kept page', async () => {
    const remove = (as: string, body: unknown) => call(as, 'duplicates/remove', { method: 'POST', body });

    expect((await remove(ADMIN, { keep: first, remove: [copy], confirm: true })).status).toBe(403);
    const noConfirm = await remove(OWNER, { keep: first, remove: [copy] });
    expect(noConfirm.status).toBe(400);
    expect(((await noConfirm.json()) as { code: string }).code).toBe('CONFIRM_REQUIRED');

    // One page that is not a copy refuses the whole request.
    const mixed = await remove(OWNER, { keep: first, remove: [copy, sameName], confirm: true });
    expect(mixed.status).toBe(409);
    expect(((await mixed.json()) as { code: string }).code).toBe('NOT_A_DUPLICATE');
    expect(await deletedAt(copy)).toBeNull();
    expect(await deletedAt(sameName)).toBeNull();

    // A file that became the removed page now points at the kept one.
    await e.DB.prepare(`INSERT INTO asset_deliverables (id, bucket_artifact_id, workspace_id, owner_id, name, deleted_at, type_metadata)
      VALUES ('dlv_dup', 'art_bucket_dup', ?, ?, 'Acme report', strftime('%Y-%m-%dT%H:%M:%fZ','now'), json_object('toArtifact', ?))`).bind(WS, OWNER, copy).run();

    const ok = await remove(OWNER, { keep: first, remove: [copy], confirm: true });
    expect(ok.status).toBe(200);
    const body = await ok.json() as { kept: string; removed: Array<{ id: string; recoverableUntil: string }>; retentionDays: number };
    expect(body).toMatchObject({ kept: first, retentionDays: 30 });
    expect(body.removed.map((r) => r.id)).toEqual([copy]);
    const trashed = await deletedAt(copy);
    expect(Date.parse(body.removed[0].recoverableUntil) - Date.parse(trashed!)).toBe(30 * 86_400_000);
    expect(await deletedAt(first)).toBeNull();
    expect(await e.DB.prepare("SELECT json_extract(type_metadata, '$.toArtifact') AS t FROM asset_deliverables WHERE id = 'dlv_dup'").first('t')).toBe(first);

    const left = await findDuplicatePages(e, WS);
    expect(left.map((g) => g.pages.map((p) => p.id).sort())).toEqual([[scanA, scanB].sort()]);
  });
});
