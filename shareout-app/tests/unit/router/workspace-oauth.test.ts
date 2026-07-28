// P1 robustness: workspace connector OAuth URL + callback guards.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';

const getAuthUrl = vi.hoisted(() => vi.fn());
const handleCallback = vi.hoisted(() => vi.fn());
const hasProvider = vi.hoisted(() => vi.fn());
const getProvider = vi.hoisted(() => vi.fn());
const listProviders = vi.hoisted(() => vi.fn());

vi.mock('../../../src/data/platform', () => ({
  hasProvider,
  getProvider,
  listProviders,
}));

vi.mock('../../../src/data/connections/credentials', () => ({
  encryptCredentials: vi.fn().mockResolvedValue('enc'),
}));

import {
  handleWorkspaceOAuthUrl,
  handleWorkspaceOAuthCallback,
} from '../../../src/router/api/workspace-connections/oauth';

const e = env as unknown as Env;
const admin: AuthUser = { id: 'usr_admin', email: 'a@x.com', username: null };
const member: AuthUser = { id: 'usr_member', email: 'm@x.com', username: null };
const WS = 'wsp_oauth';

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, slug TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspace_members (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, role TEXT, member_class TEXT NOT NULL DEFAULT 'internal')`,
    `CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'generic', provider TEXT NOT NULL, auth_type TEXT, config TEXT NOT NULL DEFAULT '{}', encrypted_credentials TEXT, iv TEXT, expires_at TEXT, preferred_mode TEXT NOT NULL DEFAULT 'auto', cache_ttl_seconds INTEGER NOT NULL DEFAULT 300, rate_limit_rpm INTEGER NOT NULL DEFAULT 60, is_private INTEGER NOT NULL DEFAULT 0, credential_scope TEXT NOT NULL DEFAULT 'shared', agent_query_enabled INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(scope_type, scope_id, name))`,
  ]) await e.DB.exec(sql);
});

beforeEach(async () => {
  for (const t of ['connections', 'workspace_members', 'workspaces', 'users']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
  await e.DB.exec(`INSERT INTO users (id, email) VALUES ('usr_admin','a@x.com'),('usr_member','m@x.com')`);
  await e.DB.exec(`INSERT INTO workspaces (id, name, owner_id, slug) VALUES ('${WS}','W','usr_admin','w')`);
  await e.DB.exec(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('m1','${WS}','usr_admin','admin','internal'),('m2','${WS}','usr_member','member','internal')`);

  hasProvider.mockReset().mockReturnValue(true);
  listProviders.mockReset().mockReturnValue([{ id: 'google-sheets' }]);
  getAuthUrl.mockReset().mockResolvedValue('https://accounts.google.com/o/oauth2/v2/auth?x=1');
  handleCallback.mockReset().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', expiresAt: null });
  getProvider.mockReset().mockReturnValue({
    id: 'google-sheets',
    getAuthUrl,
    handleCallback,
  });
});

function authUrlReq(qs = 'connection=main') {
  return new Request(`https://shareout.site/v1/workspaces/${WS}/connections/google-sheets/auth-url?${qs}`);
}

function callbackReq(qs: string) {
  return new Request(`https://shareout.site/v1/workspaces/${WS}/connections/google-sheets/callback?${qs}`);
}

describe('handleWorkspaceOAuthUrl', () => {
  it('403s non-admins', async () => {
    const res = await handleWorkspaceOAuthUrl(authUrlReq(), e, member, WS, 'google-sheets');
    expect(res.status).toBe(403);
  });

  it('404s unknown providers', async () => {
    hasProvider.mockReturnValueOnce(false);
    const res = await handleWorkspaceOAuthUrl(authUrlReq(), e, admin, WS, 'nope');
    expect(res.status).toBe(404);
    expect((await res.json() as { code: string }).code).toBe('PROVIDER_NOT_FOUND');
  });

  it('400s missing/invalid connection name', async () => {
    expect((await handleWorkspaceOAuthUrl(authUrlReq(''), e, admin, WS, 'google-sheets')).status).toBe(400);
    expect((await handleWorkspaceOAuthUrl(authUrlReq('connection=bad name!'), e, admin, WS, 'google-sheets')).status).toBe(400);
  });

  it('returns authUrl for admins', async () => {
    const res = await handleWorkspaceOAuthUrl(authUrlReq('connection=main&returnUrl=/home'), e, admin, WS, 'google-sheets');
    expect(res.status).toBe(200);
    const body = await res.json() as { authUrl: string };
    expect(body.authUrl).toContain('accounts.google.com');
    expect(getAuthUrl).toHaveBeenCalled();
  });
});

describe('handleWorkspaceOAuthCallback', () => {
  it('404s unknown provider', async () => {
    hasProvider.mockReturnValueOnce(false);
    const res = await handleWorkspaceOAuthCallback(callbackReq('code=c&state=x'), e, WS, 'nope', 'usr_admin');
    expect(res.status).toBe(404);
  });

  it('400s missing code/state and invalid state', async () => {
    expect((await handleWorkspaceOAuthCallback(callbackReq(''), e, WS, 'google-sheets', 'usr_admin')).status).toBe(400);
    expect((await handleWorkspaceOAuthCallback(callbackReq('code=c&state=!!!'), e, WS, 'google-sheets', 'usr_admin')).status).toBe(400);
  });

  it('400s state workspace mismatch', async () => {
    const state = btoa(JSON.stringify({ workspaceId: 'other', connectionName: 'main', returnUrl: '' }));
    const res = await handleWorkspaceOAuthCallback(
      callbackReq(`code=c&state=${encodeURIComponent(state)}`),
      e,
      WS,
      'google-sheets',
      'usr_admin',
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toMatch(/html/);
    expect(await res.text()).toMatch(/mismatch/i);
  });

  it('exchanges code and returns connected HTML', async () => {
    const state = btoa(JSON.stringify({ workspaceId: WS, connectionName: 'main', returnUrl: '' }));
    const res = await handleWorkspaceOAuthCallback(
      callbackReq(`code=authcode&state=${encodeURIComponent(state)}`),
      e,
      WS,
      'google-sheets',
      'usr_admin',
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/html/);
    expect(handleCallback).toHaveBeenCalled();
    const html = await res.text();
    expect(html).toMatch(/Connected|opener|postMessage/i);
  });
});
