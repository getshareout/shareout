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
import { DRIVE_FILE_CONSENT } from '../../../src/file-imports/types';

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

describe('sheet sync consent: drive.file + the Google Picker', () => {
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const ORIGIN = 'https://ra-ws.shareout.test';
  const pickState = (u = MEMBER) => signState(e, { p: DRIVE_FILE_CONSENT, ws: WS, u, o: ORIGIN });
  const sheetRow = (u = MEMBER) => e.DB.prepare('SELECT provider, account_email, scopes FROM file_import_connections WHERE workspace_id = ? AND user_id = ? AND provider = ?')
    .bind(WS, u, DRIVE_FILE_CONSENT).first();
  const tokens = (u: string) => ({ accessToken: `${u}-a`, refreshToken: `${u}-r`, expiresAt: new Date(Date.now() + 3600_000).toISOString(), scope: 's' });
  /** Google stubbed: the token endpoint, Drive about + files.get, and revoke (recorded). */
  function google(files: Record<string, { name: string; mimeType: string }>, calls: string[] = []) {
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      calls.push(`${init?.method || 'GET'} ${url.origin}${url.pathname}`);
      if (url.href === 'https://oauth2.googleapis.com/token') {
        return Response.json({ access_token: 'f-access', refresh_token: 'f-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' });
      }
      if (url.href === 'https://oauth2.googleapis.com/revoke') return new Response('');
      if (url.pathname === '/drive/v3/about') return Response.json({ user: { emailAddress: 'member@drive.test' } });
      const f = files[url.pathname.replace('/drive/v3/files/', '')];
      return f ? Response.json({ id: url.pathname.split('/').pop(), modifiedTime: '2026-11-18T10:00:00.000Z', ...f }) : Response.json({ error: { message: 'nf' } }, { status: 404 });
    }));
    return calls;
  }

  it('pick sends the person to Google for drive.file only, with the Picker in the consent', async () => {
    as(MEMBER);
    const res = await call(`/v1/workspaces/${WS}/file-imports/sheet-sync/pick`);
    expect(res?.status).toBe(302);
    const loc = new URL(res!.headers.get('Location')!);
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const p = Object.fromEntries(loc.searchParams);
    expect(p).toMatchObject({
      client_id: 'gid', scope: 'https://www.googleapis.com/auth/drive.file', response_type: 'code',
      access_type: 'offline', prompt: 'consent', trigger_onepick: 'true', code_challenge_method: 'S256',
    });
    expect(p.scope).not.toContain('drive.readonly');
    expect(p.allow_multiple).toBeUndefined();
    expect(p.mimetypes.split(',')).toEqual(expect.arrayContaining([XLSX_MIME, 'application/vnd.google-apps.spreadsheet', 'text/csv']));
    // Same redirect URI as the folder import: nothing new to register at Google.
    expect(p.redirect_uri).toMatch(/\/v1\/file-imports\/oauth\/google_drive\/callback$/);
    const claims = JSON.parse(atob(p.state.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    expect(claims).toMatchObject({ p: DRIVE_FILE_CONSENT, ws: WS, u: MEMBER, o: 'https://shareout.test' });
  });

  it('a pasted link narrows the Picker to that file; anything else is refused', async () => {
    as(MEMBER);
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    const res = await call(`/v1/workspaces/${WS}/file-imports/sheet-sync/pick?file=${id}`);
    expect(new URL(res!.headers.get('Location')!).searchParams.get('file_ids')).toBe(id);
    expect((await call(`/v1/workspaces/${WS}/file-imports/sheet-sync/pick?file=${encodeURIComponent('../x')}`))?.status).toBe(400);
  });

  it('uses its own OAuth client when the instance sets one; external members are denied', async () => {
    Object.assign(e, { GOOGLE_DRIVE_FILE_CLIENT_ID: 'fid', GOOGLE_DRIVE_FILE_CLIENT_SECRET: 'fsecret' });
    as(MEMBER);
    const res = await call(`/v1/workspaces/${WS}/file-imports/sheet-sync/pick`);
    expect(new URL(res!.headers.get('Location')!).searchParams.get('client_id')).toBe('fid');
    Object.assign(e, { GOOGLE_DRIVE_FILE_CLIENT_ID: undefined, GOOGLE_DRIVE_FILE_CLIENT_SECRET: undefined });
    as(EXT);
    expect((await call(`/v1/workspaces/${WS}/file-imports/sheet-sync/pick`))?.status).toBe(403);
  });

  it('the callback stores the drive.file consent apart and posts the pick to the opening origin only', async () => {
    as(MEMBER);
    google({ XL1: { name: 'Sales </script><script>alert(1)</script>.xlsx', mimeType: XLSX_MIME } });
    const res = await call(`/v1/file-imports/oauth/google_drive/callback?code=c&picked_file_ids=XL1&scope=x&state=${encodeURIComponent(await pickState())}`);
    vi.unstubAllGlobals();
    expect(res?.status).toBe(200);
    const html = await res!.text();
    expect(html).toContain(`postMessage({"type":"shareout:drive-sheet:picked","ok":true,"file":{"id":"XL1","name":"Sales \\u003c/script>\\u003cscript>alert(1)\\u003c/script>.xlsx"},"error":null}, "${ORIGIN}")`);
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain("'*'");
    expect(await sheetRow()).toEqual({ provider: DRIVE_FILE_CONSENT, account_email: 'member@drive.test', scopes: 'https://www.googleapis.com/auth/drive.file' });
    // The folder-import overview does not show it as a Drive connection.
    const ov = await (await call(`/v1/workspaces/${WS}/file-imports`))!.json() as { providers: Array<{ id: string; connected: boolean }> };
    expect(ov.providers).toEqual([{ id: 'google_drive', connected: false, accountEmail: null }]);
    expect(await (await call(`/v1/workspaces/${WS}/file-imports/sheet-sync`))!.json()).toEqual({ available: true, connected: true, accountEmail: 'member@drive.test' });
  });

  it('refuses a non-spreadsheet, a cancelled picker, and a state minted for someone else', async () => {
    as(MEMBER);
    google({ DOC1: { name: 'Notes', mimeType: 'application/vnd.google-apps.document' } });
    let res = await call(`/v1/file-imports/oauth/google_drive/callback?code=c&picked_file_ids=DOC1&state=${encodeURIComponent(await pickState())}`);
    expect(res?.status).toBe(400);
    expect(await res!.text()).toContain('&quot;Notes&quot; is not a spreadsheet');
    res = await call(`/v1/file-imports/oauth/google_drive/callback?error=access_denied&state=${encodeURIComponent(await pickState())}`);
    expect(res?.status).toBe(400);
    expect(await res!.text()).toContain('"ok":false,"file":null,"error":"No spreadsheet was picked."');
    as(ADMIN);
    res = await call(`/v1/file-imports/oauth/google_drive/callback?code=c&picked_file_ids=DOC1&state=${encodeURIComponent(await pickState(MEMBER))}`);
    expect(await res!.text()).toContain('Sign in to ShareOut as the person who started this.');
    vi.unstubAllGlobals();
  });

  it('disconnect forgets only the sheet consent, and Google is revoked only for the last Google consent', async () => {
    await saveConnection(e, WS, MEMBER, 'google_drive', tokens('ro'), 'member@drive.test');
    await saveConnection(e, WS, MEMBER, DRIVE_FILE_CONSENT, tokens('df'), 'member@drive.test');
    as(MEMBER);
    // A revoke is project-wide at Google: it would also end the folder import's consent.
    let calls = google({});
    expect((await call(`/v1/workspaces/${WS}/file-imports/sheet-sync/connection`, 'DELETE'))?.status).toBe(200);
    expect(calls.filter((c) => c.includes('/revoke'))).toEqual([]);
    expect(await sheetRow()).toBeNull();
    expect(await (await call(`/v1/workspaces/${WS}/file-imports/sheet-sync`))!.json()).toMatchObject({ connected: false });
    expect((await call(`/v1/workspaces/${WS}/file-imports/sheet-sync/connection`, 'DELETE'))?.status).toBe(404);
    // The folder import's consent was the last one: now Google is told.
    calls = google({});
    expect((await call(`/v1/workspaces/${WS}/file-imports/connections/google_drive`, 'DELETE'))?.status).toBe(200);
    expect(calls.filter((c) => c.includes('/revoke'))).toEqual(['POST https://oauth2.googleapis.com/revoke']);
    // And the other way round: dropping the folder import keeps a live sheet consent working.
    await saveConnection(e, WS, MEMBER, 'google_drive', tokens('ro'), 'member@drive.test');
    await saveConnection(e, WS, MEMBER, DRIVE_FILE_CONSENT, tokens('df'), 'member@drive.test');
    calls = google({});
    expect((await call(`/v1/workspaces/${WS}/file-imports/connections/google_drive`, 'DELETE'))?.status).toBe(200);
    expect(calls.filter((c) => c.includes('/revoke'))).toEqual([]);
    expect(await sheetRow()).toMatchObject({ provider: DRIVE_FILE_CONSENT });
    await e.DB.prepare('DELETE FROM file_import_connections WHERE workspace_id = ? AND user_id = ?').bind(WS, MEMBER).run();
    vi.unstubAllGlobals();
  });

  it('with a separate OAuth client (its own Cloud project) each disconnect revokes its own grant at Google', async () => {
    Object.assign(e, { GOOGLE_DRIVE_FILE_CLIENT_ID: 'fid', GOOGLE_DRIVE_FILE_CLIENT_SECRET: 'fsecret' });
    await saveConnection(e, WS, MEMBER, 'google_drive', tokens('ro'), 'member@drive.test');
    await saveConnection(e, WS, MEMBER, DRIVE_FILE_CONSENT, tokens('df'), 'member@drive.test');
    as(MEMBER);
    // The other consent is on another client, so it is not cut by this revoke: tell Google.
    let calls = google({});
    expect((await call(`/v1/workspaces/${WS}/file-imports/sheet-sync/connection`, 'DELETE'))?.status).toBe(200);
    expect(calls.filter((c) => c.includes('/revoke'))).toEqual(['POST https://oauth2.googleapis.com/revoke']);
    await saveConnection(e, WS, MEMBER, DRIVE_FILE_CONSENT, tokens('df'), 'member@drive.test');
    calls = google({});
    expect((await call(`/v1/workspaces/${WS}/file-imports/connections/google_drive`, 'DELETE'))?.status).toBe(200);
    expect(calls.filter((c) => c.includes('/revoke'))).toEqual(['POST https://oauth2.googleapis.com/revoke']);
    expect(await sheetRow()).toMatchObject({ provider: DRIVE_FILE_CONSENT });
    // The same consent in another workspace goes through the same client: no revoke.
    await e.DB.prepare("INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_rm2', ?, ?, 'member')").bind(WS2, MEMBER).run();
    await saveConnection(e, WS2, MEMBER, DRIVE_FILE_CONSENT, tokens('df2'), 'member@drive.test');
    calls = google({});
    expect((await call(`/v1/workspaces/${WS}/file-imports/sheet-sync/connection`, 'DELETE'))?.status).toBe(200);
    expect(calls.filter((c) => c.includes('/revoke'))).toEqual([]);
    Object.assign(e, { GOOGLE_DRIVE_FILE_CLIENT_ID: undefined, GOOGLE_DRIVE_FILE_CLIENT_SECRET: undefined });
    vi.unstubAllGlobals();
  });
});
