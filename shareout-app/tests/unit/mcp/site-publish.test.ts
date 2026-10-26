// Multi-file sites over MCP against the real migrated schema and the real /v1/publish
// handler: publish_artifact / update_artifact `files` land as one version with every
// file, the result links each page, and REST's own path, size and quota rules apply.
// get_artifact reads every file back (flagging what did not fit), and update_artifact
// refuses writes that would lose work: a stale base_version or files left out.
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../../../src/api-auth';
import { generateToken, hashToken } from '../../../src/api-auth';
import { callTool } from '../../../src/mcp/tools';
import type { SourceFile } from '../../../src/mcp/page-source';
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

  it('update_artifact refuses files that leave some out; replace_all_files: true replaces the whole set', async () => {
    const files = [
      { path: 'index.html', content: '<!doctype html><h1>Acme manual v2</h1><a href="faq.html">FAQ</a>' },
      { path: 'faq.html', content: '<!doctype html><h1>FAQ</h1>' },
    ];
    const refused = await call(alice, 'update_artifact', { artifact_id: artifactId, files, message: 'Added the FAQ' });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toEqual({ code: 'WOULD_REMOVE_FILES', would_remove: ['about.html', 'css/site.css', 'guides/setup.html', 'img/dot.png'] });
    expect(refused.content[0].text).toContain('replace_all_files: true');
    expect(await versionsOf(artifactId)).toHaveLength(1);

    const r = await call(alice, 'update_artifact', { artifact_id: artifactId, files, message: 'Added the FAQ', replace_all_files: true });
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
    for (const path of ['../secret.html', '/etc/index.html', 'a/../index.html', 'guides//x.html', 'a\\b.html', 'page@x.html',
      '../logo.png', 'img/../../x.css', '/abs/a.css', 'img//a.png', 'img\\a.png', 'a\u0001b.png']) {
      const r = await call(alice, 'publish_artifact', { title: 'Bad', workspace_id: WS, files: [{ path: 'index.html', content: '<h1>x</h1>' }, { path, content: 'x' }] });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain('not a safe file path');
    }
    expect(await artifactCount()).toBe(before);
  });

  it('accepts asset names REST accepts (@ + , = ( )) but keeps pages strict', async () => {
    const r = await call(alice, 'publish_artifact', { title: 'Assets', workspace_id: WS, files: [
      { path: 'index.html', content: '<h1>x</h1>' },
      { path: 'img/logo@2x.png', content: SITE[4].content, encoding: 'base64' },
      { path: 'a+b.css', content: 'b{}' },
      { path: 'css/x,y=(1).css', content: 'i{}' },
    ] });
    expect(r.isError).toBeUndefined();
    const versions = await versionsOf(r.structuredContent!.artifact_id as string);
    expect((await assetsOf(versions[0].id)).map((a) => a.path)).toEqual(['a+b.css', 'css/x,y=(1).css', 'img/logo@2x.png', 'index.html']);
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

describe('reading a site back and changing it without losing files', () => {
  let id: string;
  const filesOf = async () => (await call(alice, 'get_artifact', { artifact_id: id, include_files: true })).structuredContent!.files as SourceFile[];
  const site = SITE.map((f) => f.path).sort();

  beforeAll(async () => {
    id = (await call(alice, 'publish_artifact', { title: 'Acme handbook', files: SITE, workspace_id: WS })).structuredContent!.artifact_id as string;
  });

  it('include_files returns every file whole, main file first, binary files as base64', async () => {
    const r = await call(alice, 'get_artifact', { artifact_id: id, include_files: true });
    expect(r.structuredContent).toMatchObject({ version: 1, entrypoint: 'index.html', truncated: false });
    const files = r.structuredContent!.files as SourceFile[];
    expect(files[0].path).toBe('index.html');
    expect(files.map((f) => f.path).sort()).toEqual(site);
    for (const f of SITE) {
      expect(files.find((x) => x.path === f.path)).toMatchObject({ content: f.content, encoding: f.encoding ?? 'utf8', truncated: false });
    }
    expect(r.content[0].text).toContain('Files of version 1: 5 files, main file index.html.');
    expect(r.content[0].text).toMatch(/=== img\/dot\.png \(image\/png, \d+ bytes, base64\) ===\niVBORw0KGgo/);
  });

  it('include_content alone names the other files, so a site is not taken for one page', async () => {
    const r = await call(alice, 'get_artifact', { artifact_id: id, include_content: true });
    expect(r.structuredContent).toMatchObject({
      version: 1, content: SITE[0].content, truncated: false, size_bytes: SITE[0].content.length,
      other_files: ['about.html', 'css/site.css', 'guides/setup.html', 'img/dot.png'],
    });
    expect(r.content[0].text).toContain('this page has 4 more files: about.html, css/site.css, guides/setup.html, img/dot.png');
  });

  it('refuses content alone on a site, and files that leave some out: nothing is saved', async () => {
    const one = await call(alice, 'update_artifact', { artifact_id: id, content: '<!doctype html><h1>Only this</h1>' });
    expect(one.isError).toBe(true);
    expect(one.structuredContent).toEqual({ code: 'WOULD_REMOVE_FILES', would_remove: ['about.html', 'css/site.css', 'guides/setup.html', 'img/dot.png'] });
    expect(one.content[0].text).toContain('content only replaces index.html');
    expect(one.content[0].text).not.toContain('report_problem');

    const some = await call(alice, 'update_artifact', { artifact_id: id, files: SITE.filter((f) => f.path !== 'css/site.css') });
    expect(some.isError).toBe(true);
    expect(some.structuredContent).toEqual({ code: 'WOULD_REMOVE_FILES', would_remove: ['css/site.css'] });
    expect(some.content[0].text).toContain('Only if the person wants that file gone, call again with replace_all_files: true.');
    expect(await versionsOf(id)).toHaveLength(1);
  });

  it('saves the whole set read back with include_files, from the version it was read at', async () => {
    const files = (await filesOf()).map(({ path, content, encoding }) => ({
      path, encoding, content: path === 'index.html' ? content!.replace('Acme manual', 'Acme handbook v2') : content,
    }));
    const r = await call(alice, 'update_artifact', { artifact_id: id, files, base_version: 1, message: 'Renamed the manual' });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain('Updated "Acme handbook" (version 2).');
    const after = await filesOf();
    expect(after.map((f) => f.path).sort()).toEqual(site);
    expect(after.find((f) => f.path === 'index.html')!.content).toContain('Acme handbook v2');
    expect(after.find((f) => f.path === 'img/dot.png')!.content).toBe(SITE[4].content);
  });

  it('refuses a write made from an older read, and a version that does not exist', async () => {
    const stale = await call(alice, 'update_artifact', { artifact_id: id, files: SITE, base_version: 1 });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent).toEqual({ code: 'VERSION_CONFLICT', base_version: 1 });
    expect(stale.content[0].text).toContain('the page changed after you read version 1 (alice saved a newer version at');
    expect(stale.content[0].text).not.toContain('report_problem');
    const unknown = await call(alice, 'update_artifact', { artifact_id: id, files: SITE, base_version: 9 });
    expect(unknown.content[0].text).toContain('this page has no version 9');
    expect(await versionsOf(id)).toHaveLength(2);
  });

  it('replace_all_files: true turns the site into one page when the person wants that', async () => {
    const r = await call(alice, 'update_artifact', { artifact_id: id, content: '<!doctype html><h1>One page now</h1>', base_version: 2, replace_all_files: true });
    expect(r.isError).toBeUndefined();
    const versions = await versionsOf(id);
    expect(versions).toHaveLength(3);
    expect(await assetsOf(versions[2].id)).toEqual([{ path: 'index.html', mime: 'text/html' }]);
  });

  it('content still replaces a one-file page, even under a new main file name', async () => {
    const note = (await call(alice, 'publish_artifact', { title: 'Acme notes', content: '# Notes', workspace_id: WS })).structuredContent!.artifact_id as string;
    const r = await call(alice, 'update_artifact', { artifact_id: note, content: '<!doctype html><h1>Notes</h1>', format: 'html', base_version: 1 });
    expect(r.isError).toBeUndefined();
    const versions = await versionsOf(note);
    expect(await assetsOf(versions[1].id)).toEqual([{ path: 'index.html', mime: 'text/html' }]);
  });

  it('reads the newest saved version when it is not live yet, and checks base_version against it', async () => {
    const page = (await call(alice, 'publish_artifact', { title: 'Acme staged', content: '<!doctype html><h1>One</h1>', workspace_id: WS })).structuredContent!.artifact_id as string;
    await call(alice, 'update_artifact', { artifact_id: page, content: '<!doctype html><h1>Two</h1>', base_version: 1 });
    const [v1] = await versionsOf(page);
    await e.DB.prepare("UPDATE deployments SET version_id = ? WHERE artifact_id = ? AND channel = 'production'").bind(v1.id, page).run();

    const r = await call(alice, 'get_artifact', { artifact_id: page, include_content: true });
    expect(r.structuredContent).toMatchObject({ version: 2, content: '<!doctype html><h1>Two</h1>' });
    expect(r.content[0].text).toContain('Content of version 2 (saved, not live yet: people still see version 1)');
    const stale = await call(alice, 'update_artifact', { artifact_id: page, content: '<!doctype html><h1>One, edited</h1>', base_version: 1 });
    expect(stale.structuredContent).toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});

describe('answers that do not fit say so', () => {
  it('include_content cuts a long main file at 512 KB and flags it; fetch flags it too', async () => {
    const content = `<!doctype html><p>${'x'.repeat(600_000)}</p>`;
    const page = (await call(alice, 'publish_artifact', { title: 'Acme long page', content, workspace_id: WS })).structuredContent!.artifact_id as string;
    const r = await call(alice, 'get_artifact', { artifact_id: page, include_content: true });
    expect(r.structuredContent).toMatchObject({ version: 1, truncated: true, size_bytes: content.length });
    expect(r.structuredContent!.content).toBe(content.slice(0, 512 * 1024));
    expect(r.content[0].text).toContain(`CUT: only the first ${512 * 1024} characters of this ${content.length}-byte file fit in one answer`);
    expect((await call(alice, 'fetch', { id: page })).structuredContent!.metadata).toMatchObject({ truncated: true });
  });

  it('include_files fits the smallest files whole, then cuts or leaves out the rest, flagging each', async () => {
    const files = [
      { path: 'index.html', content: '<!doctype html><h1>Data</h1>' },
      { path: 'img/dot.png', content: SITE[4].content, encoding: 'base64' },
      { path: 'a.css', content: 'a'.repeat(200_000) },
      { path: 'b.css', content: 'b'.repeat(250_000) },
      { path: 'img/big.png', content: 'A'.repeat(400_000), encoding: 'base64' },
      { path: 'data.json', content: `"${'d'.repeat(2_000_000)}"` },
    ];
    const page = (await call(alice, 'publish_artifact', { title: 'Acme data site', files, workspace_id: WS })).structuredContent!.artifact_id as string;
    const r = await call(alice, 'get_artifact', { artifact_id: page, include_files: true });
    const got = r.structuredContent!.files as SourceFile[];
    expect(got.map((f) => [f.path, f.truncated])).toEqual([
      ['index.html', false], ['img/dot.png', false], ['a.css', false], ['b.css', false], ['img/big.png', true], ['data.json', true],
    ]);
    expect(got[4].content).toBeUndefined();
    const used = got.slice(0, 4).reduce((n, f) => n + f.content!.length, 0);
    expect(got[5].content).toBe(`"${'d'.repeat(512 * 1024 - used - 1)}`);
    expect(r.structuredContent!.truncated).toBe(true);
    expect(r.content[0].text).toContain('Only 512 KB of file content fits in one answer. Cut: data.json. Not included: img/big.png.');
    expect(r.content[0].text).toContain('=== img/big.png (image/png, 300000 bytes, base64) (not included) ===');
  });
});
