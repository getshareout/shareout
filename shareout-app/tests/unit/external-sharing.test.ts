// External-sharing spine (work/030) — Phase 1 truth table.
// Real Miniflare D1 so the folder-ancestor recursive CTE and the member_class SQL
// filters are exercised for real (not mocked). KV (env.SLUGS) is unbound in tests, so
// canAccess hits D1 fresh every call — which makes the revocation assertion exact.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import type { Env } from '../../src/types';
import type { AuthUser } from '../../src/api-auth';
import { canAccess, capabilitySatisfies, invalidateGrants } from '../../src/access/can-access';
import { requireExternalSharing } from '../../src/sharees/guard';
import { handleCreateGrant } from '../../src/sharees/grants';
import { handleCreateExternalToken, handleListExternalTokens, handleRevokeExternalToken } from '../../src/sharees/tokens';
import { validateToken } from '../../src/api-auth';
import { listGrantedArtifacts, listGrantedFiles } from '../../src/sharees/portal';
import { recordShareeView, listShareeActivity, handleListShareeActivity } from '../../src/sharees/activity';
import { handleListWorkspaceMembers } from '../../src/workspaces/members';
import {
  handlePutShareeContextFile, handleListShareeContext, upsertShareeContextFile,
  buildShareeContextDoc, listWorkspaceContextFiles,
} from '../../src/workspace-context';
import { buildClientsContextForWorkspace } from '../../src/sharees/context';
import { setClientNotesTool } from '../../src/chat-agent/tools/client-notes';

const e = env as unknown as Env;

beforeAll(async () => {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, username TEXT, identity_id TEXT, is_service INTEGER DEFAULT 0, last_login_at TEXT, picture TEXT, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, slug TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspace_members (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, role TEXT, member_class TEXT NOT NULL DEFAULT 'internal', invited_by TEXT, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, workspace_id TEXT, parent_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, workspace_id TEXT, folder_id TEXT, name TEXT, slug TEXT, display_slug TEXT, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS collaborators (artifact_id TEXT, email TEXT, role TEXT)`,
    `CREATE TABLE IF NOT EXISTS sharees (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, slug TEXT, type TEXT, created_by TEXT)`,
    `CREATE TABLE IF NOT EXISTS sharee_members (id TEXT PRIMARY KEY, sharee_id TEXT, user_id TEXT, email TEXT, status TEXT, invited_by TEXT)`,
    `CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, workspace_id TEXT, subject_type TEXT, subject_id TEXT, resource_type TEXT, resource_id TEXT, capability TEXT, granted_by TEXT, expires_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, workspace_id TEXT, plan_id TEXT, status TEXT)`,
    `CREATE TABLE IF NOT EXISTS subscription_plans (id TEXT PRIMARY KEY, tier TEXT, name TEXT, interval TEXT, price_cents INTEGER, min_seats INTEGER, rebill_plan_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, principal_type TEXT NOT NULL, principal_id TEXT NOT NULL, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT 'default', scopes TEXT, subject_external_user_id TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), last_used_at TEXT, expires_at TEXT, revoked_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS sharee_activity (id TEXT PRIMARY KEY, workspace_id TEXT, sharee_id TEXT, user_id TEXT, resource_type TEXT, resource_id TEXT, action TEXT DEFAULT 'view', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS workspace_files (workspace_id TEXT NOT NULL, namespace TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', updated_by TEXT, updated_by_kind TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (workspace_id, namespace, scope_id, path))`,
    `CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT, name TEXT, folder_id TEXT, visibility TEXT NOT NULL DEFAULT 'workspace', deleted_at TEXT, created_at TEXT, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, artifact_id TEXT, deliverable_id TEXT, version_no INTEGER, filename TEXT, mime_type TEXT, size_bytes INTEGER, created_at TEXT)`,
  ];
  for (const sql of ddl) await e.DB.exec(sql);
});

const WS = 'wsp_ext';
beforeEach(async () => {
  for (const t of ['users', 'workspaces', 'workspace_members', 'folders', 'artifacts',
    'collaborators', 'sharees', 'sharee_members', 'grants', 'subscriptions', 'subscription_plans', 'tokens', 'sharee_activity', 'workspace_files', 'asset_deliverables', 'blobs']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
  await e.DB.exec(`INSERT INTO workspaces (id, name, owner_id, slug) VALUES ('${WS}', 'W', 'usr_owner', 'w')`);
});

async function seedExternalUser(userId: string, email: string) {
  await e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(userId, email, email).run();
  await e.DB.prepare(
    "INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES (?, ?, ?, 'member', 'external')"
  ).bind('wsm_' + userId, WS, userId).run();
}

describe('capability lattice', () => {
  it('comment satisfies view but not edit; manage implies edit; view ≠ comment', () => {
    expect(capabilitySatisfies('comment', 'view')).toBe(true);
    expect(capabilitySatisfies('comment', 'edit')).toBe(false);
    expect(capabilitySatisfies('manage', 'edit')).toBe(true);
    expect(capabilitySatisfies('view', 'comment')).toBe(false);
    expect(capabilitySatisfies('edit', 'comment')).toBe(true);
  });
});

describe('canAccess grant resolution', () => {
  const U = { userIds: ['usr_ext'], emails: ['ext@client.com'] };

  beforeEach(async () => {
    // KV (if bound) persists across tests; bump the grant generation so each test
    // starts with a fresh cache namespace (mirrors a real grant mutation).
    await invalidateGrants(e, WS);
    await seedExternalUser('usr_ext', 'ext@client.com');
    // Folder tree: F1 (root) -> F2 (child). Artifact A in F2; Artifact B unfiled.
    await e.DB.exec(`INSERT INTO folders (id, workspace_id, parent_id) VALUES ('F1','${WS}',NULL),('F2','${WS}','F1')`);
    await e.DB.exec(`INSERT INTO artifacts (id, workspace_id, folder_id) VALUES ('A','${WS}','F2'),('B','${WS}',NULL)`);
  });

  it('denies a non-granted external', async () => {
    expect(await canAccess(e, U, 'artifact', 'A', 'view')).toBe(false);
  });

  it('inherits a sharee folder grant DOWN the ancestor chain (F1 grant → artifact in F2)', async () => {
    await e.DB.exec(`INSERT INTO sharees (id, workspace_id, name, slug, type, created_by) VALUES ('S','${WS}','Client','client','client','usr_owner')`);
    await e.DB.exec(`INSERT INTO sharee_members (id, sharee_id, user_id, email, status) VALUES ('SM','S','usr_ext','ext@client.com','active')`);
    await e.DB.exec(`INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES ('G1','${WS}','sharee','S','folder','F1','view','usr_owner')`);

    expect(await canAccess(e, U, 'artifact', 'A', 'view')).toBe(true);   // inherited
    expect(await canAccess(e, U, 'artifact', 'B', 'view')).toBe(false);  // B not under F1
  });

  it('resolves an individual external_user grant by capability lattice', async () => {
    await e.DB.exec(`INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES ('G2','${WS}','external_user','usr_ext','artifact','B','comment','usr_owner')`);
    expect(await canAccess(e, U, 'artifact', 'B', 'view')).toBe(true);    // comment ⊇ view
    expect(await canAccess(e, U, 'artifact', 'B', 'comment')).toBe(true);
    expect(await canAccess(e, U, 'artifact', 'B', 'edit')).toBe(false);   // comment ⊉ edit
  });

  it('revocation is immediate (hard delete + no KV cache in tests)', async () => {
    await e.DB.exec(`INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES ('G3','${WS}','external_user','usr_ext','artifact','A','view','usr_owner')`);
    expect(await canAccess(e, U, 'artifact', 'A', 'view')).toBe(true);
    await e.DB.exec(`DELETE FROM grants WHERE id='G3'`);
    await invalidateGrants(e, WS);
    expect(await canAccess(e, U, 'artifact', 'A', 'view')).toBe(false);
  });

  it('ignores an expired grant', async () => {
    await e.DB.exec(`INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by, expires_at) VALUES ('G4','${WS}','external_user','usr_ext','artifact','A','view','usr_owner','2000-01-01 00:00:00')`);
    expect(await canAccess(e, U, 'artifact', 'A', 'view')).toBe(false);
  });
});

describe('Phase 2 — create/edit grants (lattice + inheritance)', () => {
  const U = { userIds: ['usr_ext'], emails: ['ext@client.com'] };

  beforeEach(async () => {
    await invalidateGrants(e, WS);
    await seedExternalUser('usr_ext', 'ext@client.com');
    await e.DB.exec(`INSERT INTO folders (id, workspace_id, parent_id) VALUES ('F1','${WS}',NULL),('F2','${WS}','F1')`);
    await e.DB.exec(`INSERT INTO artifacts (id, workspace_id, folder_id) VALUES ('A','${WS}','F2')`);
  });

  it('a folder create grant authorizes create on the folder and its descendants', async () => {
    await e.DB.exec(`INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES ('Gc','${WS}','external_user','usr_ext','folder','F1','create','usr_owner')`);
    expect(await canAccess(e, U, 'folder', 'F1', 'create')).toBe(true);
    expect(await canAccess(e, U, 'folder', 'F2', 'create')).toBe(true);   // inherited
    // create does NOT imply edit (lattice)
    expect(await canAccess(e, U, 'artifact', 'A', 'edit')).toBe(false);
  });

  it('an artifact edit grant authorizes edit but not manage', async () => {
    await e.DB.exec(`INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES ('Ge','${WS}','external_user','usr_ext','artifact','A','edit','usr_owner')`);
    expect(await canAccess(e, U, 'artifact', 'A', 'edit')).toBe(true);
    expect(await canAccess(e, U, 'artifact', 'A', 'comment')).toBe(true);  // edit ⊇ comment
    expect(await canAccess(e, U, 'artifact', 'A', 'manage')).toBe(false);  // edit ⊉ manage
  });

  it('a folder edit grant cascades to a nested artifact', async () => {
    await e.DB.exec(`INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES ('Gf','${WS}','external_user','usr_ext','folder','F1','edit','usr_owner')`);
    expect(await canAccess(e, U, 'artifact', 'A', 'edit')).toBe(true);
  });
});

describe('Phase 2 — grant minting validation', () => {
  const admin = { id: 'usr_owner', email: 'owner@x.com', username: null } as AuthUser;

  beforeEach(async () => {
    await invalidateGrants(e, WS);
    await e.DB.exec(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('mo','${WS}','usr_owner','admin','internal')`);
    await e.DB.exec(`INSERT INTO subscription_plans (id, tier, name, interval, price_cents, min_seats) VALUES ('plt','teams','T','monthly',0,1)`);
    await e.DB.exec(`INSERT INTO subscriptions (id, workspace_id, plan_id, status) VALUES ('sut','${WS}','plt','active')`);
    await e.DB.exec(`INSERT INTO folders (id, workspace_id, parent_id) VALUES ('Fx','${WS}',NULL)`);
    await e.DB.exec(`INSERT INTO artifacts (id, workspace_id, folder_id) VALUES ('Ax','${WS}','Fx')`);
    await e.DB.exec(`INSERT INTO sharees (id, workspace_id, name, slug, type, created_by) VALUES ('Sx','${WS}','C','c','client','usr_owner')`);
  });

  function grantReq(payload: object) {
    return new Request('http://t/grants', { method: 'POST', body: JSON.stringify(payload) });
  }

  it('mints a folder create grant', async () => {
    const res = await handleCreateGrant(grantReq({ subject_type: 'sharee', subject_id: 'Sx', resource_type: 'folder', resource_id: 'Fx', capability: 'create' }), e, admin, WS);
    expect(res.status).toBe(201);
  });

  it('rejects a create grant on an artifact (folder-only)', async () => {
    const res = await handleCreateGrant(grantReq({ subject_type: 'sharee', subject_id: 'Sx', resource_type: 'artifact', resource_id: 'Ax', capability: 'create' }), e, admin, WS);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/folders only/);
  });

  it('mints an artifact edit grant', async () => {
    const res = await handleCreateGrant(grantReq({ subject_type: 'sharee', subject_id: 'Sx', resource_type: 'artifact', resource_id: 'Ax', capability: 'edit' }), e, admin, WS);
    expect(res.status).toBe(201);
  });
});

describe('Phase 3 — scoped external API tokens', () => {
  const admin = { id: 'usr_owner', email: 'owner@x.com', username: null } as AuthUser;

  beforeEach(async () => {
    await invalidateGrants(e, WS);
    await e.DB.exec(`INSERT INTO users (id, email) VALUES ('usr_owner','owner@x.com'),('usr_ext','ext@client.com')`);
    await e.DB.exec(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('mo','${WS}','usr_owner','admin','internal'),('me','${WS}','usr_ext','member','external')`);
    await e.DB.exec(`INSERT INTO subscription_plans (id, tier, name, interval, price_cents, min_seats) VALUES ('plt','teams','T','monthly',0,1)`);
    await e.DB.exec(`INSERT INTO subscriptions (id, workspace_id, plan_id, status) VALUES ('sut','${WS}','plt','active')`);
    await e.DB.exec(`INSERT INTO sharees (id, workspace_id, name, slug, type, created_by) VALUES ('Sx','${WS}','C','c','client','usr_owner')`);
    await e.DB.exec(`INSERT INTO sharee_members (id, sharee_id, user_id, email, status) VALUES ('SMx','Sx','usr_ext','ext@client.com','active')`);
  });

  function req(payload: object = {}) {
    return new Request('http://t/tokens', { method: 'POST', body: JSON.stringify(payload) });
  }
  function bearer(token: string) {
    return new Request('http://t/data', { headers: { Authorization: `Bearer ${token}` } });
  }

  it('mints an external sot_ token that resolves to a grant-scoped service principal', async () => {
    const res = await handleCreateExternalToken(req({ scopes: ['data:read'] }), e, admin, WS, 'Sx', 'usr_ext');
    expect(res.status).toBe(201);
    const { token } = await res.json() as { token: string };
    expect(token.startsWith('sot_')).toBe(true);

    const authed = await validateToken(bearer(token), e);
    expect(authed?.service?.externalUserId).toBe('usr_ext');
    expect(authed?.service?.workspaceId).toBe(WS);
    expect(authed?.service?.scopes).toContain('data:read');
  });

  it('refuses artifacts:publish scope for externals (read/data only)', async () => {
    const res = await handleCreateExternalToken(req({ scopes: ['artifacts:publish', 'data:read'] }), e, admin, WS, 'Sx', 'usr_ext');
    const { token } = await res.json() as { token: string };
    const authed = await validateToken(bearer(token), e);
    expect(authed?.service?.scopes).not.toContain('artifacts:publish');
  });

  it('404s minting a token for a non-member of the sharee', async () => {
    const res = await handleCreateExternalToken(req(), e, admin, WS, 'Sx', 'usr_stranger');
    expect(res.status).toBe(404);
  });

  it('revokes a token so it no longer authenticates', async () => {
    const mint = await handleCreateExternalToken(req(), e, admin, WS, 'Sx', 'usr_ext');
    const { token, id } = await mint.json() as { token: string; id: string };
    expect((await validateToken(bearer(token), e))?.service?.externalUserId).toBe('usr_ext');

    const rev = await handleRevokeExternalToken(new Request('http://t', { method: 'DELETE' }), e, admin, WS, 'Sx', 'usr_ext', id);
    expect(rev.status).toBe(200);
    expect(await validateToken(bearer(token), e)).toBeNull();

    const list = await handleListExternalTokens(new Request('http://t'), e, admin, WS, 'Sx', 'usr_ext');
    const body = await list.json() as { tokens: { id: string; revoked_at: string | null }[] };
    expect(body.tokens.find(t => t.id === id)?.revoked_at).toBeTruthy();
  });
});

describe('Phase 4 — portal enumeration + activity', () => {
  const U = { userIds: ['usr_ext'], emails: ['ext@client.com'] };

  beforeEach(async () => {
    await invalidateGrants(e, WS);
    await e.DB.exec(`INSERT INTO users (id, email) VALUES ('usr_ext','ext@client.com')`);
    await e.DB.exec(`INSERT INTO sharees (id, workspace_id, name, slug, type, created_by) VALUES ('Sp','${WS}','Acme','acme','client','usr_owner')`);
    await e.DB.exec(`INSERT INTO sharee_members (id, sharee_id, user_id, email, status) VALUES ('SMp','Sp','usr_ext','ext@client.com','active')`);
    await e.DB.exec(`INSERT INTO folders (id, workspace_id, parent_id) VALUES ('F1','${WS}',NULL),('F2','${WS}','F1')`);
    await e.DB.exec(`INSERT INTO artifacts (id, workspace_id, folder_id, name, slug) VALUES ('A','${WS}','F2','Deck','deck'),('B','${WS}',NULL,'Other','other')`);
  });

  it('listGrantedArtifacts enumerates a granted folder subtree DOWN, excludes non-granted', async () => {
    await e.DB.exec(`INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES ('Gp','${WS}','sharee','Sp','folder','F1','view','usr_owner')`);
    const arts = await listGrantedArtifacts(e, U);
    const ids = arts.map(a => a.id);
    expect(ids).toContain('A');     // under F1 → F2
    expect(ids).not.toContain('B'); // unfiled, not granted
  });

  it('listGrantedArtifacts includes a directly-granted artifact', async () => {
    await e.DB.exec(`INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES ('Gd','${WS}','external_user','usr_ext','artifact','B','view','usr_owner')`);
    const ids = (await listGrantedArtifacts(e, U)).map(a => a.id);
    expect(ids).toEqual(['B']);
  });

  it('records a read receipt attributed to the sharee, deduped within the hour', async () => {
    await recordShareeView(e, { workspaceId: WS, userId: 'usr_ext', resourceType: 'artifact', resourceId: 'A' });
    await recordShareeView(e, { workspaceId: WS, userId: 'usr_ext', resourceType: 'artifact', resourceId: 'A' });
    const rows = await listShareeActivity(e, WS);
    const forA = rows.filter(r => r.resource_id === 'A');
    expect(forA.length).toBe(1);            // deduped (KV) — but at least the row exists
    expect(forA[0].sharee_id).toBe('Sp');   // attributed to the sharee org
    expect(forA[0].user_email).toBe('ext@client.com');
  });

  it('handleListShareeActivity requires admin', async () => {
    const stranger = { id: 'usr_nobody', email: 'no@x.com', username: null } as AuthUser;
    const res = await handleListShareeActivity(new Request('http://t'), e, stranger, WS, 'Sp');
    expect(res.status).toBe(403);
  });
});

describe('Phase 5 — file grants + portal files (work/042)', () => {
  const U = { userIds: ['usr_ext'], emails: ['ext@client.com'] };
  const admin = { id: 'usr_owner', email: 'owner@x.com', username: null } as AuthUser;

  beforeEach(async () => {
    await invalidateGrants(e, WS);
    await e.DB.exec(`INSERT INTO users (id, email) VALUES ('usr_ext','ext@client.com')`);
    await e.DB.exec(`INSERT INTO sharees (id, workspace_id, name, slug, type, created_by) VALUES ('Sp','${WS}','Acme','acme','client','usr_owner')`);
    await e.DB.exec(`INSERT INTO sharee_members (id, sharee_id, user_id, email, status) VALUES ('SMp','Sp','usr_ext','ext@client.com','active')`);
    await e.DB.exec(`INSERT INTO folders (id, workspace_id, parent_id) VALUES ('F1','${WS}',NULL)`);
    // Two files in F1: dW (workspace-visible) and dP (private). Both have a v1 blob.
    await e.DB.exec(`INSERT INTO asset_deliverables (id, bucket_artifact_id, workspace_id, owner_id, name, folder_id, visibility) VALUES ('dW','bk','${WS}','usr_owner','Logo','F1','workspace'),('dP','bk','${WS}','usr_owner','Secret','F1','private')`);
    await e.DB.exec(`INSERT INTO blobs (id, artifact_id, deliverable_id, version_no, filename, mime_type, size_bytes) VALUES ('bW','bk','dW',1,'logo.png','image/png',10),('bP','bk','dP',1,'secret.pdf','application/pdf',20)`);
  });

  const grant = (id: string, st: string, sid: string, rt: string, rid: string) =>
    e.DB.exec(`INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES ('${id}','${WS}','${st}','${sid}','${rt}','${rid}','view','usr_owner')`);

  it('canAccess: a direct file grant authorizes view; a non-granted file denies', async () => {
    await grant('Gf', 'external_user', 'usr_ext', 'file', 'dW');
    expect(await canAccess(e, U, 'file', 'dW', 'view')).toBe(true);
    expect(await canAccess(e, U, 'file', 'dP', 'view')).toBe(false);
  });

  it('canAccess: a folder grant reaches a workspace-visible file but NOT a private one', async () => {
    await grant('Gfo', 'sharee', 'Sp', 'folder', 'F1');
    expect(await canAccess(e, U, 'file', 'dW', 'view')).toBe(true);   // inherited
    expect(await canAccess(e, U, 'file', 'dP', 'view')).toBe(false);  // private → direct grant only
  });

  it('canAccess: a direct grant on a PRIVATE file still authorizes (explicit share wins)', async () => {
    await grant('Gp', 'external_user', 'usr_ext', 'file', 'dP');
    expect(await canAccess(e, U, 'file', 'dP', 'view')).toBe(true);
  });

  it('listGrantedFiles: a folder grant surfaces non-private files, hides the private one', async () => {
    await grant('Gfo', 'sharee', 'Sp', 'folder', 'F1');
    const ids = (await listGrantedFiles(e, U)).map(f => f.id).sort();
    expect(ids).toEqual(['dW']);   // dP (private) excluded from the folder subtree
  });

  it('listGrantedFiles: a direct grant surfaces even a private file, with its content path', async () => {
    await grant('Gp', 'external_user', 'usr_ext', 'file', 'dP');
    const files = await listGrantedFiles(e, U);
    expect(files.map(f => f.id)).toEqual(['dP']);
    // work/042 P3: files serve through the identity-checked deliverable route, not the raw
    // blob route (which now 403s private files).
    expect(files[0].contentPath).toBe('/v1/files/dP/content');
    // bucketId powers the portal comment thread URL (/v1/data/{bucket}/comments)
    expect(typeof files[0].bucketId).toBe('string');
    expect(files[0].bucketId.length).toBeGreaterThan(0);
  });

  it('handleCreateGrant mints a file grant (resource validated against asset_deliverables)', async () => {
    await e.DB.exec(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('mo','${WS}','usr_owner','admin','internal')`);
    await e.DB.exec(`INSERT INTO subscription_plans (id, tier, name, interval, price_cents, min_seats) VALUES ('plt','teams','T','monthly',0,1)`);
    await e.DB.exec(`INSERT INTO subscriptions (id, workspace_id, plan_id, status) VALUES ('sut','${WS}','plt','active')`);
    const req = new Request('http://t/grants', { method: 'POST', body: JSON.stringify({ subject_type: 'sharee', subject_id: 'Sp', resource_type: 'file', resource_id: 'dW', capability: 'view' }) });
    const res = await handleCreateGrant(req, e, admin, WS);
    expect(res.status).toBe(201);
  });
});

describe('Client context notes (reuse Intelligence module, scoped to a sharee)', () => {
  const admin = { id: 'usr_owner', email: 'owner@x.com', username: null } as AuthUser;
  const member = { id: 'usr_mem', email: 'mem@x.com', username: null } as AuthUser;
  const stranger = { id: 'usr_out', email: 'out@x.com', username: null } as AuthUser;

  beforeEach(async () => {
    await e.DB.exec(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('mo','${WS}','usr_owner','admin','internal'),('mm','${WS}','usr_mem','member','internal')`);
    await e.DB.exec(`INSERT INTO sharees (id, workspace_id, name, slug, type, created_by) VALUES ('Sc','${WS}','Acme','acme','client','usr_owner')`);
  });

  function putReq(content: string) {
    return new Request('http://t', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  }

  it('admin writes a client note; it is scoped to the sharee, not the workspace', async () => {
    const res = await handlePutShareeContextFile(putReq('Prefers Friday demos.'), e, admin, WS, 'Sc', 'notes.md');
    expect(res.status).toBe(200);
    const docs = await listWorkspaceContextFiles(e, WS, 'Sc');
    expect(docs.map(d => d.name)).toContain('notes.md');
    // workspace-level scope (sharee_id NULL) must NOT see the client's note
    expect(await listWorkspaceContextFiles(e, WS, null)).toHaveLength(0);
  });

  it('a member can read but not write client notes', async () => {
    await handlePutShareeContextFile(putReq('x'), e, admin, WS, 'Sc', 'notes.md');
    const read = await handleListShareeContext(e, member, WS, 'Sc');
    expect(read.status).toBe(200);
    const write = await handlePutShareeContextFile(putReq('y'), e, member, WS, 'Sc', 'notes.md');
    expect(write.status).toBe(403);
  });

  it('the agent path (no user) stamps updated_by_kind=agent', async () => {
    const err = await upsertShareeContextFile(e, WS, 'Sc', 'auto.md', 'Learned from chat.', null);
    expect(err).toBeNull();
    const row = await e.DB.prepare("SELECT updated_by_kind FROM workspace_files WHERE namespace='context' AND scope_id='Sc' AND path='auto.md'").first<{ updated_by_kind: string }>();
    expect(row?.updated_by_kind).toBe('agent');
  });

  it('buildClientsContextForWorkspace injects the client notes for the assistant', async () => {
    await upsertShareeContextFile(e, WS, 'Sc', 'notes.md', 'Pays net-30.', null);
    const ctx = await buildClientsContextForWorkspace(e, WS);
    expect(ctx).toContain('Acme');
    expect(ctx).toContain('Pays net-30.');
    expect(await buildShareeContextDoc(e, WS, 'Sc', 'Acme')).toContain('Pays net-30.');
  });

  it('set_client_notes tool: admin writes by client name; member is refused', async () => {
    const ok = await setClientNotesTool.execute(
      { env: e, userId: 'usr_owner', selectedWorkspaceId: WS },
      { client: 'Acme', content: 'Renewal in Q4.' },
    ) as { ok?: boolean; error?: string };
    expect(ok.ok).toBe(true);
    expect((await buildShareeContextDoc(e, WS, 'Sc', 'Acme'))).toContain('Renewal in Q4.');

    const denied = await setClientNotesTool.execute(
      { env: e, userId: 'usr_mem', selectedWorkspaceId: WS },
      { client: 'Acme', content: 'nope' },
    ) as { error?: string };
    expect(denied.error).toMatch(/admin/i);
  });
});

describe('billing exclusion', () => {
  beforeEach(async () => {
    await e.DB.exec(`INSERT INTO users (id, email) VALUES ('u1','a@x.com'),('u2','b@x.com'),('u3','c@ext.com')`);
    await e.DB.exec(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('m1','${WS}','u1','owner','internal'),('m2','${WS}','u2','member','internal'),('m3','${WS}','u3','member','external')`);
  });


  it('handleListWorkspaceMembers omits external members', async () => {
    const caller: AuthUser = { id: 'u1', email: 'a@x.com', username: null };
    const res = await handleListWorkspaceMembers(new Request('http://t'), e, caller, WS);
    const body = await res.json() as { members: { user_id: string }[] };
    const ids = body.members.map(m => m.user_id);
    expect(ids).toContain('u1');
    expect(ids).not.toContain('u3');
  });
});

describe('external-sharing guard', () => {
  it('403s a non-admin and allows a workspace admin (no paid entitlement in this build)', async () => {
    await e.DB.exec(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('ma','${WS}','admin1','admin','internal')`);
    expect(await requireExternalSharing(e, WS, 'admin1')).toBeNull();

    const denied = await requireExternalSharing(e, WS, 'nobody');
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(403);
  });
});
