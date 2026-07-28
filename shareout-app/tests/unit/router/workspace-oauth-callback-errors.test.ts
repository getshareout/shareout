// Workspace connector OAuth callback error handling — HTML pages, no internal leaks.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const getAuthUrl = vi.hoisted(() => vi.fn());
const handleCallback = vi.hoisted(() => vi.fn());
const hasProvider = vi.hoisted(() => vi.fn());
const getProvider = vi.hoisted(() => vi.fn());
const listProviders = vi.hoisted(() => vi.fn());
const encryptCredentials = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());

vi.mock('../../../src/data/platform', () => ({
  hasProvider,
  getProvider,
  listProviders,
}));

vi.mock('../../../src/data/connections/credentials', () => ({
  encryptCredentials,
}));

vi.mock('../../../src/logging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/logging')>();
  return { ...actual, logError };
});

import {
  handleWorkspaceOAuthCallback,
} from '../../../src/router/api/workspace-connections/oauth';
import { handleSlackOAuthCallback } from '../../../src/router/api/workspace-connections/slack';

const e = env as unknown as Env;
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
  await e.DB.exec('DELETE FROM connections');
  logError.mockReset();
  hasProvider.mockReset().mockReturnValue(true);
  handleCallback.mockReset().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', expiresAt: null });
  encryptCredentials.mockReset().mockResolvedValue({ encrypted: 'enc', iv: 'iv' });
  getProvider.mockReset().mockReturnValue({
    id: 'google-sheets',
    getAuthUrl,
    handleCallback,
  });
  (e as { CREDENTIALS_KEY?: string }).CREDENTIALS_KEY = 'test-key-32-chars-long-enough!!';
});

function workspaceCallbackReq(qs: string) {
  return new Request(`https://shareout.site/v1/workspaces/${WS}/connections/google-sheets/callback?${qs}`);
}

function slackCallbackReq(qs: string) {
  return new Request(`https://shareout.site/v1/oauth/slack/callback?${qs}`);
}

function validState(overrides: Partial<{ workspaceId: string; connectionName: string; returnUrl: string }> = {}) {
  return btoa(JSON.stringify({
    workspaceId: WS,
    connectionName: 'main',
    returnUrl: '',
    ...overrides,
  }));
}

describe('handleWorkspaceOAuthCallback error handling', () => {
  it('returns HTML denial page for OAuth error query param', async () => {
    const res = await handleWorkspaceOAuthCallback(
      workspaceCallbackReq('error=access_denied&error_description=User%20denied'),
      e,
      WS,
      'google-sheets',
      'usr_admin',
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toMatch(/html/);
    const html = await res.text();
    expect(html).toMatch(/User denied/);
    expect(html).toMatch(/shareout:workspace:connection:error/);
    expect(html).not.toMatch(/D1_ERROR/);
  });

  it('returns HTML error when handleCallback throws — no internal leak', async () => {
    handleCallback.mockRejectedValueOnce(new Error('invalid_grant: Token has been expired or revoked'));
    const res = await handleWorkspaceOAuthCallback(
      workspaceCallbackReq(`code=authcode&state=${encodeURIComponent(validState())}`),
      e,
      WS,
      'google-sheets',
      'usr_admin',
    );
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toMatch(/Google Sheets authorization failed/);
    expect(html).not.toMatch(/invalid_grant/);
    expect(html).not.toMatch(/revoked/);
    expect(logError).toHaveBeenCalled();
  });

  it('returns HTML error when credential persistence throws — no D1 leak', async () => {
    encryptCredentials.mockRejectedValueOnce(new Error('D1_ERROR: no such table: workspace_connections'));
    const res = await handleWorkspaceOAuthCallback(
      workspaceCallbackReq(`code=authcode&state=${encodeURIComponent(validState())}`),
      e,
      WS,
      'google-sheets',
      'usr_admin',
    );
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toMatch(/authorization failed/i);
    expect(html).not.toMatch(/D1_ERROR/);
    expect(html).not.toMatch(/no such table/);
    expect(logError).toHaveBeenCalled();
  });

  it('returns HTML validation error for state workspace mismatch', async () => {
    const res = await handleWorkspaceOAuthCallback(
      workspaceCallbackReq(`code=c&state=${encodeURIComponent(validState({ workspaceId: 'other' }))}`),
      e,
      WS,
      'google-sheets',
      'usr_admin',
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toMatch(/html/);
    expect(await res.text()).toMatch(/mismatch/i);
  });
});

describe('handleSlackOAuthCallback error handling', () => {
  beforeEach(() => {
    getProvider.mockReset().mockReturnValue({
      id: 'slack',
      getAuthUrl,
      handleCallback,
    });
  });

  it('returns HTML error when handleCallback throws — no Slack internals leak', async () => {
    handleCallback.mockRejectedValueOnce(new Error('Slack token exchange failed: invalid_code'));
    const res = await handleSlackOAuthCallback(
      slackCallbackReq(`code=authcode&state=${encodeURIComponent(validState())}`),
      e,
      'usr_admin',
    );
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toMatch(/Slack authorization failed/);
    expect(html).not.toMatch(/invalid_code/);
    expect(logError).toHaveBeenCalled();
  });

  it('returns HTML success with connected postMessage', async () => {
    const res = await handleSlackOAuthCallback(
      slackCallbackReq(`code=authcode&state=${encodeURIComponent(validState())}`),
      e,
      'usr_admin',
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/shareout:workspace:connection:connected/);
    expect(html).toMatch(/Slack connected successfully/);
  });
});
