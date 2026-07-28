// GET /v1/files/:id/content truth table (work/042 P3). Real Miniflare D1 + R2 so the
// deliverable→latest-blob join, the canAccess grant path, and the R2 byte serve all run
// for real. SESSION_SECRET is overridden to a known value so session cookies verify.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import type { Env } from '../../../src/types';
import { handleFileContent, handleFileMeta } from '../../../src/data/files-content';
import { createSessionToken } from '../../../src/token';

const e = { ...(env as unknown as Env), SESSION_SECRET: 'session-secret' } as Env;
const WS = 'wsp_files';

beforeAll(async () => {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, picture TEXT, identity_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, slug TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspace_members (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, role TEXT, member_class TEXT NOT NULL DEFAULT 'internal')`,
    `CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, workspace_id TEXT, parent_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS sharees (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, slug TEXT, type TEXT, created_by TEXT, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS sharee_members (id TEXT PRIMARY KEY, sharee_id TEXT, user_id TEXT, email TEXT, status TEXT)`,
    `CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, workspace_id TEXT, subject_type TEXT, subject_id TEXT, resource_type TEXT, resource_id TEXT, capability TEXT, granted_by TEXT, expires_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT, name TEXT, folder_id TEXT, visibility TEXT NOT NULL DEFAULT 'workspace', deleted_at TEXT, type_metadata TEXT)`,
    `CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, artifact_id TEXT, deliverable_id TEXT, version_no INTEGER, filename TEXT, mime_type TEXT, size_bytes INTEGER, r2_key TEXT)`,
    `CREATE TABLE IF NOT EXISTS file_artifact_usage (deliverable_id TEXT, artifact_id TEXT, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (deliverable_id, artifact_id))`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, display_slug TEXT, deleted_at TEXT)`,
  ];
  for (const sql of ddl) await e.DB.exec(sql);
});

// r2 key → bytes helper
async function putBytes(key: string, text: string) {
  await e.ARTIFACTS.put(key, new TextEncoder().encode(text));
}

beforeEach(async () => {
  for (const t of ['users', 'workspaces', 'workspace_members', 'folders', 'sharees', 'sharee_members', 'grants', 'asset_deliverables', 'blobs', 'file_artifact_usage', 'artifacts']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
  await e.DB.exec(`INSERT INTO artifacts (id, name, slug) VALUES ('art1','Dashboard','dash')`);
  await e.DB.exec(`INSERT INTO users (id, email) VALUES ('usr_owner','owner@x.com'),('usr_ext','ext@client.com'),('usr_other','other@x.com')`);
  await e.DB.exec(`INSERT INTO workspaces (id, name, owner_id, slug) VALUES ('${WS}','W','usr_owner','w')`);
  // dW workspace-visible, dP private — both owned by usr_owner, v1 blob with real R2 bytes.
  await e.DB.exec(`INSERT INTO asset_deliverables (id, bucket_artifact_id, workspace_id, owner_id, name, visibility) VALUES ('dW','bk','${WS}','usr_owner','Logo','workspace'),('dP','bk','${WS}','usr_owner','Secret','private')`);
  await e.DB.exec(`INSERT INTO blobs (id, artifact_id, deliverable_id, version_no, filename, mime_type, size_bytes, r2_key) VALUES ('bW','bk','dW',1,'logo.txt','text/plain',5,'bk/blobs/bW/logo.txt'),('bP','bk','dP',1,'secret.txt','text/plain',6,'bk/blobs/bP/secret.txt')`);
  await putBytes('bk/blobs/bW/logo.txt', 'logo!');
  await putBytes('bk/blobs/bP/secret.txt', 'secret');
});

const req = (id: string, cookie?: string) =>
  new Request(`https://shareout.site/v1/files/${id}/content`, cookie ? { headers: { Cookie: cookie } } : {});
const cookieFor = async (userId: string, email: string) =>
  `shareout_session=${await createSessionToken(userId, email, e)}`;

describe('GET /v1/files/:id/content (work/042 P3)', () => {
  it('serves a workspace file to anyone (no session) — embeddable', async () => {
    const res = await handleFileContent(req('dW'), e, 'dW');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('logo!');
    expect(res.headers.get('Cache-Control')).not.toContain('immutable');
  });

  it('denies a private file to an anonymous viewer (403)', async () => {
    const res = await handleFileContent(req('dP'), e, 'dP');
    expect(res.status).toBe(403);
  });

  it('serves a private file to its owner', async () => {
    const res = await handleFileContent(req('dP', await cookieFor('usr_owner', 'owner@x.com')), e, 'dP');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('secret');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('denies a private file to an unrelated signed-in user (403)', async () => {
    const res = await handleFileContent(req('dP', await cookieFor('usr_other', 'other@x.com')), e, 'dP');
    expect(res.status).toBe(403);
  });

  it('serves a private file to a sharee holding a direct file grant', async () => {
    await e.DB.exec(`INSERT INTO sharees (id, workspace_id, name, slug, type, created_by) VALUES ('Sp','${WS}','Acme','acme','client','usr_owner')`);
    await e.DB.exec(`INSERT INTO sharee_members (id, sharee_id, user_id, email, status) VALUES ('SMp','Sp','usr_ext','ext@client.com','active')`);
    await e.DB.exec(`INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES ('Gp','${WS}','sharee','Sp','file','dP','view','usr_owner')`);
    const res = await handleFileContent(req('dP', await cookieFor('usr_ext', 'ext@client.com')), e, 'dP');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('secret');
  });

  it('?v=N pins a specific version; default serves the latest', async () => {
    await e.DB.exec(`INSERT INTO blobs (id, artifact_id, deliverable_id, version_no, filename, mime_type, size_bytes, r2_key) VALUES ('bW2','bk','dW',2,'logo.txt','text/plain',5,'bk/blobs/bW2/logo.txt')`);
    await putBytes('bk/blobs/bW2/logo.txt', 'LOGO2');
    expect(await (await handleFileContent(req('dW'), e, 'dW')).text()).toBe('LOGO2');             // latest
    const v1 = await handleFileContent(new Request('https://shareout.site/v1/files/dW/content?v=1'), e, 'dW');
    expect(await v1.text()).toBe('logo!');                                                          // pinned v1
  });

  it('404 for a missing or soft-deleted deliverable', async () => {
    expect((await handleFileContent(req('nope'), e, 'nope')).status).toBe(404);
    await e.DB.exec(`UPDATE asset_deliverables SET deleted_at = datetime('now') WHERE id = 'dW'`);
    expect((await handleFileContent(req('dW'), e, 'dW')).status).toBe(404);
  });
});

describe('GET /v1/files/:id metadata (work/042 P4)', () => {
  it('returns metadata + usage for a workspace file', async () => {
    await e.DB.exec(`INSERT INTO file_artifact_usage (deliverable_id, artifact_id) VALUES ('dW','art1')`);
    const res = await handleFileMeta(req('dW'), e, 'dW');
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; contentUrl: string; usedIn: unknown[] };
    expect(body.name).toBe('Logo');
    expect(body.contentUrl).toBe('/v1/files/dW/content');
    expect(body.usedIn.length).toBe(1);
  });

  it("denies an anonymous viewer a private file's metadata", async () => {
    expect((await handleFileMeta(req('dP'), e, 'dP')).status).toBe(403);
  });
});
