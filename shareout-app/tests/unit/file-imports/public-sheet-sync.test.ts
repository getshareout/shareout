// public_sheet_sync job action + the link check route: a spreadsheet shared as "Anyone with the
// link can view" → the artifact's dataset on the job's schedule, no Google sign-in. Real D1/R2
// and the real scheduler; Google is an in-memory fetch stub.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', async (orig) => ({ ...(await orig<object>()), validateToken }));
vi.mock('../../../src/auth/session', async (orig) => ({ ...(await orig<object>()), getSessionUser }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { publicSheetSyncDestination } from '../../../src/delivery/destinations/public-sheet-sync';
import { createJob, updateJob } from '../../../src/scheduling/jobs/crud';
import { runScheduledJobs } from '../../../src/scheduling/jobs/execute';
import { routeSheetLinkApi } from '../../../src/router/api/sheet-links';
import { createFetchContext } from '../../../src/router/context';
import type { DeliveryContext } from '../../../src/delivery/types';
import type { PublicSheetSyncConfig } from '../../../src/scheduling/jobs/types';

const OWNER = 'usr_pss_owner';
const VIEWER = 'usr_pss_viewer';
const OUTSIDER = 'usr_pss_out';
const WS = 'wsp_pss';
const WS2 = 'wsp_pss2';
const ART = 'art_pss';
const LOOSE = 'art_pss_loose';
const ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const LINK = `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`;
const EXPORT = `https://docs.google.com/spreadsheets/d/${ID}/export?format=xlsx`;
const CDN = `https://doc-08-4o-sheets.googleusercontent.com/export/a/b/1/2/*/${ID}?format=xlsx`;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let sharing: 'public' | 'private' | 'deleted' = 'public';
let workbook: Uint8Array;
let downloads = 0;

function book(tabs: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(tabs)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), name);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

async function fakeGoogle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (init?.redirect !== 'manual') return new Response('redirects must be followed by hand', { status: 598 });
  if (url === EXPORT) {
    if (sharing === 'private') return new Response('<html>sign in</html>', { status: 401, headers: { 'Content-Type': 'text/html' } });
    if (sharing === 'deleted') return new Response(null, { status: 410 });
    return new Response(null, { status: 307, headers: { Location: CDN } });
  }
  if (url === CDN) {
    downloads++;
    return new Response(workbook, { status: 200, headers: { 'Content-Type': XLSX_MIME, 'Content-Disposition': `attachment; filename="Sales.xlsx"; filename*=UTF-8''Sales%202026.xlsx` } });
  }
  return new Response('unexpected request in test: ' + url, { status: 599 });
}

const ctx = (artifactId = ART): DeliveryContext => ({ artifactId, createdBy: OWNER, triggeredVia: 'cron' });
const cfg = (over: Partial<PublicSheetSyncConfig> = {}): PublicSheetSyncConfig => ({ link: LINK, dataset: 'sales', ...over });

async function dataset(name = 'sales') {
  const row = await e.DB.prepare('SELECT r2_key, version, metadata FROM datasets WHERE artifact_id = ? AND name = ?')
    .bind(ART, name).first<{ r2_key: string; version: number; metadata: string }>();
  if (!row) return null;
  const obj = await e.ARTIFACTS.get(row.r2_key);
  return { version: row.version, meta: JSON.parse(row.metadata), rows: JSON.parse(await obj!.text()) as Record<string, unknown>[] };
}

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    ...[OWNER, VIEWER, OUTSIDER].map((u) => e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(u, `${u}@pss.test`, u)),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'PSS', 'pss-ws', OWNER),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS2, 'Other', 'pss-ws2', OUTSIDER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_pss', ?, ?, 'owner')").bind(WS, OWNER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_pss_v', ?, ?, 'member')").bind(WS, VIEWER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_pss_o', ?, ?, 'owner')").bind(WS2, OUTSIDER),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'Sales board', 'pss-sales', ?, ?, 'private')").bind(ART, OWNER, WS),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'Loose page', 'pss-loose', ?, NULL, 'private')").bind(LOOSE, OWNER),
  ]);
});

beforeEach(async () => {
  sharing = 'public'; downloads = 0;
  workbook = book({ Summary: [['Region', 'Sales', 'Day'], ['North', 120, new Date(Date.UTC(2026, 10, 1))], ['South', 80.5, null]], Raw: [['id'], [1], [2], [3]] });
  await e.DB.prepare('DELETE FROM datasets WHERE artifact_id = ?').bind(ART).run();
  await e.DB.prepare('DELETE FROM scheduled_jobs WHERE artifact_id = ?').bind(ART).run();
  validateToken.mockReset().mockResolvedValue(null);
  vi.stubGlobal('fetch', fakeGoogle);
});
afterEach(() => vi.unstubAllGlobals());

describe('public_sheet_sync', () => {
  it('writes the first tab as JSON rows; the dataset metadata never carries the link or file id', async () => {
    const res = await publicSheetSyncDestination.deliver(e, ctx(), cfg());
    expect(res).toMatchObject({ success: true });
    const ds = await dataset();
    expect(ds!.version).toBe(1);
    expect(ds!.rows).toEqual([{ Region: 'North', Sales: 120, Day: '2026-11-01' }, { Region: 'South', Sales: 80.5, Day: null }]);
    expect(ds!.meta).toMatchObject({ rowCount: 2, columns: ['Region', 'Sales', 'Day'], source: { provider: 'public_link', file: 'Sales 2026.xlsx', sheet: 'Summary' } });
    // Page viewers can read dataset metadata; the link alone grants read access to the file.
    expect(JSON.stringify(ds!.meta)).not.toContain(ID);
  });

  it('reads the tab the job names', async () => {
    expect((await publicSheetSyncDestination.deliver(e, ctx(), cfg({ sheet: 'raw' }))).success).toBe(true);
    expect((await dataset())!.rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const res = await publicSheetSyncDestination.deliver(e, ctx(), cfg({ sheet: 'Gone' }));
    expect(res.success).toBe(false);
    expect(res.error).toBe('No tab named "Gone". Tabs: Summary, Raw.');
  });

  it('skips the write while the rows are unchanged, and reloads when they change', async () => {
    await publicSheetSyncDestination.deliver(e, ctx(), cfg());
    const again = await publicSheetSyncDestination.deliver(e, ctx(), cfg());
    expect(again.success).toBe(true);
    expect(again.steps?.find((s) => s.step === 'transform')?.detail).toMatchObject({ unchanged: true });
    expect(again.steps?.some((s) => s.step === 'deliver')).toBe(false);
    expect((await dataset())!.version).toBe(1);

    workbook = book({ Summary: [['Region', 'Sales'], ['North', 150], ['South', 90], ['East', 30]] });
    expect((await publicSheetSyncDestination.deliver(e, ctx(), cfg())).success).toBe(true);
    const ds = await dataset();
    expect(ds!.version).toBe(2);
    expect(ds!.rows).toHaveLength(3);
  });

  it('a link that stopped being public fails with how to fix it, and keeps the last good data', async () => {
    await publicSheetSyncDestination.deliver(e, ctx(), cfg());
    sharing = 'private';
    const res = await publicSheetSyncDestination.deliver(e, ctx(), cfg());
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/isn’t shared with "Anyone with the link"/);
    expect(res.error).toMatch(/Share → General access/);
    expect(res.steps).toEqual([expect.objectContaining({ step: 'fetch', status: 'failed' })]);
    expect((await dataset())!.rows).toHaveLength(2);

    sharing = 'deleted';
    expect((await publicSheetSyncDestination.deliver(e, ctx(), cfg())).error).toMatch(/can’t find this file/);
  });

  it('never writes an empty dataset when the first run fails', async () => {
    sharing = 'private';
    expect((await publicSheetSyncDestination.deliver(e, ctx(), cfg())).success).toBe(false);
    expect(await dataset()).toBeNull();
  });

  it('validates the config, and only on pages inside a workspace', async () => {
    const v = (c: unknown, artifactId = ART) => publicSheetSyncDestination.validate(e, { artifactId, createdBy: OWNER, triggeredVia: 'manual' }, c as PublicSheetSyncConfig);
    expect(await v(cfg())).toBeNull();
    expect(await v(cfg({ link: `https://drive.google.com/file/d/${ID}/view` }))).toBeNull();
    expect(await v({ dataset: 'x' })).toMatch(/share link/);
    expect(await v(cfg({ link: 'https://evil.example/x' }))).toMatch(/docs\.google\.com or drive\.google\.com/);
    expect(await v(cfg({ link: 'http://169.254.169.254/latest/meta-data' }))).toMatch(/Google Sheets or Google Drive/);
    expect(await v(cfg({ dataset: 'bad name!' }))).toMatch(/dataset name/);
    expect(await v(cfg({ sheet: 'x'.repeat(101) }))).toMatch(/tab name/);
    expect(await v(cfg(), LOOSE)).toMatch(/inside a workspace/);
  });

  it('an hourly job loads the dataset when due, then leaves it alone while nothing changes', async () => {
    const { job, error } = await createJob(e, OWNER, { artifact_id: ART, action: 'public_sheet_sync', schedule: '0 * * * *', config: cfg({ sheet: 'Summary' }) });
    expect(error).toBeUndefined();
    await e.DB.prepare('UPDATE scheduled_jobs SET next_run_at = ? WHERE id = ?').bind(new Date(Date.now() - 1000).toISOString(), job!.id).run();
    expect(await runScheduledJobs(e)).toEqual({ executed: 1, failed: 0 });
    expect((await dataset())!.version).toBe(1);
    await e.DB.prepare('UPDATE scheduled_jobs SET next_run_at = ? WHERE id = ?').bind(new Date(Date.now() - 1000).toISOString(), job!.id).run();
    expect(await runScheduledJobs(e)).toEqual({ executed: 1, failed: 0 });
    expect((await dataset())!.version).toBe(1);
    expect(downloads).toBe(2);
  });

  it('a workspace member who cannot edit the page cannot schedule one; the owner can re-point it', async () => {
    expect((await createJob(e, VIEWER, { artifact_id: ART, action: 'public_sheet_sync', schedule: '0 9 * * *', config: cfg() })).error).toBeTruthy();
    const { job } = await createJob(e, OWNER, { artifact_id: ART, action: 'public_sheet_sync', schedule: '0 9 * * *', config: cfg() });
    const other = `https://drive.google.com/file/d/${'1_VTWRhrTKaNvMlR0UH-WZcWJibu1QwLt'}/view`;
    expect((await updateJob(e, OWNER, job!.id, { config: cfg({ link: other }) })).error).toBeUndefined();
    expect((await updateJob(e, OWNER, job!.id, { config: cfg({ link: 'https://evil.example/x' }) })).error).toMatch(/Google/);
  });
});

describe('POST /v1/workspaces/{ws}/sheet-links/inspect', () => {
  const as = (id: string) => getSessionUser.mockReset().mockResolvedValue({ id, email: `${id}@pss.test` });
  const call = (ws: string, body: unknown, method = 'POST') => routeSheetLinkApi(createFetchContext(new Request(`https://shareout.test/v1/workspaces/${ws}/sheet-links/inspect`, {
    method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined,
  }), e));

  it('names the file and its tabs for a public link', async () => {
    as(OWNER);
    const res = await call(WS, { link: LINK });
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual({ kind: 'sheets', fileName: 'Sales 2026.xlsx', sheets: ['Summary', 'Raw'], sheet: 'Summary', rowCount: 2, columns: ['Region', 'Sales', 'Day'] });
  });

  it('a private link answers with the sharing fix, not an empty file', async () => {
    as(OWNER);
    sharing = 'private';
    const res = await call(WS, { link: LINK });
    expect(res?.status).toBe(422);
    const body = (await res!.json()) as { code: string; error: string };
    expect(body.code).toBe('NOT_PUBLIC');
    expect(body.error).toMatch(/Anyone with the link/);
  });

  it('refuses links that are not Google spreadsheet links without fetching anything', async () => {
    as(OWNER);
    const spy = vi.fn(fakeGoogle);
    vi.stubGlobal('fetch', spy);
    for (const link of ['https://evil.example/a.xlsx', 'http://localhost:8787/admin', `https://docs.google.com/document/d/${ID}/edit`]) {
      const res = await call(WS, { link });
      expect(res?.status, link).toBe(400);
      expect(((await res!.json()) as { code: string }).code).toBe('BAD_LINK');
    }
    expect((await call(WS, { nope: 1 }))?.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('is workspace-scoped: signed-out 401, another workspace 403, GET 405', async () => {
    getSessionUser.mockReset().mockResolvedValue(null);
    expect((await call(WS, { link: LINK }))?.status).toBe(401);
    as(OUTSIDER);
    expect((await call(WS, { link: LINK }))?.status).toBe(403);
    as(OWNER);
    expect((await call(WS, null, 'GET'))?.status).toBe(405);
    expect(await routeSheetLinkApi(createFetchContext(new Request('https://shareout.test/v1/workspaces/x/other'), e))).toBeNull();
  });
});
