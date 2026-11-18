// drive_file_sync job action: a Drive spreadsheet → the artifact's dataset on the job's
// schedule. Real D1/R2 and the real scheduler; Google is an in-memory fetch stub.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { applyMigrations, e } from '../helpers/migrated-db';
import { saveConnection } from '../../../src/file-imports/connections';
import { driveFileSyncDestination } from '../../../src/delivery/destinations/drive-file-sync';
import { googleDrive } from '../../../src/file-imports/providers/google';
import { createJob } from '../../../src/scheduling/jobs/crud';
import { runScheduledJobs } from '../../../src/scheduling/jobs/execute';
import type { DeliveryContext } from '../../../src/delivery/types';
import type { DriveFileSyncConfig } from '../../../src/scheduling/jobs/types';

const OWNER = 'usr_dfs_owner';
const NOCONN = 'usr_dfs_noconn';
const WS = 'wsp_dfs';
const ART = 'art_dfs';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

interface DriveFile { id: string; name: string; mime: string; modifiedTime: string; bytes: Uint8Array }
let files: DriveFile[] = [];
let log: string[] = [];
let token = 'at-1';
let refresh: 'ok' | 'revoked' = 'ok';

function book(tabs: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(tabs)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), name);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.href === 'https://oauth2.googleapis.com/token') {
    log.push('refresh');
    if (refresh === 'revoked') return json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
    token = 'at-2';
    return json({ access_token: 'at-2', expires_in: 3600 });
  }
  if (url.hostname !== 'www.googleapis.com') return new Response('unexpected request in test', { status: 599 });
  if (new Headers(init?.headers).get('Authorization') !== `Bearer ${token}`) return json({ error: { message: 'bad token' } }, 401);
  const exp = /^\/drive\/v3\/files\/([^/]+)\/export$/.exec(url.pathname);
  const get = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
  const f = files.find((x) => x.id === (exp?.[1] ?? get?.[1]));
  if (!f) return json({ error: { message: 'File not found' } }, 404);
  if (exp) { log.push(`export:${f.id}`); return new Response(f.bytes); }
  if (url.searchParams.get('alt') === 'media') { log.push(`media:${f.id}`); return new Response(f.bytes); }
  log.push(`meta:${f.id}`);
  return json({ id: f.id, name: f.name, mimeType: f.mime, modifiedTime: f.modifiedTime, size: f.mime === GSHEET_MIME ? undefined : String(f.bytes.byteLength) });
}

const ctx = (createdBy = OWNER): DeliveryContext => ({ artifactId: ART, createdBy, triggeredVia: 'cron' });
const cfg = (over: Partial<DriveFileSyncConfig> = {}): DriveFileSyncConfig => ({ fileId: 'XL1', dataset: 'sales', ...over });

async function dataset(name = 'sales') {
  const row = await e.DB.prepare('SELECT r2_key, version, metadata FROM datasets WHERE artifact_id = ? AND name = ?')
    .bind(ART, name).first<{ r2_key: string; version: number; metadata: string }>();
  if (!row) return null;
  const obj = await e.ARTIFACTS.get(row.r2_key);
  return { version: row.version, meta: JSON.parse(row.metadata), rows: JSON.parse(await obj!.text()) as Record<string, unknown>[] };
}

beforeAll(async () => {
  await applyMigrations();
  Object.assign(e, { CREDENTIALS_KEY: 'test-credentials-key-0123456789ab', GOOGLE_DRIVE_CLIENT_ID: 'gid', GOOGLE_DRIVE_CLIENT_SECRET: 'gsecret' });
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(OWNER, 'owner@dfs.test', 'Owner'),
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(NOCONN, 'noconn@dfs.test', 'No conn'),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'DFS', 'dfs-ws', OWNER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_dfs', ?, ?, 'owner')").bind(WS, OWNER),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'Sales board', 'dfs-sales', ?, ?, 'private')").bind(ART, OWNER, WS),
  ]);
});

beforeEach(async () => {
  files = [{ id: 'XL1', name: 'Sales 2026.xlsx', mime: XLSX_MIME, modifiedTime: '2026-11-01T10:00:00.000Z',
    bytes: book({ Summary: [['Region', 'Sales', 'Day'], ['North', 120, new Date(Date.UTC(2026, 10, 1))], ['South', 80.5, null]], Raw: [['id'], [1], [2], [3]] }) }];
  log = []; token = 'at-1'; refresh = 'ok';
  await e.DB.prepare('DELETE FROM datasets WHERE artifact_id = ?').bind(ART).run();
  await saveConnection(e, WS, OWNER, 'google_drive', { accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: new Date(Date.now() + 3600_000).toISOString(), scope: 's' }, 'owner@drive.test');
  vi.stubGlobal('fetch', fakeFetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('drive_file_sync', () => {
  it('writes the first tab as JSON rows keyed by the header row', async () => {
    const res = await driveFileSyncDestination.deliver(e, ctx(), cfg());
    expect(res.success).toBe(true);
    const ds = await dataset();
    expect(ds!.version).toBe(1);
    expect(ds!.rows).toEqual([{ Region: 'North', Sales: 120, Day: '2026-11-01' }, { Region: 'South', Sales: 80.5, Day: null }]);
    expect(ds!.meta).toMatchObject({ rowCount: 2, columns: ['Region', 'Sales', 'Day'], source: { provider: 'google_drive', file: 'Sales 2026.xlsx', sheet: 'Summary', modifiedAt: '2026-11-01T10:00:00.000Z' } });
    // The page's viewers can read dataset metadata; the Drive file id stays out of it.
    expect(JSON.stringify(ds!.meta)).not.toContain('XL1');
  });

  it('skips an unchanged file: one metadata call, no download, same version', async () => {
    await driveFileSyncDestination.deliver(e, ctx(), cfg());
    log = [];
    const res = await driveFileSyncDestination.deliver(e, ctx(), cfg());
    expect(res.success).toBe(true);
    expect(res.steps).toEqual([expect.objectContaining({ step: 'fetch', status: 'success', detail: expect.objectContaining({ unchanged: true }) })]);
    expect(log).toEqual(['meta:XL1']);
    expect((await dataset())!.version).toBe(1);
  });

  it('reloads the dataset when the file changes in Drive', async () => {
    await driveFileSyncDestination.deliver(e, ctx(), cfg());
    files[0].modifiedTime = '2026-11-02T08:00:00.000Z';
    files[0].bytes = book({ Summary: [['Region', 'Sales'], ['North', 150], ['South', 90], ['East', 30]] });
    const res = await driveFileSyncDestination.deliver(e, ctx(), cfg());
    expect(res.success).toBe(true);
    const ds = await dataset();
    expect(ds!.version).toBe(2);
    expect(ds!.rows).toHaveLength(3);
    expect(ds!.meta.source.modifiedAt).toBe('2026-11-02T08:00:00.000Z');
  });

  it('reads a named tab, and names the tabs when the one asked for is missing', async () => {
    expect((await driveFileSyncDestination.deliver(e, ctx(), cfg({ sheet: 'raw' }))).success).toBe(true);
    expect((await dataset())!.rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const res = await driveFileSyncDestination.deliver(e, ctx(), cfg({ sheet: 'Budget' }));
    expect(res.success).toBe(false);
    expect(res.error).toBe('No tab named "Budget". Tabs: Summary, Raw.');
  });

  it('exports a native Google Sheet as .xlsx', async () => {
    files.push({ id: 'GS1', name: 'Forecast', mime: GSHEET_MIME, modifiedTime: '2026-11-03T00:00:00.000Z', bytes: book({ Q4: [['k', 'v'], ['a', 1]] }) });
    const res = await driveFileSyncDestination.deliver(e, ctx(), cfg({ fileId: 'GS1', dataset: 'forecast' }));
    expect(res.success).toBe(true);
    expect(log).toContain('export:GS1');
    expect((await dataset('forecast'))!.rows).toEqual([{ k: 'a', v: 1 }]);
  });

  it('fails loudly: no connection, not a spreadsheet, file gone, access revoked', async () => {
    let res = await driveFileSyncDestination.deliver(e, ctx(NOCONN), cfg());
    expect(res).toMatchObject({ success: false, error: 'The job owner has not connected Google Drive in this workspace.' });

    files.push({ id: 'DOC1', name: 'Notes', mime: 'application/vnd.google-apps.document', modifiedTime: '2026-11-01T00:00:00.000Z', bytes: new Uint8Array() });
    res = await driveFileSyncDestination.deliver(e, ctx(), cfg({ fileId: 'DOC1' }));
    expect(res).toMatchObject({ success: false, error: '"Notes" is not a spreadsheet (Excel, Google Sheets, OpenDocument or CSV).' });

    res = await driveFileSyncDestination.deliver(e, ctx(), cfg({ fileId: 'GONE1' }));
    expect(res).toMatchObject({ success: false, error: 'The file is gone or no longer shared with the job owner.' });

    token = 'at-rotated'; refresh = 'revoked';
    res = await driveFileSyncDestination.deliver(e, ctx(), cfg());
    expect(log).toContain('refresh');
    expect(res).toMatchObject({ success: false, error: 'Google Drive access expired or was revoked. Reconnect Google Drive, then run the sync again.' });
    expect(await dataset()).toBeNull();
  });

  it('refreshes a rejected access token once and carries on', async () => {
    token = 'at-rotated'; // Drive rejects at-1; the refresh makes at-2 the accepted token
    const res = await driveFileSyncDestination.deliver(e, ctx(), cfg());
    expect(res.success).toBe(true);
    expect(log.filter((l) => l === 'refresh')).toHaveLength(1);
    expect((await dataset())!.rows).toHaveLength(2);
  });

  it('validates the config', async () => {
    const v = (c: unknown) => driveFileSyncDestination.validate(e, ctx(), c as DriveFileSyncConfig);
    expect(await v(cfg())).toBeNull();
    expect(await v(cfg({ fileId: '../etc' }))).toBe('drive_file_sync requires a Google Drive fileId');
    expect(await v(cfg({ dataset: 'has space' }))).toMatch(/dataset name/);
    expect(await v({ ...cfg(), provider: 'microsoft' })).toMatch(/google_drive/);
    const saved = e.GOOGLE_DRIVE_CLIENT_ID;
    (e as { GOOGLE_DRIVE_CLIENT_ID?: string }).GOOGLE_DRIVE_CLIENT_ID = undefined;
    expect(await v(cfg())).toBe('Google Drive is not set up on this instance');
    (e as { GOOGLE_DRIVE_CLIENT_ID?: string }).GOOGLE_DRIVE_CLIENT_ID = saved;
  });
});

describe('drive_file_sync on a schedule', () => {
  it('an hourly job loads the dataset when due, then skips while the file is unchanged', async () => {
    const { job, error } = await createJob(e, OWNER, { artifact_id: ART, action: 'drive_file_sync', schedule: '0 * * * *', config: cfg() });
    expect(error).toBeUndefined();
    const due = () => e.DB.prepare('UPDATE scheduled_jobs SET next_run_at = ? WHERE id = ?').bind(new Date(Date.now() - 60_000).toISOString(), job!.id).run();

    await due();
    expect(await runScheduledJobs(e)).toEqual({ executed: 1, failed: 0 });
    expect((await dataset())!.version).toBe(1);

    await due(); log = [];
    expect(await runScheduledJobs(e)).toEqual({ executed: 1, failed: 0 });
    expect(log).toEqual(['meta:XL1']);
    expect((await dataset())!.version).toBe(1);

    const row = await e.DB.prepare('SELECT next_run_at, last_status FROM scheduled_jobs WHERE id = ?').bind(job!.id).first<{ next_run_at: string; last_status: string }>();
    expect(row!.last_status).toBe('success');
    expect(row!.next_run_at).toMatch(/T\d{2}:00:00\.000Z$/);
  });

  it('a viewer cannot schedule one', async () => {
    await e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_dfs', ?, 'noconn@dfs.test', 'viewer')").bind(ART).run();
    const { error } = await createJob(e, NOCONN, { artifact_id: ART, action: 'drive_file_sync', schedule: '0 9 * * *', config: cfg() });
    expect(error).toBe('Viewers can only schedule a Slack DM, email, or Telegram message to themselves');
  });
});

describe('Drive browse, files mode', () => {
  it('lists spreadsheets as picks and folders only to open', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const q = url.searchParams.get('q') || '';
      if (q.includes("mimeType = 'application/vnd.google-apps.folder'")) return json({ files: [{ id: 'F1', name: 'Finance' }] });
      if (q.includes(`mimeType = '${XLSX_MIME}'`)) return json({ files: [{ id: 'XL1', name: 'Sales 2026.xlsx', mimeType: XLSX_MIME, modifiedTime: '2026-11-01T10:00:00.000Z' }] });
      return json({ files: [] });
    });
    const res = await googleDrive.browse('at-1', 'my', undefined, { files: 'sheets' });
    expect(res.entries).toEqual([
      { ref: 'folder:-:F1', name: 'Finance', kind: 'folder', selectable: false },
      { ref: 'file:-:XL1', name: 'Sales 2026.xlsx', kind: 'file', selectable: true, fileId: 'XL1', mime: XLSX_MIME, modifiedAt: '2026-11-01T10:00:00.000Z' },
    ]);
    // Folder mode is unchanged: folders are picks, no files listed.
    expect((await googleDrive.browse('at-1', 'my')).entries).toEqual([{ ref: 'folder:-:F1', name: 'Finance', kind: 'folder', selectable: true }]);
  });
});
