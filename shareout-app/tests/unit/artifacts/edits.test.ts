// Edit ops against the real migrated schema, R2 and publish pipeline: POST
// /v1/artifacts/{id}/edits and MCP read_artifact / edit_artifact. Unchanged files keep
// their R2 objects, a failing op or a stale base writes nothing, replacement is literal,
// and each edit counts once against the daily publish limit.
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../../../src/api-auth';
import { generateToken, hashToken } from '../../../src/api-auth';
import { handleEditArtifact } from '../../../src/artifacts/edits';
import { handleFetch } from '../../../src/router/handle-fetch';
import { handleMcp } from '../../../src/mcp/server';
import { callTool } from '../../../src/mcp/tools';
import type { Env } from '../../../src/types';
import { applyMigrations, e } from '../helpers/migrated-db';

const WS = 'wsp_edits';
const u = (id: string, email: string): AuthUser => ({ id, email, username: null });
const alice = u('usr_edits_alice', 'alice@example.com');
const carol = u('usr_edits_carol', 'carol@example.com'); // viewer collaborator
const tokens = new Map<string, string>();
const ctx = (user: AuthUser, env: Env = e) => ({ env, user, origin: 'https://shareout.test', authorization: `Bearer ${tokens.get(user.id)}` });
const call = (user: AuthUser, name: string, args: Record<string, unknown>, env?: Env) => callTool(ctx(user, env), name, args).then((r) => r!);

/** The env with R2 puts recorded. */
function counting(): { env: Env; puts: string[] } {
  const puts: string[] = [];
  const bucket = e.ARTIFACTS;
  const ARTIFACTS = new Proxy(bucket, {
    get(target, key) {
      if (key === 'put') return (k: string, ...rest: unknown[]) => { puts.push(k); return (target.put as (...a: unknown[]) => unknown)(k, ...rest); };
      const v = Reflect.get(target, key);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return { env: { ...e, ARTIFACTS } as Env, puts };
}

const edit = (env: Env, user: AuthUser, id: string, body: unknown) =>
  handleEditArtifact(new Request(`https://shareout.test/v1/artifacts/${id}/edits`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), env, user, id);

const versions = async (id: string) =>
  (await e.DB.prepare('SELECT id, version_no, entrypoint FROM versions WHERE artifact_id = ? ORDER BY version_no').bind(id).all<{ id: string; version_no: number; entrypoint: string }>()).results;
const assets = async (versionId: string) =>
  (await e.DB.prepare('SELECT path, r2_key, mime, size_bytes, sha256 FROM assets WHERE version_id = ? ORDER BY path').bind(versionId).all<{ path: string; r2_key: string; mime: string; size_bytes: number; sha256: string }>()).results;
const stored = async (versionId: string, path: string) => {
  const a = (await assets(versionId)).find((x) => x.path === path)!;
  return (await e.ARTIFACTS.get(a.r2_key))!.text();
};
const publishes = async () =>
  (await e.DB.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM rate_limits WHERE principal_id = ? AND action = 'publish'").bind(alice.id).first<{ n: number }>())!.n;

async function site(title: string, files: Array<{ path: string; content: string }>): Promise<string> {
  const r = await call(alice, 'publish_artifact', { title, files, workspace_id: WS });
  expect(r.isError, r.content[0].text).toBeUndefined();
  return r.structuredContent!.artifact_id as string;
}

const THREE = [
  { path: 'index.html', content: '<!doctype html><link rel="stylesheet" href="styles.css"><h1>Price: $5</h1><script src="app.js"></script>' },
  { path: 'styles.css', content: 'h1 { color: red; }\nbody { margin: 0; }\n' },
  { path: 'app.js', content: 'console.log("hi");\n' },
];

beforeAll(async () => {
  await applyMigrations();
  for (const x of [alice, carol]) {
    const token = generateToken();
    tokens.set(x.id, token);
    await e.DB.batch([
      e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(x.id, x.email, x.email!.split('@')[0]),
      e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES (?, 'user', ?, ?, ?, 'mcp:Claude')")
        .bind(`tok_${x.id}`, x.id, x.id, await hashToken(token)),
    ]);
  }
  await e.DB.batch([
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Edits', 'edits-ws', ?)").bind(WS, alice.id),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_edits1', ?, ?, 'owner', 'internal')").bind(WS, alice.id),
  ]);
});

describe('POST /v1/artifacts/{id}/edits', () => {
  let id: string;

  it('replaces text in styles.css as v+1, uploading only that file', async () => {
    id = await site('Edit site', THREE);
    const [v1] = await versions(id);
    const before = await publishes();
    const { env, puts } = counting();

    const res = await edit(env, alice, id, { base_version: 1, message: 'Blue headings', ops: [{ op: 'replace', path: 'styles.css', old: 'color: red', new: 'color: blue' }] });
    const body = await res.json() as Record<string, unknown>;
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({ base_version: 1, version: { version_no: 2 }, changes: [{ path: 'styles.css', change: 'modified', replacements: 1 }] });

    const [, v2] = await versions(id);
    expect(puts).toEqual([`${id}/v2/styles.css`]);
    const a1 = await assets(v1.id);
    const a2 = await assets(v2.id);
    expect(a2.map((a) => a.path)).toEqual(['app.js', 'index.html', 'styles.css']);
    for (const p of ['app.js', 'index.html']) {
      expect(a2.find((a) => a.path === p)).toEqual(a1.find((a) => a.path === p));
    }
    expect(await stored(v2.id, 'styles.css')).toBe('h1 { color: blue; }\nbody { margin: 0; }\n');
    expect(v2.entrypoint).toBe('index.html');
    const msg = await e.DB.prepare('SELECT message FROM versions WHERE id = ?').bind(v2.id).first<{ message: string }>();
    expect(msg!.message).toBe('Blue headings');
    const live = await e.DB.prepare("SELECT version_id FROM deployments WHERE artifact_id = ? AND channel = 'production'").bind(id).first<{ version_id: string }>();
    expect(live!.version_id).toBe(v2.id);
    expect(await publishes()).toBe(before + 1);
  });

  it('refuses a stale base_version with 409 and the current version', async () => {
    const before = await publishes();
    const res = await edit(e, alice, id, { base_version: 1, ops: [{ op: 'replace', path: 'app.js', old: 'hi', new: 'yo' }] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'VERSION_CONFLICT', base_version: 1, current_version: 2 });
    expect(await versions(id)).toHaveLength(2);
    expect(await publishes()).toBe(before);
  });

  it('writes nothing when a later op fails', async () => {
    const { env, puts } = counting();
    const res = await edit(env, alice, id, { base_version: 2, ops: [
      { op: 'replace', path: 'app.js', old: 'hi', new: 'yo' },
      { op: 'replace', path: 'styles.css', old: 'color: green', new: 'color: pink' },
    ] });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'EDIT_NO_MATCH', op_index: 1, path: 'styles.css', nearest: { line: 1, text: 'h1 { color: blue; }' } });
    expect(puts).toEqual([]);
    expect(await versions(id)).toHaveLength(2);
  });

  it('says where an ambiguous old matches', async () => {
    const res = await edit(e, alice, id, { base_version: 2, ops: [{ op: 'replace', path: 'styles.css', old: ' {', new: '{' }] });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'EDIT_AMBIGUOUS', lines: [1, 2] });
  });

  it('keeps $& and $$ literal', async () => {
    const res = await edit(e, alice, id, { base_version: 2, ops: [{ op: 'replace', path: 'index.html', old: 'Price: $5', new: 'Price: $& / $$10' }] });
    expect(res.status).toBe(201);
    const [, , v3] = await versions(id);
    expect(await stored(v3.id, 'index.html')).toContain('<h1>Price: $& / $$10</h1>');
  });

  it('dry_run reports the changes and saves nothing', async () => {
    const before = await publishes();
    const res = await edit(e, alice, id, { base_version: 3, dry_run: true, ops: [
      { op: 'rename', from: 'app.js', to: 'js/app.js' },
      { op: 'replace', path: 'index.html', old: 'src="app.js"', new: 'src="js/app.js"' },
      { op: 'write', path: 'notes.md', content: '# Notes' },
    ] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dry_run: true, would_create_version: 4, changes: [
      { path: 'index.html', change: 'modified', replacements: 1 },
      { path: 'js/app.js', change: 'renamed', from: 'app.js' },
      { path: 'notes.md', change: 'added', size_after: 7 },
    ] });
    expect(await versions(id)).toHaveLength(3);
    expect(await publishes()).toBe(before);
  });

  it('a rename moves the file without re-uploading it', async () => {
    const { env, puts } = counting();
    const res = await edit(env, alice, id, { base_version: 3, ops: [{ op: 'rename', from: 'app.js', to: 'js/app.js' }, { op: 'delete', path: 'styles.css' }] });
    expect(res.status).toBe(201);
    expect(puts).toEqual([]);
    const all = await versions(id);
    const a3 = await assets(all[2].id);
    const a4 = await assets(all[3].id);
    expect(a4.map((a) => a.path)).toEqual(['index.html', 'js/app.js']);
    expect(a4.find((a) => a.path === 'js/app.js')!.r2_key).toBe(a3.find((a) => a.path === 'app.js')!.r2_key);
  });

  it('an edit that changes nothing creates no version', async () => {
    const res = await edit(e, alice, id, { base_version: 4, ops: [{ op: 'replace', path: 'js/app.js', old: 'hi', new: 'hi' }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ unchanged: true });
    expect(await versions(id)).toHaveLength(4);
  });

  it('keeps CRLF line endings and multi-byte text intact', async () => {
    const crlf = await site('Crlf page', [{ path: 'index.html', content: '<p>café</p>\r\n<p>one</p>\r\n<p>two 🎉</p>\r\n' }]);
    const res = await edit(e, alice, crlf, { base_version: 1, ops: [{ op: 'replace', path: 'index.html', old: '<p>one</p>\n<p>two 🎉</p>', new: '<p>uno</p>\n<p>dos 🚀</p>' }] });
    expect(res.status).toBe(201);
    const [, v2] = await versions(crlf);
    expect(await stored(v2.id, 'index.html')).toBe('<p>café</p>\r\n<p>uno</p>\r\n<p>dos 🚀</p>\r\n');
    const a = (await assets(v2.id))[0];
    expect(a.size_bytes).toBe(new TextEncoder().encode('<p>café</p>\r\n<p>uno</p>\r\n<p>dos 🚀</p>\r\n').length);
  });

  it('refuses viewers and malformed requests', async () => {
    await e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_edits1', ?, ?, 'viewer')").bind(id, carol.email).run();
    expect((await edit(e, carol, id, { base_version: 4, ops: [{ op: 'delete', path: 'js/app.js' }] })).status).toBe(403);
    expect((await edit(e, alice, id, { ops: [{ op: 'delete', path: 'js/app.js' }] })).status).toBe(400);
    expect((await edit(e, alice, id, { base_version: 4, ops: [{ op: 'write', path: '../x.html', content: 'x' }] })).status).toBe(400);
    expect((await edit(e, alice, id, { base_version: 4, ops: [{ op: 'delete', path: 'index.html' }] })).status).toBe(422);
  });
});

describe('MCP read_artifact / edit_artifact', () => {
  it('lists files, pages through a 200 KB file losslessly, and edits it', async () => {
    const row = (i: number) => `<tr><td>${i}</td><td>Ünïcödé 🎉 row</td></tr>\n`;
    const big = `<!doctype html><table>\n${Array.from({ length: 5000 }, (_, i) => row(i)).join('')}</table>\n`;
    expect(big.length).toBeGreaterThan(200_000);
    const id = await site('Big table', [{ path: 'index.html', content: big }, { path: 'site.css', content: 'td{padding:2px}' }]);

    const list = await call(alice, 'read_artifact', { artifact_id: id });
    expect(list.isError).toBeUndefined();
    expect(list.structuredContent).toMatchObject({ version: 1, entrypoint: 'index.html', files: [{ path: 'index.html' }, { path: 'site.css', size_bytes: 15 }] });

    let text = '';
    let offset: number | null = 0;
    let calls = 0;
    while (offset !== null) {
      const page = await call(alice, 'read_artifact', { artifact_id: id, path: 'index.html', offset, max_chars: 60_000 });
      expect(page.isError).toBeUndefined();
      text += page.structuredContent!.content as string;
      offset = page.structuredContent!.next_offset as number | null;
      calls++;
    }
    expect(calls).toBeGreaterThan(3);
    expect(text).toBe(big);

    const done = await call(alice, 'edit_artifact', { artifact_id: id, base_version: 1, message: 'Fix row 4321', ops: [
      { op: 'replace', path: 'index.html', old: '<td>4321</td>', new: '<td>4321 (fixed)</td>' },
    ] });
    expect(done.isError, done.content[0].text).toBeUndefined();
    expect(done.structuredContent).toMatchObject({ version: 2, base_version: 1, changes: [{ path: 'index.html', change: 'modified', replacements: 1 }] });
    expect(done.content[0].text).toContain('Link: ');

    const stale = await call(alice, 'edit_artifact', { artifact_id: id, base_version: 1, ops: [{ op: 'delete', path: 'site.css' }] });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent).toMatchObject({ status: 409, code: 'VERSION_CONFLICT', current_version: 2 });
    expect(stale.content[0].text).toContain('base_version 2');

    const miss = await call(alice, 'edit_artifact', { artifact_id: id, base_version: 2, ops: [{ op: 'replace', path: 'site.css', old: 'margin', new: 'x' }] });
    expect(miss.structuredContent).toMatchObject({ code: 'EDIT_NO_MATCH', op_index: 0 });
  });

  it('viewers can read but not edit', async () => {
    const id = await site('Shared page', [{ path: 'index.html', content: '<p>hello</p>' }]);
    await e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_edits2', ?, ?, 'viewer')").bind(id, carol.email).run();
    const read = await call(carol, 'read_artifact', { artifact_id: id, path: 'index.html' });
    expect(read.structuredContent).toMatchObject({ content: '<p>hello</p>', next_offset: null });
    const denied = await call(carol, 'edit_artifact', { artifact_id: id, base_version: 1, ops: [{ op: 'write', path: 'index.html', content: '<p>bye</p>' }] });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('workspace Agent tokens (sot_)', () => {
  const AGENT = 'usr_edits_agent';
  const OTHER_WS = 'wsp_edits_other';
  const TOK = { publish: 'sot_' + '5'.repeat(64), read: 'sot_' + '6'.repeat(64), other: 'sot_' + '7'.repeat(64) };
  const rest = (token: string, method: string, path: string, body?: unknown) =>
    handleFetch(new Request(`https://shareout.test${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), e);
  const rpc = async (token: string, method: string, params: Record<string, unknown> = {}) => {
    const res = await handleMcp(new Request('https://shareout.test/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }), e, 'https://shareout.test');
    return (await res.json() as { result: Record<string, unknown> }).result;
  };
  let id: string;

  beforeAll(async () => {
    await e.DB.batch([
      e.DB.prepare("INSERT INTO users (id, email, name, is_service) VALUES (?, NULL, 'agent', 1)").bind(AGENT),
      e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Other', 'edits-other', ?)").bind(OTHER_WS, alice.id),
      e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_edits_ag', ?, ?, 'member', 'internal')").bind(WS, AGENT),
      e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, scopes) VALUES ('sot_edits_p', 'workspace', ?, ?, ?, 'artifacts:read,artifacts:publish')")
        .bind(WS, AGENT, await hashToken(TOK.publish)),
      e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, scopes) VALUES ('sot_edits_r', 'workspace', ?, ?, ?, 'artifacts:read')")
        .bind(WS, AGENT, await hashToken(TOK.read)),
      e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, scopes) VALUES ('sot_edits_o', 'workspace', ?, ?, ?, 'artifacts:read,artifacts:publish')")
        .bind(OTHER_WS, AGENT, await hashToken(TOK.other)),
    ]);
    const res = await rest(TOK.publish, 'POST', '/v1/publish', {
      name: 'Agent page', workspace_id: WS, visibility: 'workspace',
      files: [{ path: 'index.html', content: '<h1>v1</h1>', mime: 'text/html' }, { path: 'a.css', content: 'h1{}', mime: 'text/css' }],
    });
    expect(res.status).toBe(201);
    id = ((await res.json()) as { artifact: { id: string } }).artifact.id;
  });

  it('edits over REST with artifacts:publish, in its own workspace', async () => {
    const manifest = await rest(TOK.publish, 'GET', `/v1/artifacts/${id}/files?manifest=1`);
    expect(await manifest.json()).toMatchObject({ version_no: 1, live_version: 1, newest_version: 1 });
    const res = await rest(TOK.publish, 'POST', `/v1/artifacts/${id}/edits`, { base_version: 1, ops: [{ op: 'replace', path: 'index.html', old: 'v1', new: 'v2' }] });
    expect(res.status).toBe(201);
    const v = await e.DB.prepare('SELECT source FROM versions WHERE artifact_id = ? AND version_no = 2').bind(id).first<{ source: string }>();
    expect(v!.source).toBe('agent');
  });

  it('is refused without artifacts:publish, and from another workspace', async () => {
    const noScope = await rest(TOK.read, 'POST', `/v1/artifacts/${id}/edits`, { base_version: 2, ops: [{ op: 'delete', path: 'a.css' }] });
    expect(noScope.status).toBe(403);
    expect(await noScope.json()).toMatchObject({ code: 'INSUFFICIENT_SCOPE' });
    const elsewhere = await rest(TOK.other, 'POST', `/v1/artifacts/${id}/edits`, { base_version: 2, ops: [{ op: 'delete', path: 'a.css' }] });
    expect(elsewhere.status).toBe(403);
    expect(await versions(id)).toHaveLength(2);
  });

  it('reaches only read_artifact and edit_artifact over MCP, with the same scope rules', async () => {
    const list = await rpc(TOK.publish, 'tools/list');
    expect((list.tools as Array<{ name: string }>).map((t) => t.name).sort()).toEqual(['edit_artifact', 'read_artifact']);

    const read = await rpc(TOK.publish, 'tools/call', { name: 'read_artifact', arguments: { artifact_id: id } });
    expect(read.isError).toBeUndefined();
    expect(read.structuredContent).toMatchObject({ version: 2, live_version: 2, newest_version: 2 });

    const edited = await rpc(TOK.publish, 'tools/call', { name: 'edit_artifact', arguments: { artifact_id: id, base_version: 2, ops: [{ op: 'replace', path: 'a.css', old: 'h1{}', new: 'h1{color:red}' }] } });
    expect(edited.isError, JSON.stringify(edited)).toBeUndefined();
    expect(edited.structuredContent).toMatchObject({ version: 3 });

    const refused = await rpc(TOK.read, 'tools/call', { name: 'edit_artifact', arguments: { artifact_id: id, base_version: 3, ops: [{ op: 'delete', path: 'a.css' }] } });
    expect(refused).toMatchObject({ isError: true, structuredContent: { code: 'INSUFFICIENT_SCOPE' } });
    const otherWs = await rpc(TOK.other, 'tools/call', { name: 'read_artifact', arguments: { artifact_id: id } });
    expect(otherWs.isError).toBe(true);
    const publish = await rpc(TOK.publish, 'tools/call', { name: 'publish_artifact', arguments: { title: 'x', content: '<p>x</p>' } });
    expect(publish.isError).toBe(true);
    expect(await versions(id)).toHaveLength(3);
  });
});
