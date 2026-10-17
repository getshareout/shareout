// Folder import API authz and shape: who may import, workspace isolation, no tokens
// in responses, and the OAuth callback binding the consent to the right person.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', async (orig) => ({ ...(await orig<object>()), validateToken }));
vi.mock('../../../src/auth/session', async (orig) => ({ ...(await orig<object>()), getSessionUser }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { routeFileImportApi } from '../../../src/file-imports/routes';
import { createFetchContext } from '../../../src/router/context';
import { saveConnection } from '../../../src/file-imports/connections';
import { signState } from '../../../src/file-imports/oauth';

const ADMIN = 'usr_ra';
const MEMBER = 'usr_rm';
const EXT = 'usr_rx';
const OTHER = 'usr_ro';
const WS = 'wsp_ra';
const WS2 = 'wsp_rb';

beforeAll(async () => {
  await applyMigrations();
  Object.assign(e, {
    CREDENTIALS_KEY: 'test-credentials-key-0123456789ab',
    GOOGLE_DRIVE_CLIENT_ID: 'gid', GOOGLE_DRIVE_CLIENT_SECRET: 'gsecret',
  });
  const users = [ADMIN, MEMBER, EXT, OTHER];
  await e.DB.batch([
    ...users.map((u) => e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(u, `${u}@example.com`, u)),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'A', 'ra-ws', ADMIN),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS2, 'B', 'rb-ws', OTHER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_ra', ?, ?, 'admin')").bind(WS, ADMIN),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_rm', ?, ?, 'member')").bind(WS, MEMBER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_rx', ?, ?, 'member', 'external')").bind(WS, EXT),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_ro', ?, ?, 'owner')").bind(WS2, OTHER),
    e.DB.prepare(`INSERT INTO file_import_sources (id, workspace_id, provider, remote_folder_id, remote_name, created_by) VALUES ('fis_b', ?, 'google_drive', 'X', 'B stuff', ?)`).bind(WS2, OTHER),
  ]);
  await saveConnection(e, WS, ADMIN, 'google_drive', { accessToken: 'secret-access', refreshToken: 'secret-refresh', expiresAt: new Date(Date.now() + 3600_000).toISOString(), scope: 's' }, 'admin@drive.test');
});

beforeEach(() => { validateToken.mockReset().mockResolvedValue(null); });
const as = (id: string) => getSessionUser.mockReset().mockResolvedValue({ id, email: `${id}@example.com` });
const call = (path: string, method = 'GET', body?: unknown) =>
  routeFileImportApi(createFetchContext(new Request(`https://shareout.test${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual',
  }), e));

describe('file import authz', () => {
  it('admins see providers and their connection, never the tokens', async () => {
    as(ADMIN);
    const res = await call(`/v1/workspaces/${WS}/file-imports`);
    expect(res?.status).toBe(200);
    const text = await res!.text();
    expect(text).not.toContain('secret-access');
    expect(text).not.toContain('secret-refresh');
    expect(JSON.parse(text).providers).toEqual([{ id: 'google_drive', connected: true, accountEmail: 'admin@drive.test' }]);
  });

  it('members (editors) may import while members may create folders', async () => {
    as(MEMBER);
    expect((await call(`/v1/workspaces/${WS}/file-imports`))?.status).toBe(200);
    await e.DB.prepare('UPDATE workspaces SET member_folders_enabled = 0 WHERE id = ?').bind(WS).run();
    const res = await call(`/v1/workspaces/${WS}/file-imports`);
    expect(res?.status).toBe(403);
    expect(((await res!.json()) as { code: string }).code).toBe('IMPORT_NOT_ALLOWED');
    await e.DB.prepare('UPDATE workspaces SET member_folders_enabled = 1 WHERE id = ?').bind(WS).run();
  });

  it('external members (viewers) are denied', async () => {
    as(EXT);
    expect((await call(`/v1/workspaces/${WS}/file-imports`))?.status).toBe(403);
    expect((await call(`/v1/workspaces/${WS}/file-imports/connect/google_drive`))?.status).toBe(403);
  });

  it('another workspace is out of reach', async () => {
    as(ADMIN);
    expect((await call(`/v1/workspaces/${WS2}/file-imports`))?.status).toBe(403);
    expect((await call(`/v1/workspaces/${WS}/file-imports/sources/fis_b/sync`, 'POST'))?.status).toBe(404);
    expect((await call(`/v1/workspaces/${WS}/file-imports/sources/fis_b`, 'DELETE'))?.status).toBe(404);
  });

  it('connect redirects to Google with a signed state; unconfigured providers 404', async () => {
    as(ADMIN);
    const res = await call(`/v1/workspaces/${WS}/file-imports/connect/google_drive`);
    expect(res?.status).toBe(302);
    expect(new URL(res!.headers.get('Location')!).hostname).toBe('accounts.google.com');
    expect((await call(`/v1/workspaces/${WS}/file-imports/connect/microsoft`))?.status).toBe(404);
  });

  it('the callback refuses a state minted for someone else', async () => {
    const state = await signState(e, { p: 'google_drive', ws: WS, u: MEMBER });
    as(ADMIN);
    const res = await call(`/v1/file-imports/oauth/google_drive/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(res?.status).toBe(400);
    expect(await res!.text()).toContain('Sign in to ShareOut as the person who started this connection');
  });

  it('the callback stores the consent for the signed-in person', async () => {
    const state = await signState(e, { p: 'google_drive', ws: WS, u: MEMBER });
    as(MEMBER);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        const body = String(init?.body);
        expect(body).toContain('code_verifier=');
        expect(body).toContain('client_secret=gsecret');
        return Response.json({ access_token: 'm-access', refresh_token: 'm-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.readonly' });
      }
      return Response.json({ user: { emailAddress: 'member@drive.test' } });
    }));
    const res = await call(`/v1/file-imports/oauth/google_drive/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(res?.status).toBe(200);
    const row = await e.DB.prepare('SELECT account_email FROM file_import_connections WHERE workspace_id = ? AND user_id = ?').bind(WS, MEMBER).first();
    expect(row).toEqual({ account_email: 'member@drive.test' });
    vi.unstubAllGlobals();
  });

  it('disconnect removes only my own connection', async () => {
    as(MEMBER);
    expect((await call(`/v1/workspaces/${WS}/file-imports/connections/google_drive`, 'DELETE'))?.status).toBe(200);
    const left = await e.DB.prepare('SELECT user_id FROM file_import_connections WHERE workspace_id = ?').bind(WS).all();
    expect(left.results).toEqual([{ user_id: ADMIN }]);
  });
});
