// What an agent can do with the spreadsheet syncs, through the real routes and the MCP tools:
// - an API token (real token row, real validateToken) on POST/PATCH/DELETE /v1/jobs, POST
//   /v1/jobs/{id}/run, the link check and the Drive sheet-sync routes, for public_sheet_sync and
//   drive_file_sync;
// - the private-file pick: the agent's token gets the link, the person opens it with their own
//   browser session (no token), Google comes back to the callback, and the agent reads the pick;
// - the MCP tools that wrap all of it. Real D1/R2 and scheduler; Google is an in-memory fetch stub.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

const getSessionUser = vi.hoisted(() => vi.fn());
vi.mock('../../../src/auth/session', async (orig) => ({ ...(await orig<object>()), getSessionUser }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';
import { createFetchContext } from '../../../src/router/context';
import { routeSchedulingApi } from '../../../src/router/api/scheduling';
import { routeSheetLinkApi } from '../../../src/router/api/sheet-links';
import { routeFileImportApi } from '../../../src/file-imports/routes';
import { saveConnection } from '../../../src/file-imports/connections';
import { DRIVE_FILE_CONSENT } from '../../../src/file-imports/types';
import { callTool } from '../../../src/mcp/tools';
import { cronFor, datasetSlug } from '../../../src/mcp/sheet-sync-tools';
import type { ToolContext } from '../../../src/mcp/tool-kit';

const OWNER = 'usr_ssa_owner';
const VIEWER = 'usr_ssa_viewer';
const OUTSIDER = 'usr_ssa_out';
const MEMBER = 'usr_ssa_member';
const WS = 'wsp_ssa';
const WS2 = 'wsp_ssa2';
const ART = 'art_ssa';
const TOKENS = { [OWNER]: 'so_' + '1'.repeat(64), [VIEWER]: 'so_' + '2'.repeat(64), [OUTSIDER]: 'so_' + '3'.repeat(64), [MEMBER]: 'so_' + '4'.repeat(64) };
const ORIGIN = 'https://shareout.test';

const SHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const LINK = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?usp=sharing`;
const EXPORT = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;
const CDN = `https://doc-08-4o-sheets.googleusercontent.com/export/a/b/1/2/*/${SHEET_ID}?format=xlsx`;
const DRIVE_FILE = '1DrIvEfIlEiDxxxxxxxxxxxxxxxxxxxxxx';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let sharing: 'public' | 'private' = 'public';
let googleCalls: string[] = [];

function book(tabs: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(tabs)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
const WORKBOOK = book({ Summary: [['Region', 'Sales'], ['North', 120], ['South', 80]], Raw: [['id'], [1], [2], [3]] });

/** Google: the public export, the OAuth token endpoint, Drive about / files.get / download. */
async function fakeGoogle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  googleCalls.push(`${init?.method || 'GET'} ${url.origin}${url.pathname}`);
  if (url.href === EXPORT) {
    if (sharing === 'private') return new Response('<html>sign in</html>', { status: 401, headers: { 'Content-Type': 'text/html' } });
    return new Response(null, { status: 307, headers: { Location: CDN } });
  }
  if (url.href === CDN) return new Response(WORKBOOK, { headers: { 'Content-Type': XLSX_MIME, 'Content-Disposition': `attachment; filename="Sales 2026.xlsx"` } });
  if (url.href === 'https://oauth2.googleapis.com/token') {
    return Response.json({ access_token: 'f-access', refresh_token: 'f-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' });
  }
  if (url.hostname === 'www.googleapis.com') {
    if (url.pathname === '/drive/v3/about') return Response.json({ user: { emailAddress: 'owner@drive.test' } });
    if (url.pathname === `/drive/v3/files/${DRIVE_FILE}`) {
      if (url.searchParams.get('alt') === 'media') return new Response(WORKBOOK);
      return Response.json({ id: DRIVE_FILE, name: 'Stock.xlsx', mimeType: XLSX_MIME, modifiedTime: '2026-11-18T10:00:00.000Z', size: String(WORKBOOK.byteLength) });
    }
    return Response.json({ error: { message: 'File not found' } }, { status: 404 });
  }
  return new Response('unexpected request in test: ' + url.href, { status: 599 });
}

beforeAll(async () => {
  await applyMigrations();
  Object.assign(e, { CREDENTIALS_KEY: 'test-credentials-key-0123456789ab', GOOGLE_DRIVE_CLIENT_ID: 'gid', GOOGLE_DRIVE_CLIENT_SECRET: 'gsecret' });
  await e.DB.batch([
    ...[OWNER, VIEWER, OUTSIDER, MEMBER].map((u) => e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(u, `${u}@ssa.test`, u)),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'SSA', 'ssa-ws', OWNER),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS2, 'Other', 'ssa-ws2', OUTSIDER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_ssa', ?, ?, 'owner')").bind(WS, OWNER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_ssa_v', ?, ?, 'member', 'external')").bind(WS, VIEWER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_ssa_o', ?, ?, 'owner')").bind(WS2, OUTSIDER),
    // An internal member who may not import while members may not create folders.
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_ssa_m', ?, ?, 'member')").bind(WS, MEMBER),
    e.DB.prepare('UPDATE workspaces SET member_folders_enabled = 0 WHERE id = ?').bind(WS),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'Sales board', 'ssa-sales', ?, ?, 'workspace')").bind(ART, OWNER, WS),
  ]);
  for (const [i, [u, t]] of Object.entries(TOKENS).entries()) {
    await e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash) VALUES (?, 'user', ?, ?, ?)").bind(`tok_ssa_${i}`, u, u, await hashToken(t)).run();
  }
});

beforeEach(async () => {
  sharing = 'public'; googleCalls = [];
  getSessionUser.mockReset().mockResolvedValue(null);
  await e.DB.prepare('DELETE FROM scheduled_jobs WHERE artifact_id = ?').bind(ART).run();
  await e.DB.prepare('DELETE FROM datasets WHERE artifact_id = ?').bind(ART).run();
  await e.DB.prepare('DELETE FROM file_import_connections WHERE workspace_id = ?').bind(WS).run();
  await e.DB.prepare("DELETE FROM rate_limits WHERE action = 'schedule:job'").run();
  vi.stubGlobal('fetch', vi.fn(fakeGoogle));
});
afterEach(() => vi.unstubAllGlobals());

/** A request carrying only an API token (what an agent sends): no cookie, no session. */
function withToken(user: string, method: string, path: string, body?: unknown): Request {
  return new Request(`${ORIGIN}${path}`, {
    method, redirect: 'manual',
    headers: { Authorization: `Bearer ${TOKENS[user]}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
/** A request from the person's own browser: their session cookie, no token. */
function fromBrowser(user: string | null, path: string, headers: Record<string, string> = {}): Request {
  getSessionUser.mockReset().mockResolvedValue(user ? { id: user, email: `${user}@ssa.test` } : null);
  return new Request(`${ORIGIN}${path}`, { redirect: 'manual', headers: { Cookie: 'shareout_session=s', ...headers } });
}
const jobs = (req: Request) => routeSchedulingApi(createFetchContext(req, e));
const links = (req: Request) => routeSheetLinkApi(createFetchContext(req, e));
const imports = (req: Request) => routeFileImportApi(createFetchContext(req, e));
const json = async (res: Response | null) => (await res!.json()) as Record<string, any>;
const datasetRows = async (name: string) => {
  const row = await e.DB.prepare('SELECT metadata FROM datasets WHERE artifact_id = ? AND name = ?').bind(ART, name).first<{ metadata: string }>();
  return row ? (JSON.parse(row.metadata) as { rowCount: number }).rowCount : null;
};
const stateOf = (location: string) => JSON.parse(atob(new URL(location).searchParams.get('state')!.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));

describe('an API token on the real routes', () => {
  it('public_sheet_sync: the page owner checks the link, creates, runs, re-points and deletes the sync', async () => {
    const check = await links(withToken(OWNER, 'POST', `/v1/workspaces/${WS}/sheet-links/inspect`, { link: LINK }));
    expect(check?.status).toBe(200);
    expect(await json(check)).toMatchObject({ fileName: 'Sales 2026.xlsx', sheets: ['Summary', 'Raw'], sheet: 'Summary', rowCount: 2 });

    const created = await jobs(withToken(OWNER, 'POST', '/v1/jobs', { artifact_id: ART, action: 'public_sheet_sync', schedule: '0 8 * * *', config: { link: LINK, dataset: 'sales', sheet: 'Summary' } }));
    expect(created?.status).toBe(201);
    const jobId = (await json(created)).job.id as string;

    const ran = await jobs(withToken(OWNER, 'POST', `/v1/jobs/${jobId}/run`));
    expect((await json(ran)).execution).toMatchObject({ status: 'success' });
    expect(await datasetRows('sales')).toBe(2);

    expect((await jobs(withToken(OWNER, 'PATCH', `/v1/jobs/${jobId}`, { config: { link: LINK, dataset: 'sales', sheet: 'Raw' } })))?.status).toBe(200);
    expect((await jobs(withToken(OWNER, 'DELETE', `/v1/jobs/${jobId}`)))?.status).toBe(200);
  });

  it('public_sheet_sync: a viewer of the page cannot schedule one; another workspace cannot even check a link', async () => {
    const res = await jobs(withToken(VIEWER, 'POST', '/v1/jobs', { artifact_id: ART, action: 'public_sheet_sync', schedule: '0 8 * * *', config: { link: LINK, dataset: 'sales' } }));
    expect(res?.status).toBe(403);
    expect((await links(withToken(OUTSIDER, 'POST', `/v1/workspaces/${WS}/sheet-links/inspect`, { link: LINK })))?.status).toBe(403);
  });

  it('drive_file_sync: a token can schedule a file id, but the run reads only what the person picked in Google', async () => {
    // Nothing checks at save time that the file was picked: the first run says so.
    const created = await jobs(withToken(OWNER, 'POST', '/v1/jobs', { artifact_id: ART, action: 'drive_file_sync', schedule: '0 8 * * *', config: { provider: 'google_drive', fileId: DRIVE_FILE, dataset: 'stock' } }));
    expect(created?.status).toBe(201);
    const jobId = (await json(created)).job.id as string;
    const ran = await json(await jobs(withToken(OWNER, 'POST', `/v1/jobs/${jobId}/run`)));
    expect(ran.execution).toMatchObject({ status: 'failed', error: expect.stringMatching(/has not chosen this spreadsheet in Google Drive/) });
    expect(await datasetRows('stock')).toBeNull();
  });

  it('drive_file_sync: a token reads the status and gets the pick link — the link leads to Google, where only the person can choose', async () => {
    const status = await json(await imports(withToken(OWNER, 'GET', `/v1/workspaces/${WS}/file-imports/sheet-sync`)));
    expect(status).toEqual({ available: true, connected: false, accountEmail: null, picked: null });
    const pick = await imports(withToken(OWNER, 'GET', `/v1/workspaces/${WS}/file-imports/sheet-sync/pick?return=assistant`));
    expect(pick?.status).toBe(302);
    // Google's consent + Picker: a person signs in to Google, allows, and picks. No route here skips it.
    expect(new URL(pick!.headers.get('Location')!).hostname).toBe('accounts.google.com');
    expect(googleCalls).toEqual([]);
    const memberPick = await imports(withToken(MEMBER, 'GET', `/v1/workspaces/${WS}/file-imports/sheet-sync/pick`));
    expect(memberPick?.status).toBe(403);
    expect((await json(memberPick)).code).toBe('IMPORT_NOT_ALLOWED');
  });
});

describe('the pick link, opened in the person’s own browser', () => {
  it('signed out: sign in first, then straight back to the same link', async () => {
    const path = `/v1/workspaces/${WS}/file-imports/sheet-sync/pick?return=assistant`;
    const res = await imports(fromBrowser(null, path));
    expect(res?.status).toBe(302);
    expect(res!.headers.get('Location')).toBe(`${ORIGIN}/auth/login?redirect=${encodeURIComponent(path)}`);
  });

  it('signed in with their session (no token): Google’s consent + Picker, bound to that person, marked as from an assistant', async () => {
    const res = await imports(fromBrowser(OWNER, `/v1/workspaces/${WS}/file-imports/sheet-sync/pick?return=assistant&file=${DRIVE_FILE}`));
    expect(res?.status).toBe(302);
    const loc = new URL(res!.headers.get('Location')!);
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(loc.searchParams.get('file_ids')).toBe(DRIVE_FILE);
    expect(stateOf(loc.href)).toMatchObject({ p: DRIVE_FILE_CONSENT, ws: WS, u: OWNER, a: 1 });
  });

  it('the last page sends them back to the conversation, in their language; a failure offers “pick again”', async () => {
    const start = await imports(fromBrowser(OWNER, `/v1/workspaces/${WS}/file-imports/sheet-sync/pick?return=assistant`));
    const state = new URL(start!.headers.get('Location')!).searchParams.get('state')!;
    const cb = (q: string, lang: string) => imports(fromBrowser(OWNER, `/v1/file-imports/oauth/google_drive/callback?${q}&state=${encodeURIComponent(state)}`, { 'Accept-Language': lang }));

    const done = await cb(`code=c&picked_file_ids=${DRIVE_FILE}`, 'es-AR,es;q=0.9');
    expect(done?.status).toBe(200);
    const html = await done!.text();
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('Planilla elegida');
    expect(html).toContain('Elegiste “Stock.xlsx”. Volvé a la conversación y decile a tu asistente que ya está');

    const cancelled = await cb('error=access_denied', 'en-US');
    expect(cancelled?.status).toBe(400);
    const text = await cancelled!.text();
    expect(text).toContain('No spreadsheet was picked.');
    expect(text).toContain(`href="/v1/workspaces/${WS}/file-imports/sheet-sync/pick?return=assistant">Pick the spreadsheet again</a>`);
  });

  it('someone who may not use it gets a page that says why, not JSON', async () => {
    let res = await imports(fromBrowser(MEMBER, `/v1/workspaces/${WS}/file-imports/sheet-sync/pick`));
    expect(res?.status).toBe(403);
    expect(res!.headers.get('Content-Type')).toMatch(/text\/html/);
    const page = await res!.text();
    expect(page).toContain('<h1>Google Drive can’t be connected here</h1>');
    expect(page).toContain('Your role in this workspace cannot connect Google Drive');
    res = await imports(fromBrowser(OUTSIDER, `/v1/workspaces/${WS}/file-imports/sheet-sync/pick`, { 'Accept-Language': 'es' }));
    expect(res?.status).toBe(403);
    expect(await res!.text()).toContain('Esta cuenta de ShareOut no puede conectar Google Drive en este espacio de trabajo');
    // The same refusal to an API client stays JSON.
    expect((await json(await imports(withToken(OUTSIDER, 'GET', `/v1/workspaces/${WS}/file-imports/sheet-sync/pick`)))).code).toBe('FORBIDDEN');
  });
});

describe('MCP tools', () => {
  const as = (user: string): ToolContext => ({ env: e, user: { id: user, email: `${user}@ssa.test`, username: null }, origin: ORIGIN, authorization: `Bearer ${TOKENS[user]}` });
  const call = async (user: string, name: string, args: Record<string, unknown>) => (await callTool(as(user), name, args))!;
  const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((c) => c.text ?? '').join('');

  it('inspect_sheet_link names the tabs and says who can read a link-shared file; a private link gets the three clicks', async () => {
    const r = await call(OWNER, 'inspect_sheet_link', { link: LINK });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain('“Sales 2026.xlsx” is shared with anyone who has the link. Tabs: Summary, Raw.');
    expect(text(r)).toMatch(/never personal or confidential data/);
    sharing = 'private';
    const p = await call(OWNER, 'inspect_sheet_link', { link: LINK });
    expect(p.isError).toBe(true);
    expect(text(p)).toContain('Share → General access → “Anyone with the link” → Viewer');
    expect(text(p)).toContain('Compartir → Acceso general');
    expect(text(p)).not.toMatch(/report_problem/);
  });

  it('set_sheet_sync from a link: defaults picked (first tab, daily, dataset from the file), loads now, reports rows', async () => {
    const r = await call(OWNER, 'set_sheet_sync', { artifact_id: ART, link: LINK });
    expect(text(r)).toBe('Done: the page now has 2 rows from “Sales 2026.xlsx” in dataset “sales_2026”, and updates every day at 08:00 UTC (each run skips the write when nothing changed).');
    const job = await e.DB.prepare('SELECT id, action, schedule, config, title FROM scheduled_jobs WHERE artifact_id = ?').bind(ART).first<{ id: string; action: string; schedule: string; config: string; title: string }>();
    expect(job).toMatchObject({ action: 'public_sheet_sync', schedule: '0 8 * * *', title: 'Sync Sales 2026.xlsx from link' });
    expect(JSON.parse(job!.config)).toEqual({ link: LINK, dataset: 'sales_2026', sheet: 'Summary', fileName: 'Sales 2026.xlsx' });

    const u = await call(OWNER, 'set_sheet_sync', { artifact_id: ART, job_id: job!.id, sheet: 'Raw', how_often: 'weekdays', time: '09:30', timezone: 'America/Argentina/Buenos_Aires' });
    expect(text(u)).toBe('Changed and loaded: the sync now updates Monday to Friday at 09:30 America/Argentina/Buenos_Aires and reads tab “Raw” into dataset “sales_2026”; the page has 3 rows in “sales_2026”.');
    expect((await e.DB.prepare('SELECT schedule FROM scheduled_jobs WHERE id = ?').bind(job!.id).first<{ schedule: string }>())!.schedule).toBe('30 12 * * 1-5');

    const gone = await call(OWNER, 'remove_sheet_sync', { artifact_id: ART, job_id: job!.id });
    expect(text(gone)).toBe('Stopped: “Sync Sales 2026.xlsx from link” no longer updates the page. The data already loaded stays.');
    expect(await datasetRows('sales_2026')).toBe(3);
  });

  it('set_sheet_sync refuses a viewer, a page in another workspace, and a private link — nothing is saved', async () => {
    expect(text(await call(VIEWER, 'set_sheet_sync', { artifact_id: ART, link: LINK }))).toMatch(/only the page’s owner or editors/);
    expect(text(await call(OUTSIDER, 'set_sheet_sync', { artifact_id: ART, link: LINK }))).toMatch(/only the page’s owner or editors/);
    sharing = 'private';
    const r = await call(OWNER, 'set_sheet_sync', { artifact_id: ART, link: LINK });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/NOT_PUBLIC/);
    expect((await e.DB.prepare('SELECT COUNT(*) AS n FROM scheduled_jobs WHERE artifact_id = ?').bind(ART).first<{ n: number }>())!.n).toBe(0);
  });

  it('never writes over data the page already has unless asked (review R1)', async () => {
    // The page already reads an uploaded "sales_2026" (1 row).
    await e.DB.prepare("INSERT INTO datasets (id, artifact_id, name, format, r2_key, version, size_bytes, sha256, metadata) VALUES ('ds_ssa_up', ?, 'sales_2026', 'json', 'datasets/ssa/up.json', 1, 2, 'x', '{\"rowCount\":1}')").bind(ART).run();
    const keep = async () => (await e.DB.prepare("SELECT id, version FROM datasets WHERE artifact_id = ? AND name = 'sales_2026'").bind(ART).first<{ id: string; version: number }>());

    // Default name taken → the next free one; the uploaded data is untouched.
    const auto = await call(OWNER, 'set_sheet_sync', { artifact_id: ART, link: LINK });
    expect(text(auto)).toContain('in dataset “sales_2026_2”');
    expect(await keep()).toEqual({ id: 'ds_ssa_up', version: 1 });

    // Named explicitly → refused, nothing saved; replace_existing: true → replaced.
    const named = await call(OWNER, 'set_sheet_sync', { artifact_id: ART, link: LINK, dataset: 'sales_2026' });
    expect(named.isError).toBe(true);
    expect(text(named)).toBe('Nothing was done: the page already has data named “sales_2026” (1 rows), and the spreadsheet would replace it. Send replace_existing: true to replace it, or another dataset name.');
    expect((await e.DB.prepare('SELECT COUNT(*) AS n FROM scheduled_jobs WHERE artifact_id = ?').bind(ART).first<{ n: number }>())!.n).toBe(1);

    // A name another schedule fills is refused even with replace_existing.
    const clash = await call(OWNER, 'set_sheet_sync', { artifact_id: ART, link: LINK, dataset: 'sales_2026_2', replace_existing: true });
    expect((clash.structuredContent as { code: string }).code).toBe('DATASET_IN_USE');
    const jobId = (auto.structuredContent as { job_id: string }).job_id;
    const moved = await call(OWNER, 'set_sheet_sync', { artifact_id: ART, job_id: jobId, dataset: 'sales_2026' });
    expect((moved.structuredContent as { code: string }).code).toBe('DATASET_EXISTS');
    expect(JSON.parse((await e.DB.prepare('SELECT config FROM scheduled_jobs WHERE id = ?').bind(jobId).first<{ config: string }>())!.config).dataset).toBe('sales_2026_2');

    const replaced = await call(OWNER, 'set_sheet_sync', { artifact_id: ART, link: LINK, sheet: 'Raw', dataset: 'sales_2026', replace_existing: true });
    expect(text(replaced)).toContain('the page now has 3 rows');
  });

  it('remove_sheet_sync stops only spreadsheet syncs', async () => {
    await e.DB.prepare("INSERT INTO scheduled_jobs (id, artifact_id, owner_id, action, schedule, config, next_run_at) VALUES ('job_ssa_mail', ?, ?, 'email', '0 9 * * *', '{\"recipients\":[\"a@b.c\"]}', ?)")
      .bind(ART, OWNER, new Date().toISOString()).run();
    const r = await call(OWNER, 'remove_sheet_sync', { artifact_id: ART, job_id: 'job_ssa_mail' });
    expect(r.isError).toBe(true);
    expect(await e.DB.prepare("SELECT 1 FROM scheduled_jobs WHERE id = 'job_ssa_mail'").first()).not.toBeNull();
  });

  it('private file, end to end: link from the tool → the person picks in their browser → the tool sees the pick → the sync loads', async () => {
    const first = await call(OWNER, 'pick_drive_spreadsheet', {});
    const url = (first.structuredContent as { pick_url: string }).pick_url;
    expect(url).toBe(`${ORIGIN}/v1/workspaces/${WS}/file-imports/sheet-sync/pick?return=assistant`);
    expect(text(first)).toContain('No spreadsheet has been picked in this workspace yet.');

    // The person opens the link in their own browser (session cookie, not the agent's token).
    const start = await imports(fromBrowser(OWNER, new URL(url).pathname + new URL(url).search));
    const state = new URL(start!.headers.get('Location')!).searchParams.get('state')!;
    await imports(fromBrowser(OWNER, `/v1/file-imports/oauth/google_drive/callback?code=c&picked_file_ids=${DRIVE_FILE}&state=${encodeURIComponent(state)}`));

    const after = await call(OWNER, 'pick_drive_spreadsheet', {});
    expect((after.structuredContent as { picked: { id: string; name: string } }).picked).toMatchObject({ id: DRIVE_FILE, name: 'Stock.xlsx' });
    const r = await call(OWNER, 'set_sheet_sync', { artifact_id: ART, file_id: DRIVE_FILE });
    expect(text(r)).toBe('Done: the page now has 2 rows from “Stock.xlsx” in dataset “stock”, and updates every day at 08:00 UTC.');
    const job = await e.DB.prepare('SELECT action, owner_id, config, title FROM scheduled_jobs WHERE artifact_id = ?').bind(ART).first<{ action: string; owner_id: string; config: string; title: string }>();
    expect(job).toMatchObject({ action: 'drive_file_sync', owner_id: OWNER, title: 'Sync Stock.xlsx from Google Drive' });
    expect(JSON.parse(job!.config)).toEqual({ provider: 'google_drive', fileId: DRIVE_FILE, dataset: 'stock', fileName: 'Stock.xlsx' });
  });

  it('a Drive file nobody picked: nothing is left scheduled, and the result carries the pick link', async () => {
    const r = await call(OWNER, 'set_sheet_sync', { artifact_id: ART, file_id: DRIVE_FILE });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/^Nothing was set up: the first load failed/);
    expect((r.structuredContent as { pick_url: string }).pick_url).toBe(`${ORIGIN}/v1/workspaces/${WS}/file-imports/sheet-sync/pick?return=assistant&file=${DRIVE_FILE}`);
    expect((await e.DB.prepare('SELECT COUNT(*) AS n FROM scheduled_jobs WHERE artifact_id = ?').bind(ART).first<{ n: number }>())!.n).toBe(0);
  });

  it('pick_drive_spreadsheet: a role that cannot import is told who can; a Drive link narrows the picker', async () => {
    await saveConnection(e, WS, OWNER, DRIVE_FILE_CONSENT, { accessToken: 'a', refreshToken: 'r', expiresAt: new Date(Date.now() + 3600_000).toISOString(), scope: 's' }, 'owner@drive.test');
    const r = await call(MEMBER, 'pick_drive_spreadsheet', { workspace_id: WS });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/only admins and editors can/);
    const narrowed = await call(OWNER, 'pick_drive_spreadsheet', { link: `https://drive.google.com/file/d/${DRIVE_FILE}/view` });
    expect((narrowed.structuredContent as { pick_url: string }).pick_url).toContain(`&file=${DRIVE_FILE}`);
  });
});

describe('plain-words schedule', () => {
  const at = new Date('2026-11-18T12:00:00Z');
  it('turns a local time into the UTC schedule the Inspector would save', () => {
    expect(cronFor('daily', '08:00', 'UTC', at)).toEqual({ cron: '0 8 * * *', label: 'every day at 08:00 UTC' });
    expect(cronFor('daily', '08:00', 'America/Argentina/Buenos_Aires', at)).toMatchObject({ cron: '0 11 * * *' });
    expect(cronFor('weekly', '23:00', 'America/Argentina/Buenos_Aires', at)).toMatchObject({ cron: '0 2 * * 2' });
    expect(cronFor('weekdays', '01:00', 'Europe/Madrid', at)).toMatchObject({ cron: '0 0 * * 1-5' });
    expect(cronFor('weekdays', '00:30', 'Europe/Madrid', at)).toMatchObject({ cron: '30 23 * * 0-4' });
    expect(cronFor('hourly', '', 'Nowhere/City', at)).toEqual({ cron: '0 * * * *', label: 'every hour' });
    expect(cronFor('daily', '8am', 'UTC', at)).toHaveProperty('error');
    expect(cronFor('daily', '08:00', 'Nowhere/City', at)).toHaveProperty('error');
  });
  it('names the dataset after the file', () => {
    expect(datasetSlug('Sales 2026.xlsx')).toBe('sales_2026');
    expect(datasetSlug('Ventas — Q4 (final).csv')).toBe('ventas_q4_final');
    expect(datasetSlug(null)).toBe('data');
  });
});
