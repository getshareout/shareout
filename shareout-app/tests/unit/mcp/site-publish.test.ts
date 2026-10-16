// Multi-file sites over MCP against the real migrated schema and the real /v1/publish
// handler: publish_artifact / update_artifact `files` land as one version with every
// file, the result links each page, and REST's own path, size and quota rules apply.
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../../../src/api-auth';
import { generateToken, hashToken } from '../../../src/api-auth';
import { callTool } from '../../../src/mcp/tools';
import type { Env } from '../../../src/types';
import { applyMigrations, e } from '../helpers/migrated-db';

const WS = 'wsp_mcpsite';
const u = (id: string, email: string): AuthUser => ({ id, email, username: null });
const alice = u('usr_mcpsite_alice', 'alice@example.com'); // workspace owner
const carol = u('usr_mcpsite_carol', 'carol@example.com'); // viewer collaborator
const erin = u('usr_mcpsite_erin', 'erin@example.com');    // stranger
const tokens = new Map<string, string>();

const ctx = (user: AuthUser, env: Env = e) => ({ env, user, origin: 'https://shareout.test', authorization: `Bearer ${tokens.get(user.id)}` });
const call = (user: AuthUser, name: string, args: Record<string, unknown>, env?: Env) => callTool(ctx(user, env), name, args).then((r) => r!);

const SITE = [
  { path: 'index.html', content: '<!doctype html><h1>Acme manual</h1><a href="guides/setup.html">Setup</a>' },
  { path: 'guides/setup.html', content: '<!doctype html><h1>Setup</h1><a href="../index.html">Home</a>' },
  { path: 'about.html', content: '<!doctype html><h1>About</h1>' },
  { path: 'css/site.css', content: 'body{font-family:sans-serif}' },
  { path: 'img/dot.png', content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', encoding: 'base64' },
];

const versionsOf = async (artifactId: string) =>
  (await e.DB.prepare('SELECT id, version_no FROM versions WHERE artifact_id = ? ORDER BY version_no').bind(artifactId).all<{ id: string; version_no: number }>()).results;
const assetsOf = async (versionId: string) =>
  (await e.DB.prepare('SELECT path, mime FROM assets WHERE version_id = ? ORDER BY path').bind(versionId).all<{ path: string; mime: string }>()).results;
const artifactCount = async () => (await e.DB.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE owner_id = ?').bind(alice.id).first<{ n: number }>())!.n;

beforeAll(async () => {
  await applyMigrations();
  for (const x of [alice, carol, erin]) {
    const token = generateToken();
    tokens.set(x.id, token);
    await e.DB.batch([
      e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(x.id, x.email, x.email!.split('@')[0]),
      e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES (?, 'user', ?, ?, ?, 'mcp:Claude')")
        .bind(`tok_${x.id}`, x.id, x.id, await hashToken(token)),
    ]);
  }
  await e.DB.batch([
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Acme', 'acme-mcpsite', ?)").bind(WS, alice.id),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_mcpsite1', ?, ?, 'owner', 'internal')").bind(WS, alice.id),
  ]);
});

describe('publish_artifact with files', () => {
  let artifactId: string;

  it('creates one version holding every file, and links each page', async () => {
    const r = await call(alice, 'publish_artifact', { title: 'Acme manual', files: SITE, workspace_id: WS, message: 'First cut' });
    expect(r.isError).toBeUndefined();
    artifactId = r.structuredContent!.artifact_id as string;
    const versions = await versionsOf(artifactId);
    expect(versions).toHaveLength(1);
    expect(await assetsOf(versions[0].id)).toEqual([
      { path: 'about.html', mime: 'text/html' },
      { path: 'css/site.css', mime: 'text/css' },
      { path: 'guides/setup.html', mime: 'text/html' },
      { path: 'img/dot.png', mime: 'image/png' },
      { path: 'index.html', mime: 'text/html' },
    ]);
    const url = r.structuredContent!.url as string;
    expect(r.structuredContent!.pages).toEqual([
      { path: 'index.html', url: `${url}?page=index.html` },
      { path: 'about.html', url: `${url}?page=about.html` },
      { path: 'guides/setup.html', url: `${url}?page=guides/setup.html` },
    ]);
    expect(r.content[0].text).toContain(`Pages (3): ${url}?page=index.html, ${url}?page=about.html, ${url}?page=guides/setup.html`);
    const v = await e.DB.prepare('SELECT message FROM versions WHERE id = ?').bind(versions[0].id).first<{ message: string }>();
    expect(v!.message).toBe('First cut');
  });

  it('get_artifact lists the same pages', async () => {
    const r = await call(alice, 'get_artifact', { artifact_id: artifactId });
    expect(r.structuredContent!.artifact).toMatchObject({ entrypoint: 'index.html', pages: ['index.html', 'about.html', 'guides/setup.html'] });
  });

  it('update_artifact with files replaces the whole file set in a new version', async () => {
    const r = await call(alice, 'update_artifact', {
      artifact_id: artifactId,
      files: [
        { path: 'index.html', content: '<!doctype html><h1>Acme manual v2</h1><a href="faq.html">FAQ</a>' },
        { path: 'faq.html', content: '<!doctype html><h1>FAQ</h1>' },
      ],
      message: 'Added the FAQ',
    });
    expect(r.isError).toBeUndefined();
    const versions = await versionsOf(artifactId);
    expect(versions.map((v) => v.version_no)).toEqual([1, 2]);
    expect((await assetsOf(versions[1].id)).map((a) => a.path)).toEqual(['faq.html', 'index.html']);
    expect((r.structuredContent!.pages as Array<{ path: string }>).map((p) => p.path)).toEqual(['index.html', 'faq.html']);
  });

  it('a viewer or a stranger cannot update it: no new version', async () => {
    await e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_mcpsite1', ?, ?, 'viewer')").bind(artifactId, carol.email).run();
    for (const who of [carol, erin]) {
      const r = await call(who, 'update_artifact', { artifact_id: artifactId, files: [{ path: 'index.html', content: '<h1>hijack</h1>' }] });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain('cannot edit');
    }
    expect(await versionsOf(artifactId)).toHaveLength(2);
  });
});

describe('what gets refused before anything is stored', () => {
  it('rejects traversal, absolute and odd paths', async () => {
    const before = await artifactCount();
    for (const path of ['../secret.html', '/etc/index.html', 'a/../index.html', 'guides//x.html', 'a\\b.html']) {
      const r = await call(alice, 'publish_artifact', { title: 'Bad', workspace_id: WS, files: [{ path: 'index.html', content: '<h1>x</h1>' }, { path, content: 'x' }] });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain('not a safe file path');
    }
    expect(await artifactCount()).toBe(before);
  });

  it('applies the REST validator: entrypoint, mime allow-list and duplicate paths', async () => {
    const noIndex = await call(alice, 'publish_artifact', { title: 'No index', workspace_id: WS, files: [{ path: 'a.html', content: '<h1>a</h1>' }, { path: 'b.html', content: '<h1>b</h1>' }] });
    expect(noIndex.content[0].text).toContain('entrypoint "index.html" not found');
    const exe = await call(alice, 'publish_artifact', { title: 'Exe', workspace_id: WS, files: [{ path: 'index.html', content: '<h1>x</h1>' }, { path: 'tool.exe', content: 'AA==', encoding: 'base64' }] });
    expect(exe.content[0].text).toContain('not allowed for tool.exe');
    const dup = await call(alice, 'publish_artifact', { title: 'Dup', workspace_id: WS, files: [{ path: 'index.html', content: '<h1>x</h1>' }, { path: 'index.html', content: '<h1>y</h1>' }] });
    expect(dup.content[0].text).toContain('duplicate path: index.html');
  });

  it('applies the same storage quota as REST', async () => {
    const before = await artifactCount();
    const capped = { ...e, STORAGE_QUOTA_BYTES: '100' } as Env;
    const r = await call(alice, 'publish_artifact', { title: 'Big', workspace_id: WS, files: SITE }, capped);
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ status: 413, code: 'STORAGE_LIMIT_EXCEEDED' });
    expect(await artifactCount()).toBe(before);
  });

  it('wants content or files, not both', async () => {
    const both = await call(alice, 'publish_artifact', { title: 'Both', workspace_id: WS, content: '<h1>x</h1>', files: SITE });
    expect(both.content[0].text).toContain('not both');
    const neither = await call(alice, 'publish_artifact', { title: 'Neither', workspace_id: WS });
    expect(neither.isError).toBe(true);
  });
});

describe('single-file publish', () => {
  it('still publishes one page from content, without a pages list', async () => {
    const r = await call(alice, 'publish_artifact', { title: 'Acme one-pager', content: '<!doctype html><h1>Hello</h1>', workspace_id: WS });
    expect(r.isError).toBeUndefined();
    const versions = await versionsOf(r.structuredContent!.artifact_id as string);
    expect(await assetsOf(versions[0].id)).toEqual([{ path: 'index.html', mime: 'text/html' }]);
    expect(r.structuredContent).not.toHaveProperty('pages');
    expect(r.content[0].text).not.toContain('Pages (');
  });
});
