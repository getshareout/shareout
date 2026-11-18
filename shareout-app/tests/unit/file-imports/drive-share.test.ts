// Google Drive import through sharing: one service account per workspace, isolation
// enforced by Google's ACLs (faked per account in share-fakes.ts), a clear error when a
// workspace cannot get its own account (never a shared one), the run loader reading
// only through the source's own workspace account, and the sweep for deleted workspaces.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
const queueKnowledgeSource = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../../src/api-auth', async (orig) => ({ ...(await orig<object>()), validateToken }));
vi.mock('../../../src/auth/session', async (orig) => ({ ...(await orig<object>()), getSessionUser }));
vi.mock('../../../src/knowledge/corpus/ingest', () => ({ queueKnowledgeSource }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { routeFileImportApi } from '../../../src/file-imports/routes';
import { createFetchContext } from '../../../src/router/context';
import { createRun, readRun, type SourceRow } from '../../../src/file-imports/runs';
import { loadActive, runImport } from '../../../src/file-imports/sync';
import { runDueFileImports } from '../../../src/file-imports/schedule';
import { timing } from '../../../src/file-imports/http';
import { DEFAULT_LIMITS } from '../../../src/file-imports/types';
import {
  ShareAccountError, ensureServiceAccount, minterKey, resetServiceAccountCaches, serviceAccountFor, signJwt,
  sweepOrphanedServiceAccounts, workspaceDriveToken,
} from '../../../src/file-imports/service-account';
import { driveIdFromLink } from '../../../src/file-imports/providers/google-shared';
import { fakeGoogleShare, testMinterKey, type ShareLog, type SharedFakeFile } from './share-fakes';

const A_ADMIN = 'usr_sa';
const B_OWNER = 'usr_sb';
const WS_A = 'wsp_sa';
const WS_B = 'wsp_sb';
const WS_GONE = 'wsp_sgone';
let KEY = '';

beforeAll(async () => {
  await applyMigrations();
  KEY = await testMinterKey();
  Object.assign(e, {
    CREDENTIALS_KEY: 'test-credentials-key-0123456789ab',
    GOOGLE_DRIVE_CLIENT_ID: 'gid', GOOGLE_DRIVE_CLIENT_SECRET: 'gsecret',
    GOOGLE_DRIVE_SA_KEY: KEY,
  });
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(A_ADMIN, 'a@example.com', 'A'),
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(B_OWNER, 'b@example.com', 'B'),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS_A, 'A', 'sa-ws', A_ADMIN),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS_B, 'B', 'sb-ws', B_OWNER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_sa', ?, ?, 'admin')").bind(WS_A, A_ADMIN),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_sb', ?, ?, 'owner')").bind(WS_B, B_OWNER),
  ]);
});

let log: ShareLog;
let accounts: Set<string>;
let files: SharedFakeFile[];
let createFails: ((id: string) => Response | null) | undefined;

function stubGoogle() {
  vi.stubGlobal('fetch', vi.fn(fakeGoogleShare(files, log, { accounts, createFails })));
}

beforeEach(() => {
  resetServiceAccountCaches();
  log = { created: [], deleted: [], minted: [], drive: [] };
  accounts = new Set();
  files = [];
  createFails = undefined;
  validateToken.mockReset().mockResolvedValue(null);
  vi.spyOn(timing, 'sleep').mockResolvedValue();
  stubGoogle();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await e.DB.batch([
    e.DB.prepare('DELETE FROM file_import_sources'),
    e.DB.prepare('DELETE FROM file_import_service_accounts'),
  ]);
});

const as = (id: string) => getSessionUser.mockReset().mockResolvedValue({ id, email: `${id}@example.com` });
const call = (path: string, method = 'GET', body?: unknown) =>
  routeFileImportApi(createFetchContext(new Request(`https://shareout.test${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual',
  }), e));
const share = async (ws: string, user: string): Promise<string> => {
  as(user);
  const res = await call(`/v1/workspaces/${ws}/file-imports/share/google_drive`, 'POST');
  expect(res?.status).toBe(200);
  return ((await res!.json()) as { shareEmail: string }).shareEmail;
};

describe('the instance key and JWT', () => {
  it('accepts a service-account JSON key and rejects anything else', () => {
    expect(minterKey(e)?.project_id).toBe('so-test-proj');
    expect(minterKey({ ...e, GOOGLE_DRIVE_SA_KEY: '{"client_email":"x"}' } as typeof e)).toBeNull();
    expect(minterKey({ ...e, GOOGLE_DRIVE_SA_KEY: 'not json' } as typeof e)).toBeNull();
  });

  it('signs an RS256 assertion for the token endpoint, valid for one hour', async () => {
    const jwt = await signJwt(minterKey(e)!, 'scope-x', Date.UTC(2026, 10, 18));
    const [h, p] = jwt.split('.').slice(0, 2).map((s) => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
    expect(h).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(p).toMatchObject({ iss: 'minter@so-test-proj.iam.gserviceaccount.com', scope: 'scope-x', aud: 'https://oauth2.googleapis.com/token' });
    expect(p.exp - p.iat).toBe(3600);
  });
});

describe('one service account per workspace', () => {
  it('creates the workspace account once, keyed to the workspace, with a Google-valid id', async () => {
    const a1 = await share(WS_A, A_ADMIN);
    const a2 = await share(WS_A, A_ADMIN);
    expect(a1).toBe(a2);
    expect(a1).toMatch(/^so-[0-9a-f]{20}@so-test-proj\.iam\.gserviceaccount\.com$/);
    expect(log.created).toEqual([a1]);
    const b = await share(WS_B, B_OWNER);
    expect(b).not.toBe(a1);
    expect((await serviceAccountFor(e, WS_A))?.status).toBe('ready');
  });

  it('a retry after a lost response reuses the claimed account (409 → read it back)', async () => {
    const row = await ensureServiceAccount(e, WS_A, A_ADMIN);
    await e.DB.prepare("UPDATE file_import_service_accounts SET status = 'creating' WHERE workspace_id = ?").bind(WS_A).run();
    const again = await ensureServiceAccount(e, WS_A, A_ADMIN);
    expect(again.email).toBe(row.email);
    expect(again.status).toBe('ready');
    expect(log.created).toEqual([row.email]);
  });

  it('at Google’s limit the workspace gets a clear error and no account at all — never a shared one', async () => {
    await share(WS_B, B_OWNER);
    createFails = () => new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }), { status: 429 });
    stubGoogle();
    as(A_ADMIN);
    const res = await call(`/v1/workspaces/${WS_A}/file-imports/share/google_drive`, 'POST');
    expect(res?.status).toBe(503);
    const body = await res!.json() as { code: string; error: string; shareEmail?: string };
    expect(body.code).toBe('SHARE_EMAIL_LIMIT');
    expect(body.error).toMatch(/limit/);
    expect(JSON.stringify(body)).not.toContain('@');
    // Nothing usable for A: its overview has no email, browsing refuses, and no token was minted for anyone.
    const ov = await (await call(`/v1/workspaces/${WS_A}/file-imports`))!.json() as { share: { shareEmail: string | null } };
    expect(ov.share).toEqual({ provider: 'google_drive', shareEmail: null });
    expect((await call(`/v1/workspaces/${WS_A}/file-imports/browse/google_drive?access=share&ref=root`))?.status).toBe(409);
    expect(log.minted).toEqual([]);
  });

  it('an undocumented limit answer ("maximum number") counts as the limit too; other failures say so', async () => {
    createFails = () => new Response(JSON.stringify({ error: { code: 400, message: 'Maximum number of service accounts on project reached.' } }), { status: 400 });
    stubGoogle();
    await expect(ensureServiceAccount(e, WS_A, A_ADMIN)).rejects.toMatchObject({ code: 'SHARE_EMAIL_LIMIT', status: 503 });
    createFails = () => new Response('boom', { status: 500 });
    stubGoogle();
    await expect(ensureServiceAccount(e, WS_A, A_ADMIN)).rejects.toMatchObject({ code: 'SHARE_EMAIL_FAILED' });
  });

  it('a token is minted only for the workspace’s own account, cached, and "not ready" while Google catches up', async () => {
    const sa = await ensureServiceAccount(e, WS_A, A_ADMIN);
    expect(await workspaceDriveToken(e, sa)).toBe(`tok:${sa.email}`);
    await workspaceDriveToken(e, sa);
    expect(log.minted).toEqual([sa.email]);
    accounts.delete(sa.email); // Google has not made it visible yet
    resetServiceAccountCaches();
    const err = await workspaceDriveToken(e, sa).catch((x) => x);
    expect(err).toBeInstanceOf(ShareAccountError);
    expect(err.code).toBe('SHARE_EMAIL_NOT_READY');
  });

  it('without the instance key nothing is created and sharing is refused, not borrowed', async () => {
    const saved = e.GOOGLE_DRIVE_SA_KEY;
    delete (e as { GOOGLE_DRIVE_SA_KEY?: string }).GOOGLE_DRIVE_SA_KEY;
    try {
      await expect(ensureServiceAccount(e, WS_A, A_ADMIN)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
      as(A_ADMIN);
      const ov = await (await call(`/v1/workspaces/${WS_A}/file-imports`))!.json() as { share: unknown; providers: unknown[] };
      expect(ov.share).toBeNull();
      expect(ov.providers).toEqual([{ id: 'google_drive', connected: false, accountEmail: null }]);
      expect((await call(`/v1/workspaces/${WS_A}/file-imports/browse/google_drive?access=share&ref=root`))?.status).toBe(404);
      expect((await call(`/v1/workspaces/${WS_A}/file-imports/sources`, 'POST', { provider: 'google_drive', access: 'share', ref: 'folder:-:FOLDER_A_000' }))?.status).toBe(404);
    } finally {
      e.GOOGLE_DRIVE_SA_KEY = saved;
    }
  });
});

describe('isolation through Google’s ACLs', () => {
  async function twoWorkspaces() {
    const a = await share(WS_A, A_ADMIN);
    const b = await share(WS_B, B_OWNER);
    files.push(
      { id: 'FOLDER_A_000', name: 'A reports', parent: 'root', folder: true, sharedWith: [a] },
      { id: 'FILE_A_00001', name: 'a.txt', parent: 'FOLDER_A_000', body: 'a' },
      { id: 'FOLDER_B_000', name: 'B payroll', parent: 'root', folder: true, sharedWith: [b] },
      { id: 'SUB_B_000000', name: 'B sub', parent: 'FOLDER_B_000', folder: true },
    );
    return { a, b };
  }

  it('the overview names the workspace\u2019s share email; the OAuth routes stay for the sheet sync', async () => {
    const { a } = await twoWorkspaces();
    as(A_ADMIN);
    const ov = await (await call(`/v1/workspaces/${WS_A}/file-imports`))!.json() as { share: unknown; providers: unknown[] };
    expect(ov.share).toEqual({ provider: 'google_drive', shareEmail: a });
    expect(ov.providers).toEqual([{ id: 'google_drive', connected: false, accountEmail: null }]);
    // The artifact sheet sync still connects and browses through OAuth: untouched by sharing.
    expect((await call(`/v1/workspaces/${WS_A}/file-imports/connect/google_drive`))?.status).toBe(302);
    expect(((await (await call(`/v1/workspaces/${WS_A}/file-imports/browse/google_drive?files=sheets&ref=root`))!.json()) as { code: string }).code).toBe('NOT_CONNECTED');
    expect(log.drive).toEqual([]);
  });

  it('"check access" lists only what was shared with this workspace', async () => {
    await twoWorkspaces();
    as(A_ADMIN);
    const d = await (await call(`/v1/workspaces/${WS_A}/file-imports/browse/google_drive?access=share&ref=root`))!.json() as { entries: Array<{ name: string; ref: string }> };
    expect(d.entries.map((x) => x.name)).toEqual(['A reports']);
    as(B_OWNER);
    const d2 = await (await call(`/v1/workspaces/${WS_B}/file-imports/browse/google_drive?access=share&ref=root`))!.json() as { entries: Array<{ name: string }> };
    expect(d2.entries.map((x) => x.name)).toEqual(['B payroll']);
  });

  it('workspace A cannot open, browse or import a folder shared with workspace B, even knowing its id', async () => {
    const { a, b } = await twoWorkspaces();
    as(A_ADMIN);
    const link = await call(`/v1/workspaces/${WS_A}/file-imports/browse/google_drive?access=share&link=${encodeURIComponent('https://drive.google.com/drive/folders/FOLDER_B_000?usp=sharing')}`);
    expect(link?.status).toBe(404);
    const body = await link!.json() as { code: string; error: string };
    expect(body.code).toBe('NOT_SHARED');
    expect(body.error).toContain(a);
    expect(body.error).not.toContain(b);
    const sub = await call(`/v1/workspaces/${WS_A}/file-imports/browse/google_drive?access=share&ref=${encodeURIComponent('folder:-:FOLDER_B_000')}`);
    expect(((await sub!.json()) as { entries: unknown[] }).entries).toEqual([]);
    const created = await call(`/v1/workspaces/${WS_A}/file-imports/sources`, 'POST', { provider: 'google_drive', access: 'share', ref: 'folder:-:FOLDER_B_000', name: 'stolen' });
    expect(created?.status).toBe(404);
    expect(await e.DB.prepare('SELECT COUNT(*) AS n FROM file_import_sources').first<{ n: number }>()).toEqual({ n: 0 });
    // Every Drive call A made carried A's own account, never B's.
    expect(log.drive.length).toBeGreaterThan(0);
    expect(log.drive.every((l) => l.startsWith(`${a} `))).toBe(true);
  });

  it('a pasted link of its own folder resolves; a file link asks for the folder', async () => {
    await twoWorkspaces();
    as(A_ADMIN);
    const ok = await (await call(`/v1/workspaces/${WS_A}/file-imports/browse/google_drive?access=share&link=${encodeURIComponent('https://drive.google.com/drive/u/0/folders/FOLDER_A_000')}`))!.json() as { entries: Array<{ ref: string }> };
    expect(ok.entries).toEqual([{ ref: 'folder:-:FOLDER_A_000', name: 'A reports', kind: 'folder', selectable: true }]);
    const file = await call(`/v1/workspaces/${WS_A}/file-imports/browse/google_drive?access=share&link=FILE_A_00001`);
    expect(((await file!.json()) as { code: string }).code).toBe('NOT_A_FOLDER');
  });

  it('imports its own folder as a shared-folder source, read with its own account', async () => {
    const { a } = await twoWorkspaces();
    as(A_ADMIN);
    const res = await call(`/v1/workspaces/${WS_A}/file-imports/sources`, 'POST', { provider: 'google_drive', access: 'share', ref: 'folder:-:FOLDER_A_000', name: 'A reports' });
    expect(res?.status).toBe(201);
    const { source, run } = await res!.json() as { source: { id: string; access: string; connected: boolean }; run: { id: string } };
    expect(source).toMatchObject({ access: 'share', connected: true });
    const row = await e.DB.prepare('SELECT auth, connection_id, remote_folder_id FROM file_import_sources WHERE id = ?').bind(source.id).first();
    expect(row).toEqual({ auth: 'service_account', connection_id: null, remote_folder_id: 'FOLDER_A_000' });
    const done = await readRun(e, WS_A, run.id);
    expect(done?.status).toBe('done');
    expect(done?.counts.imported).toBe(1);
    expect(log.drive.every((l) => l.startsWith(`${a} `))).toBe(true);
  });
});

describe('switching an OAuth source to sharing', () => {
  it('flips only once the folder is shared with this workspace, keeping the source (and its ledger)', async () => {
    const a = await share(WS_A, A_ADMIN);
    files.push({ id: 'OLD_FOLDER00', name: 'Old', parent: 'root', folder: true, sharedWith: [] });
    await e.DB.prepare(`INSERT INTO file_import_sources (id, workspace_id, connection_id, provider, remote_folder_id, remote_name, created_by)
      VALUES ('fis_old', ?, NULL, 'google_drive', 'OLD_FOLDER00', 'Old', ?)`).bind(WS_A, A_ADMIN).run();
    as(A_ADMIN);
    const ov = await (await call(`/v1/workspaces/${WS_A}/file-imports`))!.json() as { sources: Array<{ id: string; canSwitchToShare: boolean; access: string }> };
    expect(ov.sources[0]).toMatchObject({ id: 'fis_old', canSwitchToShare: true, access: 'oauth' });
    const early = await call(`/v1/workspaces/${WS_A}/file-imports/sources/fis_old`, 'PATCH', { access: 'share' });
    expect(early?.status).toBe(404);
    expect(((await early!.json()) as { code: string }).code).toBe('NOT_SHARED');
    files[files.length - 1].sharedWith = [a];
    const ok = await call(`/v1/workspaces/${WS_A}/file-imports/sources/fis_old`, 'PATCH', { access: 'share' });
    expect(ok?.status).toBe(200);
    expect(((await ok!.json()) as { source: { access: string; connected: boolean } }).source).toMatchObject({ access: 'share', connected: true });
    expect(await e.DB.prepare("SELECT auth, connection_id FROM file_import_sources WHERE id = 'fis_old'").first()).toEqual({ auth: 'service_account', connection_id: null });
  });
});

describe('runs of shared-folder sources', () => {
  async function sharedSource(ws: string, by: string, folder: string): Promise<SourceRow> {
    const id = `fis_s${Math.random().toString(16).slice(2, 10)}`;
    await e.DB.prepare(`INSERT INTO file_import_sources (id, workspace_id, connection_id, auth, provider, remote_folder_id, remote_name, convert_enabled, daily_sync_enabled, next_sync_at, created_by)
      VALUES (?, ?, NULL, 'service_account', 'google_drive', ?, 'Shared', 0, 1, ?, ?)`).bind(id, ws, folder, new Date(Date.now() - 60_000).toISOString(), by).run();
    return (await e.DB.prepare('SELECT * FROM file_import_sources WHERE id = ?').bind(id).first<SourceRow>())!;
  }

  it('the run loader reads only through the source’s own workspace account', async () => {
    await ensureServiceAccount(e, WS_A, A_ADMIN);
    const b = await ensureServiceAccount(e, WS_B, B_OWNER);
    const s = await sharedSource(WS_B, B_OWNER, 'FOLDER_B_000');
    const r = await createRun(e, s, 'manual', B_OWNER);
    if ('conflict' in r) throw new Error('conflict');
    const active = (await loadActive(e, r.runId, DEFAULT_LIMITS))!;
    expect(active.actorId).toBe(B_OWNER);
    expect(await active.token()).toBe(`tok:${b.email}`);
    expect(log.minted).toEqual([b.email]);
  });

  it('a folder that is no longer shared stops the run, saying which email to share it with', async () => {
    const a = await ensureServiceAccount(e, WS_A, A_ADMIN);
    files.push({ id: 'GONE_FOLDER0', name: 'Was shared', parent: 'root', folder: true, sharedWith: [] });
    const s = await sharedSource(WS_A, A_ADMIN, 'GONE_FOLDER0');
    const r = await createRun(e, s, 'manual', A_ADMIN);
    if ('conflict' in r) throw new Error('conflict');
    await runImport(e, r.runId);
    const run = await readRun(e, WS_A, r.runId);
    expect(run?.status).toBe('stopped');
    expect(run?.stopCode).toBe('NOT_SHARED');
    expect(run?.stopMessage).toContain(a.email);
  });

  it('a workspace with no account any more stops instead of borrowing one', async () => {
    await ensureServiceAccount(e, WS_A, A_ADMIN);
    const s = await sharedSource(WS_B, B_OWNER, 'FOLDER_B_000');
    const r = await createRun(e, s, 'manual', B_OWNER);
    if ('conflict' in r) throw new Error('conflict');
    expect(await loadActive(e, r.runId, DEFAULT_LIMITS)).toBeNull();
    expect((await readRun(e, WS_B, r.runId))?.stopCode).toBe('NOT_SHARED');
    expect(log.minted).toEqual([]);
  });

  it('daily sync picks shared-folder sources (they have no connection)', async () => {
    await ensureServiceAccount(e, WS_A, A_ADMIN);
    await sharedSource(WS_A, A_ADMIN, 'NOT_THERE_00');
    expect((await runDueFileImports(e)).started).toBe(1);
  });
});

describe('deleted workspaces', () => {
  it('the sweep deletes their account at Google, then the row; live workspaces are untouched', async () => {
    const live = await ensureServiceAccount(e, WS_A, A_ADMIN);
    await e.DB.prepare(`INSERT INTO file_import_service_accounts (workspace_id, account_id, project_id, email, status) VALUES (?, 'so-gone000000000000000', 'so-test-proj', 'so-gone000000000000000@so-test-proj.iam.gserviceaccount.com', 'ready')`).bind(WS_GONE).run();
    accounts.add('so-gone000000000000000@so-test-proj.iam.gserviceaccount.com');
    expect(await sweepOrphanedServiceAccounts(e)).toEqual({ deleted: 1 });
    expect(log.deleted).toEqual(['so-gone000000000000000@so-test-proj.iam.gserviceaccount.com']);
    expect(await serviceAccountFor(e, WS_GONE)).toBeNull();
    expect((await serviceAccountFor(e, WS_A))?.email).toBe(live.email);
  });
});

describe('Drive links', () => {
  it('reads folder, file and open links, and refuses other hosts', () => {
    expect(driveIdFromLink('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn?usp=sharing')).toBe('1AbCdEfGhIjKlMn');
    expect(driveIdFromLink('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMn/edit#gid=0')).toBe('1AbCdEfGhIjKlMn');
    expect(driveIdFromLink('https://drive.google.com/open?id=1AbCdEfGhIjKlMn')).toBe('1AbCdEfGhIjKlMn');
    expect(driveIdFromLink('https://evil.example.com/drive/folders/1AbCdEfGhIjKlMn')).toBeNull();
    expect(driveIdFromLink('http://drive.google.com/drive/folders/1AbCdEfGhIjKlMn')).toBeNull();
  });
});
