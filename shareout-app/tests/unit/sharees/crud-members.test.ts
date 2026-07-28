// P0 robustness: Sharee CRUD + member invite validation (admin + entitlement gates).
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';

vi.mock('../../../src/workspaces/invite', () => ({
  inviteOrAddMember: vi.fn().mockResolvedValue({ status: 'invited' }),
}));

vi.mock('../../../src/access/can-access', () => ({
  invalidateGrants: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

import {
  handleCreateSharee,
  handleListSharees,
  handleGetSharee,
  handleDeleteSharee,
  handleUpdateSharee,
} from '../../../src/sharees/crud';
import {
  handleAddShareeMember,
  handleListShareeMembers,
  handleRemoveShareeMember,
} from '../../../src/sharees/members';
import { inviteOrAddMember } from '../../../src/workspaces/invite';

const e = env as unknown as Env;
const admin: AuthUser = { id: 'usr_admin', email: 'admin@x.com', username: null };
const member: AuthUser = { id: 'usr_member', email: 'member@x.com', username: null };
const WS = 'wsp_sharee';

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, slug TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspace_members (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, role TEXT, member_class TEXT NOT NULL DEFAULT 'internal')`,
    `CREATE TABLE IF NOT EXISTS sharees (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, slug TEXT, type TEXT, properties TEXT, branding TEXT, created_by TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS sharee_members (id TEXT PRIMARY KEY, sharee_id TEXT, user_id TEXT, email TEXT, status TEXT, invited_by TEXT, created_at TEXT DEFAULT (datetime('now')), joined_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, workspace_id TEXT, subject_type TEXT, subject_id TEXT, resource_type TEXT, resource_id TEXT, capability TEXT, granted_by TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspace_files (workspace_id TEXT NOT NULL, namespace TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', updated_by TEXT, updated_by_kind TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (workspace_id, namespace, scope_id, path))`,
    `CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, workspace_id TEXT, plan_id TEXT, status TEXT)`,
    `CREATE TABLE IF NOT EXISTS subscription_plans (id TEXT PRIMARY KEY, tier TEXT, name TEXT, interval TEXT, price_cents INTEGER, min_seats INTEGER, rebill_plan_id TEXT)`,
  ]) await e.DB.exec(sql);
});

beforeEach(async () => {
  for (const t of [
    'sharee_members', 'grants', 'workspace_files', 'sharees',
    'subscriptions', 'subscription_plans', 'workspace_members', 'workspaces', 'users',
  ]) await e.DB.exec(`DELETE FROM ${t}`);

  await e.DB.exec(`INSERT INTO users (id, email) VALUES ('usr_admin','admin@x.com'),('usr_member','member@x.com')`);
  await e.DB.exec(`INSERT INTO workspaces (id, name, owner_id, slug) VALUES ('${WS}','W','usr_admin','w')`);
  await e.DB.exec(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('m1','${WS}','usr_admin','admin','internal'),('m2','${WS}','usr_member','member','internal')`);
  await e.DB.exec(`INSERT INTO subscription_plans (id, tier, name, interval, price_cents, min_seats) VALUES ('pl','teams','Teams','monthly',0,1)`);
  await e.DB.exec(`INSERT INTO subscriptions (id, workspace_id, plan_id, status) VALUES ('su','${WS}','pl','active')`);
});

function jsonReq(body: unknown) {
  return new Request('https://shareout.site/v1/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('sharee CRUD', () => {
  it('list requires admin; create requires entitlement + admin', async () => {
    const denied = await handleListSharees(new Request('https://x'), e, member, WS);
    expect(denied.status).toBe(403);

    const badName = await handleCreateSharee(jsonReq({}), e, admin, WS);
    expect(badName.status).toBe(400);

    const created = await handleCreateSharee(jsonReq({ name: 'Acme Co', type: 'client' }), e, admin, WS);
    expect(created.status).toBe(201);
    const { sharee } = await created.json() as { sharee: { id: string; slug: string; name: string } };
    expect(sharee.name).toBe('Acme Co');
    expect(sharee.slug).toBe('acme-co');

    const listed = await handleListSharees(new Request('https://x'), e, admin, WS);
    expect(listed.status).toBe(200);
    const { sharees } = await listed.json() as { sharees: unknown[] };
    expect(sharees).toHaveLength(1);

    const got = await handleGetSharee(new Request('https://x'), e, admin, WS, sharee.id);
    expect(got.status).toBe(200);

    const updated = await handleUpdateSharee(jsonReq({ name: 'Acme Inc' }), e, admin, WS, sharee.id);
    expect(updated.status).toBe(200);
    expect((await updated.json() as { sharee: { name: string } }).sharee.name).toBe('Acme Inc');

    const del = await handleDeleteSharee(new Request('https://x', { method: 'DELETE' }), e, admin, WS, sharee.id);
    expect(del.status).toBe(200);
    expect((await handleGetSharee(new Request('https://x'), e, admin, WS, sharee.id)).status).toBe(404);
  });

});

describe('sharee members', () => {
  beforeEach(async () => {
    await e.DB.exec(`INSERT INTO sharees (id, workspace_id, name, slug, type, created_by) VALUES ('S1','${WS}','Client','client','client','usr_admin')`);
  });

  it('validates email and lists members', async () => {
    expect((await handleAddShareeMember(jsonReq({ email: 'nope' }), e, admin, WS, 'S1')).status).toBe(400);
    expect((await handleListShareeMembers(new Request('https://x'), e, member, WS, 'S1')).status).toBe(403);

    const add = await handleAddShareeMember(jsonReq({ email: 'ext@client.com' }), e, admin, WS, 'S1');
    expect(add.status).toBe(201);
    expect(inviteOrAddMember).toHaveBeenCalled();

    // Pre-create user so list join works
    await e.DB.exec(`INSERT INTO users (id, email, name) VALUES ('usr_ext','ext@client.com','Ext')`);
    await e.DB.exec(`UPDATE sharee_members SET user_id='usr_ext' WHERE email='ext@client.com'`);

    const list = await handleListShareeMembers(new Request('https://x'), e, admin, WS, 'S1');
    expect(list.status).toBe(200);
    const { members } = await list.json() as { members: { email: string }[] };
    expect(members.some(m => m.email === 'ext@client.com')).toBe(true);

    const rm = await handleRemoveShareeMember(new Request('https://x'), e, admin, WS, 'S1', 'usr_ext');
    expect(rm.status).toBe(200);
  });

  it('404s members ops on unknown sharee', async () => {
    const res = await handleAddShareeMember(jsonReq({ email: 'a@b.com' }), e, admin, WS, 'missing');
    expect(res.status).toBe(404);
  });
});
