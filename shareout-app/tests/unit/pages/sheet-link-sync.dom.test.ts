// @vitest-environment happy-dom
//
// Inspector → Automate → "Sync from a shared link": the warning before anything is saved, the
// link check (public? tabs), the tab picker, a public_sheet_sync job and its first run.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_home_views_schedules_JS as schedulesJs } from '../../../src/pages/home/render-workspace/client-script/home-views/schedules';
import { workspace_client_home_views_autoForms_JS as autoFormsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/auto-forms';
import { workspace_client_home_views_modalsForms_JS as modalsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/modals-forms';
import { workspace_client_home_views_autoDetailShared_JS as sharedJs } from '../../../src/pages/home/render-workspace/client-script/home-views/automation-detail-shared';
import { workspace_client_home_views_sheetLinkSync_JS as sheetLinkJs } from '../../../src/pages/home/render-workspace/client-script/home-views/sheet-link-sync';
import { workspace_client_inspector_automate_JS as automateJs } from '../../../src/pages/home/render-workspace/client-script/inspector-automate';
import { LAZY_CHUNKS } from '../../../src/pages/home/render-workspace/client-script/lazy-chunks';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';

const copy = HOME_COPY.en as Record<string, string>;
const LINK = 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?usp=sharing';
let fetchMock: ReturnType<typeof vi.fn>;
let sent: Array<{ url: string; method: string; body: unknown }>;
const toast = vi.fn();
const openDriveSync = vi.fn();

function load(): { openSheetLinkSync: (art: { id: string; name: string }, onDone?: () => void) => void } {
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_test';
  const scope = new Proxy({}, {
    has: () => true,
    get: (target: Record<string | symbol, unknown>, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'window') return win;
      if (prop === 't') return (k: string) => copy[k] ?? k;
      if (prop === 'esc') return (s: unknown) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      if (prop === 'fetch') return (...a: unknown[]) => fetchMock(...a);
      if (prop === 'wsxToast') return toast;
      if (prop === 'openDriveSync') return openDriveSync;
      if (prop === 'viewerTz') return () => 'UTC';
      if (prop === 'locTag') return () => 'en-US';
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
  });
  return new Function('scope', `with (scope) {\n${schedulesJs}\n${autoFormsJs}\n${modalsJs}\n${sharedJs}\n${sheetLinkJs}\n; return { openSheetLinkSync }; }`)(scope);
}

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const modalText = () => document.querySelector('.wsx-modal')!.textContent || '';
const btn = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.wsx-modal button')].find((b) => b.textContent === label)!;
const setVal = (sel: string, v: string) => { const el = $<HTMLInputElement>(sel); el.value = v; el.dispatchEvent(new Event('change')); el.dispatchEvent(new Event('input')); };

const INSPECTED = { kind: 'sheets', fileName: 'Sales 2026', sheets: ['Summary', 'Raw'], sheet: 'Summary', rowCount: 2, columns: ['Region', 'Sales'] };

function routes(opts: { inspect?: [unknown, number]; run?: unknown } = {}) {
  sent = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET';
    sent.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url === '/v1/workspaces/wsp_test/sheet-links/inspect' && method === 'POST') return json(...(opts.inspect ?? [INSPECTED, 200]));
    if (url === '/v1/jobs' && method === 'POST') return json({ job: { id: 'job_7' } }, 201);
    if (url === '/v1/jobs/job_7/run') return json(opts.run ?? { message: 'Job executed successfully', execution: { status: 'success' } });
    return json({ error: 'unexpected ' + url }, 404);
  });
}

async function checkLink(link = LINK) {
  setVal('#slLink', link);
  btn(copy['slink.check']).click(); await flush();
}

beforeEach(() => {
  document.body.innerHTML = '';
  toast.mockReset(); openDriveSync.mockReset();
});

describe('Sync from a shared link', () => {
  it('is its own lazy chunk with the shared schedule fields', () => {
    expect(LAZY_CHUNKS.sheetlink.exports).toEqual(['openSheetLinkSync']);
    expect(LAZY_CHUNKS.sheetlink.src).toContain('function afScheduleFields(');
  });

  it('says who can read the file before anything is saved, and points to the private option', async () => {
    routes();
    const done = vi.fn();
    load().openSheetLinkSync({ id: 'art_1', name: 'Sales board' }, done);
    await flush();
    const warn = $('.wsx-slink__warn');
    expect(warn.textContent).toContain('Anyone who has this link can read the file');
    expect(warn.textContent).toContain('Never for personal data or anything confidential');
    expect(sent).toEqual([]);
    btn(copy['slink.usePrivate']).click();
    expect(document.querySelector('.wsx-modal')).toBeNull();
    expect(openDriveSync).toHaveBeenCalledWith({ id: 'art_1', name: 'Sales board' }, done);
  });

  it('check the link, pick a tab, hourly, save: one public_sheet_sync job, then a first sync', async () => {
    routes();
    const done = vi.fn();
    load().openSheetLinkSync({ id: 'art_1', name: 'Sales board' }, done);
    await flush();
    await checkLink();
    expect(sent[0]).toEqual({ url: '/v1/workspaces/wsp_test/sheet-links/inspect', method: 'POST', body: { link: LINK } });
    expect(modalText()).toContain('Sales 2026');
    expect($('#sl_preview').textContent).toBe('“Summary”: 2 rows');
    expect(modalText()).toContain(copy['slink.remind']);
    expect([...$<HTMLSelectElement>('#sl_tab').options].map((o) => o.value)).toEqual(['Summary', 'Raw']);
    expect($<HTMLInputElement>('#sl_name').value).toBe('sales_2026');
    setVal('#sl_tab', 'Raw');
    expect($('#sl_preview').textContent).toBe('');
    setVal('#sl_freq', 'hourly');
    btn(copy['dsync.save']).click(); await flush();

    expect(sent[1]).toEqual({ url: '/v1/jobs', method: 'POST', body: {
      artifact_id: 'art_1', action: 'public_sheet_sync', schedule: '0 * * * *',
      config: { link: LINK, dataset: 'sales_2026', fileName: 'Sales 2026', sheet: 'Raw' },
      title: 'Sync Sales 2026 from link',
    } });
    expect(sent[2]).toEqual({ url: '/v1/jobs/job_7/run', method: 'POST', body: null });
    expect(document.querySelector('.wsx-modal')).toBeNull();
    expect(toast).toHaveBeenCalledWith('Synced. The page now reads “sales_2026”.');
    expect(done).toHaveBeenCalled();
  });

  it('one tab: no picker, and the job still names it so a new tab in front changes nothing', async () => {
    routes({ inspect: [{ ...INSPECTED, sheets: ['Only'], sheet: 'Only' }, 200] });
    load().openSheetLinkSync({ id: 'art_1', name: 'Sales board' });
    await flush();
    await checkLink();
    expect(document.querySelector('#sl_tab')).toBeNull();
    btn(copy['dsync.save']).click(); await flush();
    expect(sent[1].body).toMatchObject({ config: { sheet: 'Only' } });
  });

  it('a link that is not public says how to change sharing, and nothing is saved', async () => {
    routes({ inspect: [{ error: 'not shared', code: 'NOT_PUBLIC' }, 422] });
    load().openSheetLinkSync({ id: 'art_1', name: 'Sales board' });
    await flush();
    await checkLink();
    expect($('#slErr').textContent).toBe(copy['slink.errNotPublic']);
    expect($('#slErr').textContent).toContain('Anyone with the link');
    expect(sent.map((s) => s.url)).toEqual(['/v1/workspaces/wsp_test/sheet-links/inspect']);
    expect(btn(copy['slink.check']).disabled).toBe(false);
  });

  it('a bad link shows the server’s reason; an empty one is refused without a request', async () => {
    routes({ inspect: [{ error: 'That link is not a spreadsheet.', code: 'BAD_LINK' }, 400] });
    load().openSheetLinkSync({ id: 'art_1', name: 'Sales board' });
    await flush();
    btn(copy['slink.check']).click(); await flush();
    expect($('#slErr').textContent).toBe(copy['slink.errEmpty']);
    expect(sent).toEqual([]);
    await checkLink('https://docs.google.com/document/d/abc/edit');
    expect($('#slErr').textContent).toBe('That link is not a spreadsheet.');
  });

  it('a failed first sync keeps the schedule and says why', async () => {
    routes({ run: { message: 'Job execution failed', execution: { status: 'failed', error: 'This file isn’t shared with "Anyone with the link".' } } });
    load().openSheetLinkSync({ id: 'art_1', name: 'Sales board' });
    await flush();
    await checkLink();
    btn(copy['dsync.save']).click(); await flush();
    expect(modalText()).toContain(copy['dsync.savedNotSynced']);
    expect(modalText()).toContain('This file isn’t shared with "Anyone with the link".');
    expect(toast).not.toHaveBeenCalled();
  });

  it('copy exists in English and Spanish', () => {
    const en = Object.keys(HOME_COPY.en).filter((k) => k.startsWith('slink.'));
    const es = Object.keys(HOME_COPY.es).filter((k) => k.startsWith('slink.'));
    expect(en.length).toBeGreaterThan(15);
    expect(es.sort()).toEqual(en.sort());
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
      openDriveSync: () => {}, openSheetLinkSync: (art: unknown) => { opened.push(art); },
    };
    const run = new Function('ctx', `with (ctx) { ${automateJs}; return { renderAutomate: renderAutomate }; }`)(ctx) as { renderAutomate: (a: unknown) => void };
    const art = { id: 'art_1', name: 'Sales board' };
    ctx.activeArt = art;
    run.renderAutomate(art);
    return { ctx, opened };
  }

  it('editors get the tile next to the Drive one, and it opens the link sync for this page', () => {
    const { ctx, opened } = paint(true);
    expect(ctx.rbodyEl.querySelector('[data-aauto="drivesync"]')).not.toBeNull();
    const tile = ctx.rbodyEl.querySelector<HTMLButtonElement>('[data-aauto="sheetlink"]');
    expect(tile).not.toBeNull();
    tile!.click();
    expect(opened).toEqual([{ id: 'art_1', name: 'Sales board' }]);
  });

  it('viewers do not', () => {
    expect(paint(false).ctx.rbodyEl.querySelector('[data-aauto="sheetlink"]')).toBeNull();
  });
});
