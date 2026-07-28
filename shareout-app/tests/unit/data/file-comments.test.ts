// File comments access gate (work/042 P2). Real Miniflare D1 + sessions so the bucket
// detection, member-visibility filter, cross-bucket guard, and canAccess grant path all run.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import type { Env } from '../../../src/types';
import type { DataContext } from '../../../src/data/middleware';
import {
  authorizeFileComment,
  authorizeFileCommentById,
  isAssetBucketArtifact,
  userCanAccessFileComment,
} from '../../../src/data/comments/file-comments';
import { listComments } from '../../../src/data/comments/crud';
import { handleComments } from '../../../src/data/comments/handler';
import { createSessionToken } from '../../../src/token';
import { invalidateGrants } from '../../../src/access/can-access';

const e = { ...(env as unknown as Env), SESSION_SECRET: 'session-secret' } as Env;
const WS = 'wsp_fc';
const BK = 'bk';

beforeAll(async () => {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, picture TEXT, identity_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, slug TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspace_members (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, role TEXT, member_class TEXT NOT NULL DEFAULT 'internal')`,
    `CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, workspace_id TEXT, parent_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS sharees (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, slug TEXT, type TEXT, created_by TEXT)`,
    `CREATE TABLE IF NOT EXISTS sharee_members (id TEXT PRIMARY KEY, sharee_id TEXT, user_id TEXT, email TEXT, status TEXT)`,
    `CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, workspace_id TEXT, subject_type TEXT, subject_id TEXT, resource_type TEXT, resource_id TEXT, capability TEXT, granted_by TEXT, expires_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS asset_buckets (artifact_id TEXT PRIMARY KEY, workspace_id TEXT, owner_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT, name TEXT, folder_id TEXT, visibility TEXT NOT NULL DEFAULT 'workspace', deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifact_comments (id TEXT PRIMARY KEY, artifact_id TEXT, context_id TEXT, parent_id TEXT, author_id TEXT, author_name TEXT, content TEXT, created_at TEXT, updated_at TEXT)`,
  ];
  for (const sql of ddl) await e.DB.exec(sql);
});

beforeEach(async () => {
  await invalidateGrants(e, WS);
  for (const t of ['users', 'workspaces', 'workspace_members', 'folders', 'sharees', 'sharee_members', 'grants', 'asset_buckets', 'asset_deliverables', 'artifact_comments']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
  await e.DB.exec(`INSERT INTO users (id, email) VALUES ('usr_owner','owner@x.com'),('usr_member','member@x.com'),('usr_ext','ext@client.com'),('usr_stranger','s@x.com')`);
  await e.DB.exec(`INSERT INTO workspaces (id, name, owner_id, slug) VALUES ('${WS}','W','usr_owner','w')`);
  await e.DB.exec(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('m1','${WS}','usr_owner','admin','internal'),('m2','${WS}','usr_member','member','internal')`);
  await e.DB.exec(`INSERT INTO asset_buckets (artifact_id, workspace_id, owner_id) VALUES ('${BK}','${WS}','usr_owner')`);
  // dW workspace-visible, dP private (owner usr_owner). dOther lives in a DIFFERENT bucket.
  await e.DB.exec(`INSERT INTO asset_deliverables (id, bucket_artifact_id, workspace_id, owner_id, name, visibility) VALUES ('dW','${BK}','${WS}','usr_owner','Logo','workspace'),('dP','${BK}','${WS}','usr_owner','Secret','private'),('dOther','bk2','${WS}','usr_owner','Elsewhere','workspace')`);
});

const ctx = () => ({ artifactId: BK, env: e, origin: null } as unknown as DataContext);
const freshCtx = () => ctx(); // each call = fresh memo of __isAssetBucket
const reqWith = async (userId?: string, email?: string) => {
  const headers: Record<string, string> = {};
  if (userId) headers.Cookie = `shareout_session=${await createSessionToken(userId, email!, e)}`;
  return new Request('https://shareout.site/x', { headers });
};
const grant = (id: string, st: string, sid: string, cap: string) =>
  e.DB.exec(`INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES ('${id}','${WS}','${st}','${sid}','file','dP','${cap}','usr_owner')`);
const seedSharee = () => e.DB.batch([
  e.DB.prepare(`INSERT INTO sharees (id, workspace_id, name, slug, type, created_by) VALUES ('Sp','${WS}','Acme','acme','client','usr_owner')`),
  e.DB.prepare(`INSERT INTO sharee_members (id, sharee_id, user_id, email, status) VALUES ('SMp','Sp','usr_ext','ext@client.com','active')`),
]);

describe('file comment gate (work/042 P2)', () => {
  it('detects a bucket artifact', async () => {
    expect(await isAssetBucketArtifact(freshCtx())).toBe(true);
    expect(await isAssetBucketArtifact({ artifactId: 'not_a_bucket', env: e } as unknown as DataContext)).toBe(false);
  });

  it('rejects an un-scoped (non-file) context on a bucket', async () => {
    const res = await authorizeFileComment(await reqWith(), freshCtx(), null, 'view');
    expect(res?.status).toBe(400);
  });

  it('404s a cross-bucket file (context forgery)', async () => {
    const res = await authorizeFileComment(await reqWith('usr_member', 'member@x.com'), freshCtx(), 'file:dOther', 'view');
    expect(res?.status).toBe(404);
  });

  it('allows a member to view a workspace file; denies anon', async () => {
    expect(await authorizeFileComment(await reqWith('usr_member', 'member@x.com'), freshCtx(), 'file:dW', 'view')).toBeNull();
    expect((await authorizeFileComment(await reqWith(), freshCtx(), 'file:dW', 'view'))?.status).toBe(403);
  });

  it('denies a member on a peer PRIVATE file; allows the owner', async () => {
    expect((await authorizeFileComment(await reqWith('usr_member', 'member@x.com'), freshCtx(), 'file:dP', 'view'))?.status).toBe(403);
    expect(await authorizeFileComment(await reqWith('usr_owner', 'owner@x.com'), freshCtx(), 'file:dP', 'view')).toBeNull();
  });

  it('a stranger (signed in, not a member, no grant) is denied', async () => {
    expect((await authorizeFileComment(await reqWith('usr_stranger', 's@x.com'), freshCtx(), 'file:dW', 'view'))?.status).toBe(403);
  });

  it('a sharee with a comment grant may post; a view-only grant may not', async () => {
    await seedSharee();
    await grant('Gc', 'sharee', 'Sp', 'comment');
    const r = await reqWith('usr_ext', 'ext@client.com');
    expect(await authorizeFileComment(r, freshCtx(), 'file:dP', 'view')).toBeNull();     // view ok
    expect(await authorizeFileComment(r, freshCtx(), 'file:dP', 'comment')).toBeNull();  // comment ok
    // downgrade to view-only: 'comment' now denied (capability lattice)
    await e.DB.exec(`UPDATE grants SET capability='view' WHERE id='Gc'`);
    await invalidateGrants(e, WS); // prod busts the grant cache on any grant change

    const denied = await authorizeFileComment(await reqWith('usr_ext', 'ext@client.com'), freshCtx(), 'file:dP', 'comment');
    expect(denied?.status).toBe(403);
  });

  it('allows the owner to comment on a personal (no-workspace) file; others denied', async () => {
    await e.DB.exec(`INSERT INTO asset_deliverables (id, bucket_artifact_id, workspace_id, owner_id, name, visibility) VALUES ('dPers','${BK}',NULL,'usr_owner','Personal','workspace')`);
    expect(await authorizeFileComment(await reqWith('usr_owner', 'owner@x.com'), freshCtx(), 'file:dPers', 'comment')).toBeNull();
    expect((await authorizeFileComment(await reqWith('usr_member', 'member@x.com'), freshCtx(), 'file:dPers', 'view'))?.status).toBe(403);
  });

  it('listComments enforces the gate: bucket + no contextId → 400', async () => {
    const res = await listComments(new Request('https://shareout.site/x'), freshCtx());
    expect(res.status).toBe(400);
  });

  it('gates react/resolve/assign by comment id: stranger on a private file denied, owner ok, unknown id passes to 404', async () => {
    await e.DB.exec(`INSERT INTO artifact_comments (id, artifact_id, context_id, author_name, content, created_at, updated_at) VALUES ('cmt_${'a'.repeat(24)}','${BK}','file:dP','O','hi','t','t')`);
    const cid = 'cmt_' + 'a'.repeat(24);
    // stranger (signed in, not a member, no grant) can't act on a private file's comment
    expect((await authorizeFileCommentById(await reqWith('usr_stranger', 's@x.com'), freshCtx(), cid, 'comment'))?.status).toBe(403);
    // owner may
    expect(await authorizeFileCommentById(await reqWith('usr_owner', 'owner@x.com'), freshCtx(), cid, 'comment')).toBeNull();
    // unknown id → null (handler emits its own 404, gate must not confirm existence)
    expect(await authorizeFileCommentById(await reqWith('usr_stranger', 's@x.com'), freshCtx(), 'cmt_' + 'b'.repeat(24), 'comment')).toBeNull();
  });

  it('blocks the realtime socket on a bucket', async () => {
    const res = await handleComments(new Request('https://shareout.site/x', { headers: { Upgrade: 'websocket' } }), freshCtx(), 'ws');
    expect(res.status).toBe(403);
  });

  it('userCanAccessFileComment mirrors the HTTP gate (member vs private peer)', async () => {
    expect(await userCanAccessFileComment(e, { id: 'usr_member', email: 'member@x.com' }, BK, 'file:dW', 'view')).toBe(true);
    expect(await userCanAccessFileComment(e, { id: 'usr_member', email: 'member@x.com' }, BK, 'file:dP', 'view')).toBe(false);
    expect(await userCanAccessFileComment(e, { id: 'usr_owner', email: 'owner@x.com' }, BK, 'file:dP', 'comment')).toBe(true);
    expect(await userCanAccessFileComment(e, { id: 'usr_member', email: 'member@x.com' }, BK, null, 'view')).toBe(false);
    expect(await userCanAccessFileComment(e, { id: 'usr_member', email: 'member@x.com' }, BK, 'file:dOther', 'view')).toBe(false);
  });
});
