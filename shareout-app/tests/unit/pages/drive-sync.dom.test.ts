// @vitest-environment happy-dom
//
// Inspector → Automate → "Sync data from Google Drive": connect, pick one spreadsheet,
// choose how often (hourly / daily / weekly …), save a drive_file_sync job, first run.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_home_views_schedules_JS as schedulesJs } from '../../../src/pages/home/render-workspace/client-script/home-views/schedules';
import { workspace_client_home_views_autoForms_JS as autoFormsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/auto-forms';
import { workspace_client_home_views_modalsForms_JS as modalsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/modals-forms';
import { workspace_client_home_views_autoDetailShared_JS as sharedJs } from '../../../src/pages/home/render-workspace/client-script/home-views/automation-detail-shared';
import { workspace_client_home_views_driveSync_JS as driveSyncJs } from '../../../src/pages/home/render-workspace/client-script/home-views/drive-sync';
import { workspace_client_inspector_automate_JS as automateJs } from '../../../src/pages/home/render-workspace/client-script/inspector-automate';
import { LAZY_CHUNKS } from '../../../src/pages/home/render-workspace/client-script/lazy-chunks';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';

const copy = HOME_COPY.en as Record<string, string>;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let fetchMock: ReturnType<typeof vi.fn>;
let sent: Array<{ url: string; method: string; body: unknown }>;
const toast = vi.fn();
const openWin = vi.fn();

function load(): { openDriveSync: (art: { id: string; name: string }, onDone?: () => void) => void } {
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_test';
  win.open = openWin;
  const scope = new Proxy({}, {
    has: () => true,
    get: (target: Record<string | symbol, unknown>, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'window') return win;
      if (prop === 't') return (k: string) => copy[k] ?? k;
      if (prop === 'esc') return (s: unknown) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      if (prop === 'fetch') return (...a: unknown[]) => fetchMock(...a);
      if (prop === 'okOr') return (r: Response) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; };
      if (prop === 'errReason') return (_e: unknown, fb: string) => fb;
      if (prop === 'i18nLoad') return () => '<p>loading</p>';
      if (prop === 'wsxToast') return toast;
      if (prop === 'viewerTz') return () => 'UTC';
      if (prop === 'locTag') return () => 'en-US';
      if (prop === 'timeAgo') return () => '2 days ago';
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
  });
  return new Function('scope', `with (scope) {\n${schedulesJs}\n${autoFormsJs}\n${modalsJs}\n${sharedJs}\n${driveSyncJs}\n; return { openDriveSync }; }`)(scope);
}

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const btn = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.wsx-modal button')].find((b) => b.textContent === label)!;
const setVal = (sel: string, v: string) => { const el = $<HTMLInputElement>(sel); el.value = v; el.dispatchEvent(new Event('change')); el.dispatchEvent(new Event('input')); };

function routes(opts: { connected?: boolean; run?: unknown } = {}) {
  sent = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET';
    if (method !== 'GET') sent.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url === '/v1/workspaces/wsp_test/file-imports') return json({ providers: [{ id: 'google_drive', connected: opts.connected ?? true, accountEmail: 'me@drive.test' }], sources: [] });
    if (url.startsWith('/v1/workspaces/wsp_test/file-imports/browse/google_drive?files=sheets&ref=root')) {
      return json({ entries: [{ ref: 'my', name: 'My Drive', kind: 'drive', selectable: false }] });
    }
    if (url.startsWith('/v1/workspaces/wsp_test/file-imports/browse/google_drive?files=sheets&ref=my')) {
      return json({ entries: [
        { ref: 'folder:-:F1', name: 'Finance', kind: 'folder', selectable: false },
        { ref: 'file:-:XL1', name: 'Sales 2026.xlsx', kind: 'file', selectable: true, fileId: 'XL1', mime: XLSX_MIME, modifiedAt: '2026-11-16T10:00:00Z' },
      ] });
    }
    if (url === '/v1/jobs' && method === 'POST') return json({ job: { id: 'job_9' } }, 201);
    if (url === '/v1/jobs/job_9/run') return json(opts.run ?? { message: 'Job executed successfully', execution: { status: 'success' } });
    return json({ error: 'unexpected ' + url }, 404);
  });
}

async function toForm() {
  btn(copy['dsync.pick']).click(); await flush();
  btn(copy['fimp.open']).click(); await flush();
  expect(document.querySelector('.wsx-modal')!.textContent).toContain('Finance');
  btn(copy['fimp.select']).click(); await flush();
}

beforeEach(() => {
  document.body.innerHTML = '';
  toast.mockReset(); openWin.mockReset();
});

describe('Drive sync modal', () => {
  it('is a lazy chunk with the shared schedule fields', () => {
    expect(LAZY_CHUNKS.drivesync.exports).toEqual(['openDriveSync']);
    expect(LAZY_CHUNKS.drivesync.src).toContain('function afScheduleFields(');
  });

  it('not connected: Connect opens the Drive consent popup', async () => {
    routes({ connected: false });
    load().openDriveSync({ id: 'art_1', name: 'Sales board' });
    await flush();
    btn(copy['fimp.connect']).click();
    expect(openWin).toHaveBeenCalledWith('/v1/workspaces/wsp_test/file-imports/connect/google_drive', 'soFileImport', 'width=520,height=680');
  });

  it('pick a spreadsheet, choose hourly, save: one drive_file_sync job, then a first sync', async () => {
    routes();
    const done = vi.fn();
    load().openDriveSync({ id: 'art_1', name: 'Sales board' }, done);
    await flush();
    await toForm();
    expect($<HTMLInputElement>('#ds_name').value).toBe('sales_2026');
    expect($('#ds_hint').textContent).toBe("The page reads it with sdk.dataset('sales_2026').get().");
    const freqs = [...$<HTMLSelectElement>('#ds_freq').options].map((o) => o.value);
    expect(freqs).toEqual(expect.arrayContaining(['hourly', 'daily', 'weekly', 'monthly']));
    setVal('#ds_freq', 'hourly');
    btn(copy['dsync.save']).click(); await flush();

    expect(sent[0]).toEqual({ url: '/v1/jobs', method: 'POST', body: {
      artifact_id: 'art_1', action: 'drive_file_sync', schedule: '0 * * * *',
      config: { provider: 'google_drive', fileId: 'XL1', fileName: 'Sales 2026.xlsx', dataset: 'sales_2026' },
      title: 'Sync Sales 2026.xlsx from Google Drive',
    } });
    expect(sent[1]).toEqual({ url: '/v1/jobs/job_9/run', method: 'POST', body: null });
    expect(document.querySelector('.wsx-modal')).toBeNull();
    expect(toast).toHaveBeenCalledWith('Synced. The page now reads “sales_2026”.');
    expect(done).toHaveBeenCalled();
  });

  it('weekly on Wednesday 07:30 with a named tab and dataset', async () => {
    routes();
    load().openDriveSync({ id: 'art_1', name: 'Sales board' });
    await flush();
    await toForm();
    setVal('#ds_freq', 'weekly');
    setVal('#ds_day', '3');
    setVal('#ds_time', '07:30');
    setVal('#ds_tz', 'UTC');
    setVal('#ds_tab', 'Summary');
    setVal('#ds_name', 'weekly_sales');
    btn(copy['dsync.save']).click(); await flush();
    expect(sent[0].body).toMatchObject({ schedule: '30 7 * * 3', config: { sheet: 'Summary', dataset: 'weekly_sales' } });
  });

  it('a pasted Drive link works, and a bad dataset name is refused before saving', async () => {
    routes();
    load().openDriveSync({ id: 'art_1', name: 'Sales board' });
    await flush();
    btn(copy['dsync.pick']).click(); await flush();
    setVal('#dsLink', 'not a link');
    btn(copy['dsync.useLink']).click();
    expect($('#dsLinkErr').textContent).toBe(copy['dsync.errLink']);
    setVal('#dsLink', 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0');
    btn(copy['dsync.useLink']).click(); await flush();
    setVal('#ds_name', 'has space');
    btn(copy['dsync.save']).click(); await flush();
    expect($('#ds_err').textContent).toBe(copy['dsync.errName']);
    expect(sent).toEqual([]);
    setVal('#ds_name', 'linked');
    btn(copy['dsync.save']).click(); await flush();
    expect(sent[0].body).toMatchObject({ config: { fileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', dataset: 'linked' } });
  });

  it('a failed first sync keeps the schedule and says why', async () => {
    routes({ run: { message: 'Job execution failed', execution: { status: 'failed', error: 'The file is gone or no longer shared with the job owner.' } } });
    load().openDriveSync({ id: 'art_1', name: 'Sales board' });
    await flush();
    await toForm();
    btn(copy['dsync.save']).click(); await flush();
    const text = document.querySelector('.wsx-modal')!.textContent;
    expect(text).toContain(copy['dsync.savedNotSynced']);
    expect(text).toContain('The file is gone or no longer shared with the job owner.');
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('Automate tab tile', () => {
  function paint(canEdit: boolean) {
    const win = globalThis.window as unknown as Record<string, unknown>;
    win.WSX_WS = 'wsp_test';
    const opened: unknown[] = [];
    const ctx = {
      rbodyEl: document.createElement('div'),
      autoCache: { art_1: { jobs: [], alerts: [] } } as Record<string, unknown>,
      metaCache: { art_1: { can_edit: canEdit } } as Record<string, unknown>,
      activeArt: null as unknown, window: win,
      i18nLoad: () => '', i18nEmpty: (k: string) => k, esc: (s: string) => String(s), t: (k: string) => k,
      cronHuman: (s: string) => s, isvg: () => '', okOr: (r: unknown) => r, failToast: () => {},
      openAutoForm: () => {}, agentAsk: () => {}, railRetry: () => {}, fetchMeta: () => {},
      renderDeliver: () => {}, renderWatches: () => {},
      openDriveSync: (art: unknown) => { opened.push(art); },
    };
    const run = new Function('ctx', `with (ctx) { ${automateJs}; return { renderAutomate: renderAutomate }; }`)(ctx) as { renderAutomate: (a: unknown) => void };
    const art = { id: 'art_1', name: 'Sales board' };
    ctx.activeArt = art;
    run.renderAutomate(art);
    return { ctx, opened };
  }

  it('editors get the tile and it opens the Drive sync for this page', () => {
    const { ctx, opened } = paint(true);
    const tile = ctx.rbodyEl.querySelector<HTMLButtonElement>('[data-aauto="drivesync"]');
    expect(tile).not.toBeNull();
    tile!.click();
    expect(opened).toEqual([{ id: 'art_1', name: 'Sales board' }]);
  });

  it('viewers do not', () => {
    expect(paint(false).ctx.rbodyEl.querySelector('[data-aauto="drivesync"]')).toBeNull();
  });
});
