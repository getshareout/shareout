// The import run end to end against the migrated schema, with Drive and Graph faked
// behind a fetch stub: recursive walk + bounds, native export, idempotent re-run,
// quota stop, token encryption, disconnect, and the daily sweep.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queueKnowledgeSource = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../../src/knowledge/corpus/ingest', () => ({ queueKnowledgeSource }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { saveConnection, accessTokenFor, findConnection, deleteConnection } from '../../../src/file-imports/connections';
import { createRun, getRun, readRun } from '../../../src/file-imports/runs';
import { runImport } from '../../../src/file-imports/sync';
import { runDueFileImports } from '../../../src/file-imports/schedule';
import { timing } from '../../../src/file-imports/http';
import type { SourceRow } from '../../../src/file-imports/runs';
import type { FileImportProvider } from '../../../src/file-imports/types';
import { fakeGoogle, fakeGraph, gFile, gFolder, type FakeFile, type FakeLog } from './fakes';

const U = 'usr_fi';
const WS = 'wsp_fi';
const FUTURE = () => new Date(Date.now() + 3600_000).toISOString();
let n = 0;

beforeAll(async () => {
  await applyMigrations();
  Object.assign(e, {
    CREDENTIALS_KEY: 'test-credentials-key-0123456789ab',
    GOOGLE_DRIVE_CLIENT_ID: 'gid', GOOGLE_DRIVE_CLIENT_SECRET: 'gsecret',
    MICROSOFT_FILES_CLIENT_ID: 'mid', MICROSOFT_FILES_CLIENT_SECRET: 'msecret',
  });
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(U, 'fi@example.com', 'Fi'),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'FI', 'fi-ws', U),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_fi', ?, ?, 'admin')").bind(WS, U),
  ]);
});

let log: FakeLog;
beforeEach(() => {
  log = { calls: [], downloads: [] };
  vi.spyOn(timing, 'sleep').mockResolvedValue();
  queueKnowledgeSource.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete (e as { STORAGE_QUOTA_BYTES?: string }).STORAGE_QUOTA_BYTES; });

async function connect(provider: FileImportProvider = 'google_drive', expiresAt = FUTURE()): Promise<string> {
  await e.DB.prepare('DELETE FROM file_import_connections WHERE workspace_id = ? AND user_id = ? AND provider = ?').bind(WS, U, provider).run();
  return saveConnection(e, WS, U, provider, { accessToken: 'at-1', refreshToken: 'rt-1', expiresAt, scope: 'x' }, 'me@example.com');
}

async function source(connId: string, opts: Partial<SourceRow> = {}): Promise<SourceRow> {
  const id = `fis_t${++n}`;
  await e.DB.prepare(`INSERT INTO file_import_sources (id, workspace_id, connection_id, provider, remote_drive_id, remote_folder_id, remote_name, convert_enabled, daily_sync_enabled, next_sync_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id, WS, connId, opts.provider || 'google_drive', opts.remote_drive_id ?? null, opts.remote_folder_id || 'F0', opts.remote_name || `Client ${n}`,
    opts.convert_enabled ?? 0, opts.daily_sync_enabled ?? 0, opts.next_sync_at ?? null, U,
  ).run();
  return (await e.DB.prepare('SELECT * FROM file_import_sources WHERE id = ?').bind(id).first<SourceRow>())!;
}

async function run(s: SourceRow, limits?: Parameters<typeof runImport>[3]) {
  const fresh = (await e.DB.prepare('SELECT * FROM file_import_sources WHERE id = ?').bind(s.id).first<SourceRow>())!;
  const r = await createRun(e, fresh, 'manual', U);
  if ('conflict' in r) throw new Error('conflict');
  await runImport(e, r.runId, undefined, limits);
  return (await readRun(e, WS, r.runId))!;
}

function tree(): FakeFile[] {
  return [
    gFile('A', 'Contrato año.pdf', 'F0', 'application/pdf'),
    gFile('D', 'Plan', 'F0', 'application/vnd.google-apps.document'),
    gFile('Q', 'Survey', 'F0', 'application/vnd.google-apps.form'),
    gFile('J', 'run.js', 'F0', 'text/javascript'),
    gFolder('F1', 'Sub', 'F0'),
    gFile('B', 'notes.txt', 'F1', 'text/plain'),
    gFolder('F2', 'Deeper', 'F1'),
    gFile('C', 'deep.csv', 'F2', 'text/csv'),
  ];
}

describe('tokens', () => {
  it('stores tokens encrypted and decrypts them back', async () => {
    const id = await connect();
    const row = await e.DB.prepare('SELECT encrypted_credentials, iv FROM file_import_connections WHERE id = ?').bind(id).first<{ encrypted_credentials: string; iv: string }>();
    expect(row!.encrypted_credentials).not.toContain('at-1');
    expect(row!.encrypted_credentials).not.toContain('rt-1');
    const conn = (await findConnection(e, WS, U, 'google_drive'))!;
    expect(await accessTokenFor(e, conn)).toBe('at-1');
  });

  it('refreshes an expired token and keeps the refresh token', async () => {
    await connect('google_drive', new Date(Date.now() - 1000).toISOString());
    const f = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://oauth2.googleapis.com/token');
      expect(String(init.body)).toContain('refresh_token=rt-1');
      return Response.json({ access_token: 'at-2', expires_in: 3600 });
    });
    vi.stubGlobal('fetch', f);
    const conn = (await findConnection(e, WS, U, 'google_drive'))!;
    expect(await accessTokenFor(e, conn)).toBe('at-2');
    const again = (await findConnection(e, WS, U, 'google_drive'))!;
    expect(await accessTokenFor(e, again)).toBe('at-2');
    expect(f).toHaveBeenCalledOnce();
  });
});

describe('import run', () => {
  it('walks recursively, mirrors folders, exports native docs, skips the unexportable', async () => {
    const files = tree();
    vi.stubGlobal('fetch', fakeGoogle(files, log));
    const s = await source(await connect());
    const r = await run(s);
    expect(r.status).toBe('done');
    expect(r.counts).toMatchObject({ found: 6, imported: 4, skipped: 2, failed: 0 });
    expect(log.downloads).toContain('export:D:application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(log.downloads).not.toContain('media:Q');
    // The fake Doc export is not a real .docx, so its page fails; the file is still imported.
    expect(r.errors.map((x) => x.code).sort()).toEqual(['BLOCKED_TYPE', 'CONVERT_FAILED', 'NOT_EXPORTABLE']);

    const names = (await e.DB.prepare(`SELECT d.name, f.name AS folder FROM asset_deliverables d JOIN folders f ON f.id = d.folder_id WHERE d.workspace_id = ? AND d.folder_id IN
      (SELECT folder_id FROM file_import_items WHERE source_id = ?) `).bind(WS, s.id).all<{ name: string; folder: string }>()).results.sort((x, y) => x.name.localeCompare(y.name));
    expect(names).toEqual([
      { name: 'Contrato año.pdf', folder: s.remote_name },
      { name: 'deep.csv', folder: 'Deeper' },
      { name: 'notes.txt', folder: 'Sub' },
      { name: 'Plan', folder: s.remote_name },
    ]);
    const deeper = await e.DB.prepare("SELECT p.name FROM folders f JOIN folders p ON p.id = f.parent_id WHERE f.workspace_id = ? AND f.name = 'Deeper' ORDER BY f.created_at DESC").bind(WS).first<{ name: string }>();
    expect(deeper?.name).toBe('Sub');
    const vis = await e.DB.prepare("SELECT DISTINCT visibility FROM asset_deliverables WHERE folder_id IN (SELECT folder_id FROM file_import_items WHERE source_id = ?)").bind(s.id).all<{ visibility: string }>();
    expect(vis.results).toEqual([{ visibility: 'team' }]);
  });

  it('re-run fetches only what changed', async () => {
    const files = tree();
    vi.stubGlobal('fetch', fakeGoogle(files, log));
    const s = await source(await connect());
    await run(s);
    log.downloads.length = 0;
    files.find((f) => f.id === 'B')!.modifiedTime = '2026-10-10T00:00:00.000Z';
    files.find((f) => f.id === 'B')!.body = 'new notes';
    files.push(gFile('N', 'new.md', 'F2', 'text/markdown'));
    const r = await run(s);
    expect(log.downloads.sort()).toEqual(['media:B', 'media:N']);
    expect(r.counts).toMatchObject({ found: 7, imported: 2, unchanged: 3, skipped: 2 });
    const versions = await e.DB.prepare(`SELECT COUNT(*) AS n FROM blobs WHERE deliverable_id = (SELECT deliverable_id FROM file_import_items WHERE source_id = ? AND remote_id = 'B')`).bind(s.id).first<{ n: number }>();
    expect(versions?.n).toBe(2);
    // A third run with nothing changed downloads nothing.
    log.downloads.length = 0;
    expect((await run(s)).counts.imported).toBe(0);
    expect(log.downloads).toEqual([]);
  });

  it('turns documents and images into pages and updates the same page when the file changes', async () => {
    const files = [gFile('M', 'Guide.md', 'F0', 'text/markdown', '# Guide\n\nv1'), gFile('P', 'photo.png', 'F0', 'image/png')];
    vi.stubGlobal('fetch', fakeGoogle(files, log));
    const s = await source(await connect());
    const r = await run(s);
    expect(r.counts).toMatchObject({ imported: 2, converted: 2 });
    const photo = await e.DB.prepare("SELECT a.artifact_type FROM file_import_items i JOIN artifacts a ON a.id = i.artifact_id WHERE i.source_id = ? AND i.remote_id = 'P'").bind(s.id).first<{ artifact_type: string }>();
    expect(photo?.artifact_type).toBe('image');
    const item = await e.DB.prepare("SELECT artifact_id, artifact_slug FROM file_import_items WHERE source_id = ? AND remote_id = 'M'").bind(s.id).first<{ artifact_id: string; artifact_slug: string }>();
    const art = await e.DB.prepare('SELECT workspace_id, visibility, folder_id FROM artifacts WHERE id = ?').bind(item!.artifact_id).first<{ workspace_id: string; visibility: string; folder_id: string }>();
    expect(art).toMatchObject({ workspace_id: WS, visibility: 'workspace' });
    files[0].modifiedTime = '2026-10-12T00:00:00.000Z';
    files[0].body = '# Guide\n\nv2';
    await run(s);
    const again = await e.DB.prepare("SELECT artifact_id FROM file_import_items WHERE source_id = ? AND remote_id = 'M'").bind(s.id).first<{ artifact_id: string }>();
    expect(again!.artifact_id).toBe(item!.artifact_id);
    const versions = await e.DB.prepare('SELECT COUNT(*) AS n FROM versions WHERE artifact_id = ?').bind(item!.artifact_id).first<{ n: number }>();
    expect(versions!.n).toBe(2);
  });

  it('feeds Knowledge a file only when it has no page (the page is learned on publish)', async () => {
    vi.stubGlobal('fetch', fakeGoogle([gFile('K', 'k.txt', 'F0', 'text/plain'), gFile('A', 'a.mp3', 'F0', 'audio/mpeg')], log));
    const s = await source(await connect());
    await run(s);
    const ids = (await e.DB.prepare('SELECT remote_id, deliverable_id FROM file_import_items WHERE source_id = ?').bind(s.id).all<{ remote_id: string; deliverable_id: string }>()).results;
    const dlv = (id: string) => ids.find((x) => x.remote_id === id)!.deliverable_id;
    expect(queueKnowledgeSource).toHaveBeenCalledWith(e, undefined, expect.objectContaining({ workspaceId: WS, kind: 'asset', refId: dlv('A') }), expect.any(String));
    expect(queueKnowledgeSource).not.toHaveBeenCalledWith(e, undefined, expect.objectContaining({ refId: dlv('K') }), expect.any(String));
  });

  it('honours depth and count bounds', async () => {
    vi.stubGlobal('fetch', fakeGoogle(tree(), log));
    const r = await run(await source(await connect()), { maxDepth: 1, maxFolders: 100, maxFiles: 100 });
    expect(r.stopCode).toBe('WALK_LIMIT');
    expect(log.calls.some((c) => c.includes("'F2'"))).toBe(false);
    expect(r.errors.some((x) => x.code === 'TOO_DEEP')).toBe(true);
    const r2 = await run(await source(await connect()), { maxDepth: 20, maxFolders: 100, maxFiles: 2 });
    expect(r2.counts.found).toBe(2);
    expect(r2.stopCode).toBe('WALK_LIMIT');
  });

  it('stops cleanly when storage is full', async () => {
    vi.stubGlobal('fetch', fakeGoogle(tree(), log));
    (e as { STORAGE_QUOTA_BYTES?: string }).STORAGE_QUOTA_BYTES = '1';
    const r = await run(await source(await connect()));
    expect(r.status).toBe('stopped');
    expect(r.stopCode).toBe('STORAGE_QUOTA_EXCEEDED');
    expect(r.stopMessage).toMatch(/Storage is full/);
    expect(r.counts.imported).toBe(0);
  });

  it('a revoked connection stops the sync and the daily sweep skips it', async () => {
    vi.stubGlobal('fetch', fakeGoogle(tree(), log));
    const connId = await connect();
    const s = await source(connId, { daily_sync_enabled: 1, next_sync_at: new Date(Date.now() - 1000).toISOString() } as Partial<SourceRow>);
    const r = await createRun(e, s, 'manual', U);
    if ('conflict' in r) throw new Error('conflict');
    await deleteConnection(e, (await findConnection(e, WS, U, 'google_drive'))!);
    await runImport(e, r.runId);
    const after = (await getRun(e, r.runId))!;
    expect(after.status).toBe('stopped');
    expect(after.stop_code).toBe('CONNECTION_REVOKED');
    expect(log.downloads).toEqual([]);
    const src = await e.DB.prepare('SELECT connection_id, daily_sync_enabled FROM file_import_sources WHERE id = ?').bind(s.id).first();
    expect(src).toEqual({ connection_id: null, daily_sync_enabled: 0 });
    expect((await runDueFileImports(e)).started).toBe(0);
  });

  it('a 401 the refresh cannot fix stops the run as revoked', async () => {
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return fakeGoogle(tree(), log, { token: 'other' })(url, init);
    });
    const r = await run(await source(await connect()));
    expect(r.status).toBe('stopped');
    expect(r.stopCode).toBe('CONNECTION_REVOKED');
  });

  it('the daily sweep starts due sources once and moves them a day on', async () => {
    await e.DB.prepare('UPDATE file_import_sources SET daily_sync_enabled = 0').run();
    vi.stubGlobal('fetch', fakeGoogle([gFile('S', 's.txt', 'F0', 'text/plain')], log));
    const s = await source(await connect(), { daily_sync_enabled: 1, next_sync_at: new Date(Date.now() - 1000).toISOString() } as Partial<SourceRow>);
    expect((await runDueFileImports(e)).started).toBe(1);
    const row = await e.DB.prepare('SELECT next_sync_at, last_run_id FROM file_import_sources WHERE id = ?').bind(s.id).first<{ next_sync_at: string; last_run_id: string }>();
    expect(Date.parse(row!.next_sync_at)).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect((await getRun(e, row!.last_run_id))?.run_trigger).toBe('schedule');
    expect((await runDueFileImports(e)).started).toBe(0);
  });

  it('imports from OneDrive/SharePoint without sending the token to the download host', async () => {
    vi.stubGlobal('fetch', fakeGraph([
      { id: 'm1', name: 'Q3.docx', parent: 'root', body: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { id: 'mf', name: 'Legal', parent: 'root', folder: true },
      { id: 'm2', name: 'nda.pdf', parent: 'mf', body: '%PDF', mime: 'application/pdf' },
    ], log));
    const s = await source(await connect('microsoft'), { provider: 'microsoft', remote_drive_id: 'DRV1', remote_folder_id: 'root' } as Partial<SourceRow>);
    const r = await run(s);
    expect(r.status).toBe('done');
    expect(r.counts).toMatchObject({ found: 2, imported: 2, failed: 0 });
    expect(log.downloads.sort()).toEqual(['content:m1', 'content:m2']);
  });
});
