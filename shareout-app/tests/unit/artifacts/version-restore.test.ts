// Version history against the real migrated schema: list attribution, read one
// version's source, and restore as a new head version (editor yes, viewer no).
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../../../src/api-auth';
import { handleGetVersionSource, handleGetVersions, handleRestoreVersion } from '../../../src/artifacts';
import { applyMigrations, e } from '../helpers/migrated-db';

const owner: AuthUser = { id: 'usr_vr_owner', email: 'alice@example.com', username: null };
const editor: AuthUser = { id: 'usr_vr_editor', email: 'bob@example.com', username: null };
const viewer: AuthUser = { id: 'usr_vr_viewer', email: 'carol@example.com', username: null };
const ART = 'art_vr';

const req = (body?: unknown) => new Request('https://x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  await applyMigrations();
  const html1 = '<h1>One</h1>';
  const html2 = '<h1>Two</h1>';
  await env.ARTIFACTS.put(`${ART}/ver_vr1/index.html`, html1);
  await env.ARTIFACTS.put(`${ART}/ver_vr2/index.html`, html2);
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)')
      .bind(owner.id, owner.email, 'Alice', editor.id, editor.email, 'Bob', viewer.id, viewer.email, 'Carol'),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility) VALUES (?, ?, 'Demo', 'vr-demo', 'private')").bind(ART, owner.id),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_vr1', ?, ?, 'editor'), ('col_vr2', ?, ?, 'viewer')")
      .bind(ART, editor.email, ART, viewer.email),
    e.DB.prepare(`INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json, created_at, created_by, source)
      VALUES ('ver_vr1', ?, 1, 'index.html', '{}', '2026-01-01T00:00:00.000Z', ?, 'api'),
             ('ver_vr2', ?, 2, 'index.html', '{}', '2026-01-02T00:00:00.000Z', ?, 'editor')`).bind(ART, owner.id, ART, editor.id),
    e.DB.prepare(`INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256)
      VALUES ('ast_vr1', 'ver_vr1', 'index.html', ?, 'text/html', ?, 'h1'),
             ('ast_vr2', 'ver_vr2', 'index.html', ?, 'text/html', ?, 'h2')`).bind(`${ART}/ver_vr1/index.html`, html1.length, `${ART}/ver_vr2/index.html`, html2.length),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES ('dep_vr', ?, 'ver_vr2', 'production', 'vr-demo')").bind(ART),
  ]);
});

describe('version history', () => {
  it('lists versions with author, source, size and the live one', async () => {
    const res = await handleGetVersions(new Request('https://x'), e, viewer, ART);
    expect(res.status).toBe(200);
    const body = await res.json() as { versions: Array<Record<string, unknown>>; live_version_id: string };
    expect(body.live_version_id).toBe('ver_vr2');
    expect(body.versions[0]).toMatchObject({ version_no: 2, source: 'editor', created_by_email: 'bob@example.com', created_by_name: 'Bob', size_bytes: 12 });
    expect(body.versions[1]).toMatchObject({ version_no: 1, source: 'api', created_by_email: 'alice@example.com' });
  });

  it('serves one version source to a viewer', async () => {
    const res = await handleGetVersionSource(new Request('https://x'), e, viewer, ART, 1);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version_no: 1, content: '<h1>One</h1>', truncated: false });
    expect((await handleGetVersionSource(new Request('https://x'), e, viewer, ART, 9)).status).toBe(404);
  });

  it('refuses source and history to someone without access', async () => {
    const stranger: AuthUser = { id: 'usr_vr_none', email: 'dave@example.com', username: null };
    expect((await handleGetVersionSource(new Request('https://x'), e, stranger, ART, 1)).status).toBe(403);
    expect((await handleGetVersions(new Request('https://x'), e, stranger, ART)).status).toBe(403);
  });
});

describe('restore', () => {
  it('denies a viewer and changes nothing', async () => {
    const res = await handleRestoreVersion(req(), e, viewer, ART, 1);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'FORBIDDEN' });
    const n = await e.DB.prepare('SELECT COUNT(*) AS n FROM versions WHERE artifact_id = ?').bind(ART).first<{ n: number }>();
    expect(n?.n).toBe(2);
  });

  it('404s on a missing version and 400s on bad JSON', async () => {
    expect((await handleRestoreVersion(req(), e, editor, ART, 42)).status).toBe(404);
    const bad = await handleRestoreVersion(new Request('https://x', { method: 'POST', body: '{' }), e, editor, ART, 1);
    expect(bad.status).toBe(400);
  });

  it('lets an editor restore: a new live head version with the old content, history kept', async () => {
    const res = await handleRestoreVersion(req({ message: 'Back to the first draft' }), e, editor, ART, 1);
    expect(res.status).toBe(201);
    const out = await res.json() as { version_id: string; version_no: number; restored_from_version_no: number; staged: boolean };
    expect(out).toMatchObject({ version_no: 3, restored_from_version_no: 1, staged: false });

    const live = await e.DB.prepare("SELECT version_id FROM deployments WHERE artifact_id = ? AND channel = 'production'").bind(ART).first<{ version_id: string }>();
    expect(live?.version_id).toBe(out.version_id);

    const src = await handleGetVersionSource(new Request('https://x'), e, editor, ART, 3);
    expect(await src.json()).toMatchObject({ content: '<h1>One</h1>' });

    const list = await (await handleGetVersions(new Request('https://x'), e, owner, ART)).json() as { versions: Array<Record<string, unknown>> };
    expect(list.versions.map((v) => v.version_no)).toEqual([3, 2, 1]);
    expect(list.versions[0]).toMatchObject({ source: 'restore', created_by_email: 'bob@example.com', restored_from_version_no: 1, message: 'Back to the first draft' });
  });

  it('lets the owner restore too, numbering past the head', async () => {
    const res = await handleRestoreVersion(req(), e, owner, ART, 2);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ version_no: 4, restored_from_version_no: 2 });
  });
});
