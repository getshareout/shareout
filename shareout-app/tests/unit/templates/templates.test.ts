// Templates end to end against the real migrated schema, R2 and the per-artifact
// mini-store: save (preview, findings, redaction), scopes and cross-workspace isolation,
// install (links, multi-page, empty data from schema, nothing copied that should not
// be), the update flow, folder templates, and the provisioning hook.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { env as base } from 'cloudflare:workers';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';

const USERS: Record<string, AuthUser> = {
  so_alice: { id: 'usr_tpl_alice', email: 'alice@example.com', username: null },
  so_bob: { id: 'usr_tpl_bob', email: 'bob@example.com', username: null },
  so_admin: { id: 'usr_tpl_admin', email: 'admin@example.com', username: null },
  so_carol: { id: 'usr_tpl_carol', email: 'carol@example.com', username: null },
};
vi.mock('../../../src/api-auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  validateToken: vi.fn(async (req: Request) => USERS[(req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/, '')] ?? null),
}));

import { applyMigrations } from '../helpers/migrated-db';
import { routeTemplatesApi } from '../../../src/router/api/templates';
import { createFetchContext } from '../../../src/router/context';
import { publishArtifact } from '../../../src/publish/publish-artifact';
import { createMiniDb } from '../../../src/data/minidb-client';
import { writeDatasetRows } from '../../../src/data/datasets/handler';
import { installTemplateSet } from '../../../src/templates';

const e = { ...(base as unknown as Env), INSTANCE_ADMIN_EMAILS: 'admin@example.com', SHAREOUT_BASE_URL: 'https://shareout.test' } as Env;
const WS_A = 'wsp_tpl_a';
const WS_B = 'wsp_tpl_b';
const WS_C = 'wsp_tpl_c';
const SECRET_TOKEN = 'so_abcdefghijklmnopqrstuvwxyz0123456789';

async function api(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, any> }> {
  const req = new Request(`https://shareout.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await routeTemplatesApi(createFetchContext(req, e));
  if (!res) throw new Error(`unrouted ${path}`);
  const text = await res.text();
  let json: Record<string, any> = {};
  try { json = JSON.parse(text); } catch { json = { text }; }
  return { status: res.status, json };
}

async function liveText(artifactId: string, path: string): Promise<string> {
  const row = await e.DB.prepare(`SELECT s.r2_key FROM deployments d JOIN assets s ON s.version_id = d.version_id
    WHERE d.artifact_id = ? AND d.channel = 'production' AND s.path = ?`).bind(artifactId, path).first<{ r2_key: string }>();
  if (!row) throw new Error(`no ${path} on ${artifactId}`);
  return (await e.ARTIFACTS.get(row.r2_key))!.text();
}

async function allTemplateBytes(templateId: string): Promise<string> {
  const list = await e.ARTIFACTS.list({ prefix: `templates/${templateId}/` });
  const parts: string[] = [];
  for (const o of list.objects) parts.push(await (await e.ARTIFACTS.get(o.key))!.text());
  const rows = await e.DB.prepare('SELECT manifest_json FROM template_versions WHERE template_id = ?').bind(templateId).all<{ manifest_json: string }>();
  return parts.join('\n') + (rows.results || []).map((r) => r.manifest_json).join('\n');
}

let hubId = '';
let hubSlug = '';
let detailId = '';
let detailSlug = '';
let folderId = '';
let templateId = '';

const alice = USERS.so_alice;

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)').bind(
      'usr_tpl_alice', 'alice@example.com', 'Alice Smith', 'usr_tpl_bob', 'bob@example.com', 'Bob Jones',
      'usr_tpl_admin', 'admin@example.com', 'Ada Admin', 'usr_tpl_carol', 'carol@example.com', 'Carol Diaz'),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Northwind Traders', 'northwind', 'usr_tpl_alice'), (?, 'Beta Studio', 'beta-studio', 'usr_tpl_bob'), (?, 'Fresh Space', 'fresh-space', 'usr_tpl_admin')").bind(WS_A, WS_B, WS_C),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES
      ('wm_tpl_1', ?, 'usr_tpl_alice', 'owner'), ('wm_tpl_2', ?, 'usr_tpl_carol', 'member'),
      ('wm_tpl_3', ?, 'usr_tpl_bob', 'owner'), ('wm_tpl_4', ?, 'usr_tpl_admin', 'owner')`).bind(WS_A, WS_A, WS_B, WS_C),
  ]);
  folderId = 'fld_tpl_src';
  await e.DB.batch([
    e.DB.prepare("INSERT INTO folders (id, workspace_id, name, slug, readme, created_by) VALUES (?, ?, 'Sales kit', 'sales-kit', 'Start with the hub.', 'usr_tpl_alice')").bind(folderId, WS_A),
    e.DB.prepare("INSERT INTO folders (id, workspace_id, name, slug, parent_id, created_by) VALUES ('fld_tpl_sub', ?, 'Reports', 'reports', ?, 'usr_tpl_alice')").bind(WS_A, folderId),
  ]);

  const detail = await publishArtifact(e, alice, {
    name: 'Deal detail', slug: 'deal-detail', entrypoint: 'index.html',
    files: [{ path: 'index.html', content: '<!DOCTYPE html><html><body><h1>Deal</h1><a href="https://shareout.test/a/sales-hub/">Back</a></body></html>', mime: 'text/html' }],
    visibility: 'workspace', authMethod: 'google', shareWith: [], credentials: [], workspaceId: WS_A, folderId: 'fld_tpl_sub', artifactType: 'html',
  });
  detailId = detail.artifact.id;
  detailSlug = detail.deployment.slug;

  const hubHtml = (detailLink: string) => `<!DOCTYPE html><html><head><link rel="stylesheet" href="style.css"></head><body>
<h1>Northwind Traders pipeline</h1>
<p>Questions? jane.roe@acme-corp.com or +1 415-555-0132</p>
<a href="${detailLink}">Open a deal</a> <a href="about.html">About</a> <a href="/a/secret-roadmap/">Roadmap</a>
<script>const KEY = "${SECRET_TOKEN}"; ShareOut.table('deals');</script></body></html>`;
  const hub = await publishArtifact(e, alice, {
    name: 'Sales hub', slug: 'sales-hub', entrypoint: 'index.html',
    files: [
      { path: 'index.html', content: hubHtml(`/a/${detailSlug}/`), mime: 'text/html' },
      { path: 'about.html', content: '<!DOCTYPE html><html><body><a href="index.html">Home</a></body></html>', mime: 'text/html' },
      { path: 'style.css', content: 'body{color:#123}', mime: 'text/css' },
    ],
    visibility: 'workspace', authMethod: 'google', shareWith: [], credentials: [], workspaceId: WS_A, folderId, artifactType: 'html',
  });
  hubId = hub.artifact.id;
  hubSlug = hub.deployment.slug;

  // A page of the same workspace the template does NOT include.
  await publishArtifact(e, alice, {
    name: 'Secret roadmap', slug: 'secret-roadmap', entrypoint: 'index.html',
    files: [{ path: 'index.html', content: '<p>internal</p>', mime: 'text/html' }],
    visibility: 'private', authMethod: 'google', shareWith: [], credentials: [], workspaceId: WS_A, folderId: null, artifactType: 'html',
  });

  // Live data, config, a connector with credentials, a comment, Knowledge — none of which may travel.
  const db = createMiniDb(e, hubId, WS_A);
  await db.prepare("INSERT INTO artifact_json (id, artifact_id, key, value, size_bytes) VALUES ('j1', ?, 'counter', '{\"n\":42,\"who\":\"Big Deal Inc\"}', 10)").bind(hubId).run();
  await db.prepare("INSERT INTO artifact_json (id, artifact_id, key, value, size_bytes) VALUES ('j2', ?, '_comments_config', '{\"enabled\":true,\"identityMode\":\"named\"}', 10)").bind(hubId).run();
  await db.prepare("INSERT INTO artifact_tables (id, artifact_id, name, row_count) VALUES ('tbl_src', ?, 'deals', 2)").bind(hubId).run();
  await db.prepare(`INSERT INTO artifact_rows (id, table_id, data) VALUES
    ('row_1', 'tbl_src', '{"id":"row_1","client":"Big Deal Inc","amount":90000,"_owner":"carol@example.com","createdAt":"x","updatedAt":"x"}'),
    ('row_2', 'tbl_src', '{"id":"row_2","client":"Other Co","amount":12000,"stage":"won","createdAt":"x","updatedAt":"x"}')`).run();
  await writeDatasetRows(e, hubId, 'pipeline', 'csv', [{ region: 'North', revenue: 1234567 }, { region: 'South', revenue: 7654321 }]);
  await e.DB.prepare(`INSERT INTO connections (id, scope_type, scope_id, name, provider, config, encrypted_credentials, iv)
    VALUES ('con_tpl_1', 'artifact', ?, 'crm', 'postgres', '{"host":"db.internal.northwind"}', 'SECRETBLOB', 'IVIV')`).bind(hubId).run();
  await e.DB.prepare("INSERT INTO artifact_comments (id, artifact_id, author_name, content) VALUES ('cmt_tpl_1', ?, 'Carol', 'Confidential: price is too low')").bind(hubId).run();
  await e.DB.prepare("INSERT INTO workspace_files (workspace_id, namespace, path, content) VALUES (?, 'knowledge', 'topics/pricing.md', 'Knowledge: the floor price is 77k')").bind(WS_A).run();
}, 180_000);

describe('save as template', () => {
  it('previews what goes in and what stays behind, with findings and redactions', async () => {
    const { status, json } = await api('so_alice', 'POST', '/v1/artifact-templates/preview', { artifact_id: hubId });
    expect(status).toBe(200);
    expect(json.items).toHaveLength(1);
    expect(json.items[0].files.map((f: { path: string }) => f.path).sort()).toEqual(['about.html', 'index.html', 'style.css']);
    expect(json.items[0].tables).toEqual([{ name: 'deals', columns: ['client', 'amount', 'stage'], sample_rows: 0 }]);
    expect(json.items[0].datasets[0]).toMatchObject({ name: 'pipeline', columns: ['region', 'revenue'], sample_rows: 0 });
    expect(json.items[0].connectors).toEqual([{ name: 'crm', provider: 'postgres' }]);
    expect(json.excluded).toMatchObject({ comments: 1, store_keys: 1, table_rows: 2, dataset_rows: 2, knowledge: true, credentials: true });
    const kinds = json.findings.map((f: { kind: string }) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(['email', 'phone', 'workspace_name']));
    expect(json.redactions).toBeGreaterThanOrEqual(1);
    expect(json.removed_links).toBe(2);
    expect(json.setup.map((s: { kind: string }) => s.kind)).toEqual(['connector', 'table', 'dataset']);
  });

  it('refuses someone who cannot edit the page', async () => {
    const { status } = await api('so_bob', 'POST', '/v1/artifact-templates/preview', { artifact_id: hubId });
    expect(status).toBe(403);
  });

  it('asks the author to review findings, then saves on acknowledge', async () => {
    const first = await api('so_alice', 'POST', '/v1/artifact-templates', { artifact_id: hubId, name: 'Sales hub', tags: ['Sales', 'starter'] });
    expect(first.status).toBe(409);
    expect(first.json.code).toBe('REVIEW_REQUIRED');
    expect(first.json.findings.length).toBeGreaterThan(0);

    const saved = await api('so_alice', 'POST', '/v1/artifact-templates', { artifact_id: hubId, name: 'Sales hub', tags: ['Sales', 'starter'], acknowledge_findings: true });
    expect(saved.status).toBe(201);
    templateId = saved.json.template.id;
    expect(saved.json.template).toMatchObject({ scope: 'private', version_no: 1, version: '1.0.0', tags: ['sales', 'starter'], workspace_id: WS_A });
  });

  it('only instance admins publish to the instance library', async () => {
    const own = await api('so_alice', 'POST', '/v1/artifact-templates', { artifact_id: hubId, scope: 'instance', acknowledge_findings: true });
    expect(own.status).toBe(403);
    const patch = await api('so_alice', 'PATCH', `/v1/artifact-templates/${templateId}`, { scope: 'instance' });
    expect(patch.status).toBe(403);
  });

  it('never stores credentials, live data, comments or Knowledge in the template', async () => {
    const bytes = await allTemplateBytes(templateId);
    for (const leak of ['SECRETBLOB', 'db.internal.northwind', 'Big Deal Inc', '90000', '1234567', 'Confidential', 'floor price', SECRET_TOKEN, 'carol@example.com', 'secret-roadmap']) {
      expect(bytes, leak).not.toContain(leak);
    }
    expect(bytes).toContain('[REDACTED]');
  });
});

describe('cross-workspace isolation', () => {
  it('keeps a private template out of other workspaces', async () => {
    const list = await api('so_bob', 'GET', `/v1/artifact-templates?workspace=${WS_B}`);
    expect(list.status).toBe(200);
    expect(list.json.templates.map((t: { id: string }) => t.id)).not.toContain(templateId);
    expect((await api('so_bob', 'GET', `/v1/artifact-templates/${templateId}`)).status).toBe(404);
    expect((await api('so_bob', 'POST', `/v1/artifact-templates/${templateId}/install`, { workspace_id: WS_B })).status).toBe(404);
    // Listing a workspace you are not in is refused outright.
    expect((await api('so_bob', 'GET', `/v1/artifact-templates?workspace=${WS_A}`)).status).toBe(403);
  });

  it('lets a member of the home workspace see it', async () => {
    const list = await api('so_carol', 'GET', `/v1/artifact-templates?workspace=${WS_A}`);
    expect(list.json.templates.map((t: { id: string }) => t.id)).toContain(templateId);
  });

  it('refuses to share into a workspace the author is not in', async () => {
    const res = await api('so_alice', 'PATCH', `/v1/artifact-templates/${templateId}`, { scope: 'shared', shared_workspace_ids: [WS_B] });
    expect(res.status).toBe(403);
  });

  it('makes it visible everywhere once an admin moves it to the instance library', async () => {
    const res = await api('so_admin', 'PATCH', `/v1/artifact-templates/${templateId}`, { scope: 'instance' });
    expect(res.status).toBe(200);
    const list = await api('so_bob', 'GET', `/v1/artifact-templates?workspace=${WS_B}`);
    expect(list.json.templates.map((t: { id: string }) => t.id)).toContain(templateId);
  });
});

let installedHub = '';
let installedSlug = '';

describe('install', () => {
  it('installs into another workspace with links rewritten and no source data', async () => {
    const res = await api('so_bob', 'POST', `/v1/artifact-templates/${templateId}/install`, { workspace_id: WS_B });
    expect(res.status).toBe(201);
    expect(res.json.artifacts).toHaveLength(1);
    installedHub = res.json.artifacts[0].artifact_id;
    installedSlug = res.json.artifacts[0].slug;
    expect(installedHub).not.toBe(hubId);

    const art = await e.DB.prepare('SELECT workspace_id, owner_id FROM artifacts WHERE id = ?').bind(installedHub).first<{ workspace_id: string; owner_id: string }>();
    expect(art).toEqual({ workspace_id: WS_B, owner_id: 'usr_tpl_bob' });

    const index = await liveText(installedHub, 'index.html');
    expect(index).not.toContain(SECRET_TOKEN);
    expect(index).not.toContain('/a/secret-roadmap/');
    expect(index).toContain('href="about.html"');
    // The detail page was not in this template, so its link is a dead end, not a leak.
    expect(index).not.toContain(detailSlug);
    expect(await liveText(installedHub, 'about.html')).toContain('href="index.html"');
    expect(await liveText(installedHub, 'style.css')).toBe('body{color:#123}');

    // Data: empty table and dataset from the schema; config kept; store values reset.
    const db = createMiniDb(e, installedHub, WS_B);
    const tables = (await db.prepare('SELECT name, row_count FROM artifact_tables WHERE artifact_id = ?').bind(installedHub).all<{ name: string; row_count: number }>()).results;
    expect(tables).toEqual([{ name: 'deals', row_count: 0 }]);
    const keys = (await db.prepare('SELECT key FROM artifact_json WHERE artifact_id = ?').bind(installedHub).all<{ key: string }>()).results.map((r) => r.key);
    expect(keys).toEqual(['_comments_config']);
    const ds = await e.DB.prepare('SELECT r2_key, metadata FROM datasets WHERE artifact_id = ?').bind(installedHub).first<{ r2_key: string; metadata: string }>();
    expect(JSON.parse(ds!.metadata)).toEqual({ rowCount: 0, columns: ['region', 'revenue'] });
    expect(await (await e.ARTIFACTS.get(ds!.r2_key))!.text()).toBe('region,revenue\n');

    // Never copied: connectors, credentials, comments, Knowledge.
    expect((await e.DB.prepare("SELECT COUNT(*) AS n FROM connections WHERE scope_id = ?").bind(installedHub).first<{ n: number }>())!.n).toBe(0);
    expect((await e.DB.prepare('SELECT COUNT(*) AS n FROM artifact_comments WHERE artifact_id = ?').bind(installedHub).first<{ n: number }>())!.n).toBe(0);
    expect((await e.DB.prepare('SELECT COUNT(*) AS n FROM workspace_files WHERE workspace_id = ?').bind(WS_B).first<{ n: number }>())!.n).toBe(0);

    // Finish setup: the connector is a step, not a copied credential.
    const conn = res.json.setup.find((s: { step: { kind: string } }) => s.step.kind === 'connector');
    expect(conn).toMatchObject({ step: { name: 'crm', provider: 'postgres' }, done: false });

    const rec = await e.DB.prepare('SELECT template_id, version_no FROM template_installs WHERE artifact_id = ?').bind(installedHub).first();
    expect(rec).toEqual({ template_id: templateId, version_no: 1 });
  });

  it('a second install never overwrites the first', async () => {
    const res = await api('so_bob', 'POST', `/v1/artifact-templates/${templateId}/install`, { workspace_id: WS_B });
    expect(res.status).toBe(201);
    expect(res.json.artifacts[0].artifact_id).not.toBe(installedHub);
    expect(res.json.artifacts[0].slug).not.toBe(installedSlug);
  });

  it('refuses a workspace the installer is not a member of', async () => {
    expect((await api('so_bob', 'POST', `/v1/artifact-templates/${templateId}/install`, { workspace_id: WS_C })).status).toBe(403);
  });
});

describe('multi-artifact folder templates', () => {
  let folderTpl = '';
  it('saves a folder with its tree and rewrites links between its pages', async () => {
    const saved = await api('so_alice', 'POST', '/v1/artifact-templates', { folder_id: folderId, acknowledge_findings: true });
    expect(saved.status).toBe(201);
    folderTpl = saved.json.template.id;
    expect(saved.json.template.item_count).toBe(2);
    expect(saved.json.template.has_folders).toBe(true);

    const res = await api('so_alice', 'POST', `/v1/artifact-templates/${folderTpl}/install`, { workspace_id: WS_A });
    expect(res.status).toBe(201);
    const byName = Object.fromEntries(res.json.artifacts.map((a: { name: string }) => [a.name, a]));
    const newHub = byName['Sales hub'];
    const newDetail = byName['Deal detail'];
    expect(newHub.slug).not.toBe(hubSlug);
    expect(await liveText(newHub.artifact_id, 'index.html')).toContain(`href="/a/${newDetail.slug}/"`);
    expect(await liveText(newDetail.artifact_id, 'index.html')).toContain(`href="https://shareout.test/a/${newHub.slug}/"`);

    const root = await e.DB.prepare('SELECT id, name, readme, parent_id FROM folders WHERE id = ?').bind(res.json.folder_id).first<{ id: string; name: string; readme: string; parent_id: string | null }>();
    expect(root).toMatchObject({ name: 'Sales kit', readme: 'Start with the hub.', parent_id: null });
    const sub = await e.DB.prepare('SELECT f.name FROM artifacts a JOIN folders f ON f.id = a.folder_id WHERE a.id = ?').bind(newDetail.artifact_id).first<{ name: string }>();
    expect(sub?.name).toBe('Reports');
    const subParent = await e.DB.prepare('SELECT parent_id FROM folders f JOIN artifacts a ON a.folder_id = f.id WHERE a.id = ?').bind(newDetail.artifact_id).first<{ parent_id: string }>();
    expect(subParent?.parent_id).toBe(root!.id);
  });
});

describe('update flow', () => {
  it('shows update available after a new template version, and applies it non-destructively', async () => {
    const before = await api('so_bob', 'GET', `/v1/artifact-templates/installed?artifact_id=${installedHub}`);
    expect(before.json.installed).toMatchObject({ template_id: templateId, version_no: 1, update_available: false });

    await publishArtifact(e, alice, {
      name: 'Sales hub', slug: 'sales-hub', entrypoint: 'index.html',
      files: [
        { path: 'index.html', content: '<!DOCTYPE html><html><body><h1>Pipeline v2</h1><a href="about.html">About</a></body></html>', mime: 'text/html' },
        { path: 'about.html', content: '<!DOCTYPE html><html><body><a href="index.html">Home</a></body></html>', mime: 'text/html' },
      ],
      visibility: 'workspace', authMethod: 'google', shareWith: [], credentials: [], workspaceId: WS_A, folderId, artifactType: 'html',
    });
    // The instance library is admin-managed: the author can no longer cut versions there.
    expect((await api('so_alice', 'POST', `/v1/artifact-templates/${templateId}/versions`, { acknowledge_findings: true })).status).toBe(403);
    const v2 = await api('so_admin', 'POST', `/v1/artifact-templates/${templateId}/versions`, { artifact_id: hubId, acknowledge_findings: true, notes: 'New header' });
    expect(v2.status).toBe(403); // admin cannot snapshot a page they cannot edit
    await e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_tpl_admin', ?, 'admin@example.com', 'editor')").bind(hubId).run();
    const v2b = await api('so_admin', 'POST', `/v1/artifact-templates/${templateId}/versions`, { acknowledge_findings: true, notes: 'New header' });
    expect(v2b.status).toBe(201);
    expect(v2b.json.template).toMatchObject({ version_no: 2, version: '1.1.0' });

    const after = await api('so_bob', 'GET', `/v1/artifact-templates/installed?artifact_id=${installedHub}`);
    expect(after.json.installed).toMatchObject({ version_no: 1, latest_version_no: 2, update_available: true });

    const plan = await api('so_bob', 'POST', '/v1/artifact-templates/installed/update', { artifact_id: installedHub });
    expect(plan.json.applied).toBe(false);
    expect(plan.json.plan.changes[0]).toMatchObject({ change: 'update', files_changed: 1, files_removed: 1 });
    const versionsBefore = (await e.DB.prepare('SELECT COUNT(*) AS n FROM versions WHERE artifact_id = ?').bind(installedHub).first<{ n: number }>())!.n;

    expect((await api('so_carol', 'POST', '/v1/artifact-templates/installed/update', { artifact_id: installedHub, confirm: true })).status).toBe(403);

    const applied = await api('so_bob', 'POST', '/v1/artifact-templates/installed/update', { artifact_id: installedHub, confirm: true });
    expect(applied.status).toBe(200);
    expect(applied.json).toMatchObject({ applied: true, version_no: 2, updated: [installedHub] });
    expect(await liveText(installedHub, 'index.html')).toContain('Pipeline v2');
    const versions = (await e.DB.prepare('SELECT version_no, source FROM versions WHERE artifact_id = ? ORDER BY version_no').bind(installedHub).all<{ version_no: number; source: string }>()).results;
    expect(versions.length).toBe(versionsBefore + 1);
    expect(versions[versions.length - 1].source).toBe('template');
    const done = await api('so_bob', 'GET', `/v1/artifact-templates/installed?artifact_id=${installedHub}`);
    expect(done.json.installed).toMatchObject({ version_no: 2, update_available: false });
  });
});

describe('provisioning hook', () => {
  it('installs a template set by tag, and never a private template of another workspace', async () => {
    const priv = await api('so_alice', 'POST', '/v1/artifact-templates', { artifact_id: detailId, acknowledge_findings: true, tags: ['starter'] });
    expect(priv.status).toBe(201);
    const res = await installTemplateSet(e, USERS.so_admin, { workspaceId: WS_C, tag: 'starter', templateIds: [priv.json.template.id] });
    expect(res.installed.map((r) => r.template_id)).toEqual([templateId]);
    expect(res.failed).toEqual([{ template_id: priv.json.template.id, error: 'Template not found', code: 'NOT_FOUND' }]);
    const art = await e.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?').bind(res.installed[0].artifacts[0].artifact_id).first<{ workspace_id: string }>();
    expect(art?.workspace_id).toBe(WS_C);
  });
});

describe('preview page', () => {
  it('serves a sandboxed live look with a signed path, and nothing without it', async () => {
    const one = await api('so_bob', 'GET', `/v1/artifact-templates/${templateId}`);
    const url: string = one.json.template.preview_url;
    expect(url).toMatch(/\/view\/\d+\.[\w-]+\/a1\/$/);
    const ok = await routeTemplatesApi(createFetchContext(new Request(`https://shareout.test${url}about.html`), e));
    expect(ok!.status).toBe(200);
    expect(ok!.headers.get('Content-Security-Policy')).toBe('sandbox allow-scripts');
    const forged = url.replace(/\/view\/(\d+)\.[\w-]+\//, '/view/$1.forged/');
    expect((await routeTemplatesApi(createFetchContext(new Request(`https://shareout.test${forged}`), e)))!.status).toBe(404);
  });
});

describe('MCP tools reuse the same authz', () => {
  const tctx = (token: string) => ({ env: e, user: USERS[token], origin: 'https://shareout.test', authorization: `Bearer ${token}` });
  it('list_templates, install_template and save_as_template', async () => {
    const { callTool } = await import('../../../src/mcp/tools');
    const listed = await callTool(tctx('so_bob'), 'list_templates', { workspace_id: WS_B });
    expect(listed!.isError).toBeFalsy();
    expect(JSON.stringify(listed!.structuredContent)).toContain(templateId);

    const notMine = await callTool(tctx('so_bob'), 'list_templates', { workspace_id: WS_A });
    expect(notMine!.isError).toBe(true);

    const inst = await callTool(tctx('so_bob'), 'install_template', { template_id: templateId, workspace_id: WS_B });
    expect(inst!.isError).toBeFalsy();
    expect(inst!.content[0].text).toContain('Finish setup');

    const pii = await publishArtifact(e, alice, {
      name: 'Contact', slug: 'contact', entrypoint: 'index.html',
      files: [{ path: 'index.html', content: '<p>Write to maria.lopez@cliente.com</p>', mime: 'text/html' }],
      visibility: 'workspace', authMethod: 'google', shareWith: [], credentials: [], workspaceId: WS_A, folderId: null, artifactType: 'html',
    });
    const review = await callTool(tctx('so_alice'), 'save_as_template', { artifact_id: pii.artifact.id });
    expect(review!.structuredContent).toMatchObject({ review_required: true });
    const denied = await callTool(tctx('so_alice'), 'save_as_template', { artifact_id: hubId, scope: 'instance', acknowledge_findings: true });
    expect(denied!.isError).toBe(true);
    const stranger = await callTool(tctx('so_bob'), 'save_as_template', { artifact_id: hubId, acknowledge_findings: true });
    expect(stranger!.isError).toBe(true);
  }, 60_000);
});
