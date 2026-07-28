// Share a file/folder with ONE person by email (work/042 P2b). Real Miniflare D1 so the
// entitlement gate, the internal-member 409 guard, edge creation, and grant minting all run.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';
import { handleShareWithPerson, handleListGrants, handleDeleteGrant } from '../../../src/sharees/grants';
import { listGrantedFiles } from '../../../src/sharees/portal';
import { invalidateGrants } from '../../../src/access/can-access';

const e = { ...(env as unknown as Env), SESSION_SECRET: 'session-secret' } as Env;
const WS = 'wsp_sp';
const admin = { id: 'usr_admin', email: 'admin@x.com', username: null } as AuthUser;

beforeAll(async () => {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, last_login_at TEXT, identity_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, slug TEXT, allowed_email_domains TEXT, allowed_emails TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspace_members (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, role TEXT, member_class TEXT NOT NULL DEFAULT 'internal', invited_by TEXT, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, workspace_id TEXT, parent_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS sharees (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, slug TEXT, type TEXT, created_by TEXT)`,
    `CREATE TABLE IF NOT EXISTS sharee_members (id TEXT PRIMARY KEY, sharee_id TEXT, user_id TEXT, email TEXT, status TEXT)`,
    `CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, workspace_id TEXT, subject_type TEXT, subject_id TEXT, resource_type TEXT, resource_id TEXT, capability TEXT, granted_by TEXT, created_at TEXT DEFAULT (datetime('now')), expires_at TEXT, UNIQUE(subject_type, subject_id, resource_type, resource_id, capability))`,
    `CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, workspace_id TEXT, plan_id TEXT, status TEXT)`,
    `CREATE TABLE IF NOT EXISTS subscription_plans (id TEXT PRIMARY KEY, tier TEXT, name TEXT, interval TEXT, price_cents INTEGER, min_seats INTEGER, rebill_plan_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspace_invite_claims (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, email TEXT, code_hash TEXT, invited_by TEXT, expires_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT, name TEXT, folder_id TEXT, visibility TEXT NOT NULL DEFAULT 'workspace', deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, artifact_id TEXT, deliverable_id TEXT, version_no INTEGER, filename TEXT, mime_type TEXT, size_bytes INTEGER)`,
  ];
  for (const sql of ddl) await e.DB.exec(sql);
});

beforeEach(async () => {
  await invalidateGrants(e, WS);
  for (const t of ['users', 'workspaces', 'workspace_members', 'folders', 'sharees', 'sharee_members', 'grants', 'subscriptions', 'subscription_plans', 'workspace_invite_claims', 'asset_deliverables', 'blobs']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
  await e.DB.exec(`INSERT INTO users (id, email) VALUES ('usr_admin','admin@x.com'),('usr_peer','peer@x.com')`);
  await e.DB.exec(`INSERT INTO workspaces (id, name, owner_id, slug) VALUES ('${WS}','W','usr_admin','w')`);
  await e.DB.exec(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('ma','${WS}','usr_admin','admin','internal'),('mp','${WS}','usr_peer','member','internal')`);
  await e.DB.exec(`INSERT INTO subscription_plans (id, tier, name, interval, price_cents, min_seats) VALUES ('pl','teams','T','monthly',0,1)`);
  await e.DB.exec(`INSERT INTO subscriptions (id, workspace_id, plan_id, status) VALUES ('su','${WS}','pl','active')`);
  await e.DB.exec(`INSERT INTO asset_deliverables (id, bucket_artifact_id, workspace_id, owner_id, name, visibility) VALUES ('dW','bk','${WS}','usr_admin','Logo','workspace'),('dElse','bk2','wsp_other','usr_admin','X','workspace')`);
  await e.DB.exec(`INSERT INTO blobs (id, artifact_id, deliverable_id, version_no, filename, mime_type, size_bytes) VALUES ('bW','bk','dW',1,'logo.png','image/png',10)`);
});

const share = (body: unknown) =>
  handleShareWithPerson(new Request('https://shareout.site/x', { method: 'POST', body: JSON.stringify(body) }), e, admin, WS);

describe('share a file with a person (work/042 P2b)', () => {
  it('shares a file with a new person: mints the external edge + grant; portal surfaces it', async () => {
    const res = await share({ resource_type: 'file', resource_id: 'dW', email: 'client@acme.com', capability: 'comment' });
    expect(res.status).toBe(201);

    const u = await e.DB.prepare(`SELECT id FROM users WHERE email = 'client@acme.com'`).first<{ id: string }>();
    expect(u).toBeTruthy();
    const edge = await e.DB.prepare(`SELECT member_class FROM workspace_members WHERE workspace_id = ? AND user_id = ?`).bind(WS, u!.id).first<{ member_class: string }>();
    expect(edge?.member_class).toBe('external');
    const g = await e.DB.prepare(`SELECT capability FROM grants WHERE subject_type='external_user' AND subject_id = ? AND resource_type='file' AND resource_id='dW'`).bind(u!.id).first<{ capability: string }>();
    expect(g?.capability).toBe('comment');

    const files = await listGrantedFiles(e, { userIds: [u!.id], emails: ['client@acme.com'] });
    expect(files.map(f => f.id)).toEqual(['dW']);
  });

  it('409s when the email is already an INTERNAL member', async () => {
    const res = await share({ resource_type: 'file', resource_id: 'dW', email: 'peer@x.com', capability: 'view' });
    expect(res.status).toBe(409);
    expect((await res.json() as { code: string }).code).toBe('ALREADY_MEMBER');
  });

  it('400s a resource not in this workspace', async () => {
    const res = await share({ resource_type: 'file', resource_id: 'dElse', email: 'client@acme.com', capability: 'view' });
    expect(res.status).toBe(400);
  });

  it('400s a bad email / bad capability', async () => {
    expect((await share({ resource_type: 'file', resource_id: 'dW', email: 'nope', capability: 'view' })).status).toBe(400);
    expect((await share({ resource_type: 'file', resource_id: 'dW', email: 'a@b.com', capability: 'edit' })).status).toBe(400);
  });


  it('lists shares with a resolved email label, then revokes (management UI backend)', async () => {
    await share({ resource_type: 'file', resource_id: 'dW', email: 'client@acme.com', capability: 'view' });
    const listReq = new Request('https://shareout.site/x?resource_type=file&resource_id=dW');
    const listed = await (await handleListGrants(listReq, e, admin, WS)).json() as { grants: { id: string; subject_label: string }[] };
    expect(listed.grants.length).toBe(1);
    expect(listed.grants[0].subject_label).toBe('client@acme.com');

    const del = await handleDeleteGrant(new Request('https://shareout.site/x', { method: 'DELETE' }), e, admin, WS, listed.grants[0].id);
    expect(del.status).toBe(200);
    const after = await (await handleListGrants(listReq, e, admin, WS)).json() as { grants: unknown[] };
    expect(after.grants.length).toBe(0);
  });

  it('re-sharing with the same person is idempotent', async () => {
    await share({ resource_type: 'file', resource_id: 'dW', email: 'client@acme.com', capability: 'view' });
    const res = await share({ resource_type: 'file', resource_id: 'dW', email: 'client@acme.com', capability: 'view' });
    expect(res.status).toBe(201);
    const u = await e.DB.prepare(`SELECT id FROM users WHERE email='client@acme.com'`).first<{ id: string }>();
    const { results } = await e.DB.prepare(`SELECT id FROM grants WHERE subject_id = ? AND resource_id='dW' AND capability='view'`).bind(u!.id).all();
    expect(results!.length).toBe(1);
  });
});
