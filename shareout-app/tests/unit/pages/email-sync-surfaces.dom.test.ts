// @vitest-environment happy-dom
//
// "Update by email" outside its own panel: the Automate tab groups the three ways data comes in
// under one heading (the email tile says when it is on), the running row opens the panel, and the
// Automations list/detail say "when an email with the file arrives" with the address — never the
// event code, a cron or "Run now" — in the viewer's language.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_inspector_automate_JS as automateJs } from '../../../src/pages/home/render-workspace/client-script/inspector-automate';
import { workspace_client_home_views_schedules_JS as schedulesJs } from '../../../src/pages/home/render-workspace/client-script/home-views/schedules';
import { workspace_client_home_views_autoForms_JS as autoFormsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/auto-forms';
import { workspace_client_home_views_modalsForms_JS as modalsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/modals-forms';
import { workspace_client_home_views_autoDetailShared_JS as sharedJs } from '../../../src/pages/home/render-workspace/client-script/home-views/automation-detail-shared';
import { workspace_client_home_views_jobDetail_JS as jobDetailJs } from '../../../src/pages/home/render-workspace/client-script/home-views/job-detail';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';

const en = HOME_COPY.en as Record<string, string>;
const es = HOME_COPY.es as Record<string, string>;
const ADDRESS = 'ventas-x1@inbox.shareout.site';
// Set up by someone whose screen was in Spanish; read here by someone in English.
const EMAIL_JOB = {
  id: 'job_e', artifact_id: 'art_1', artifact_name: 'Ventas', artifact_slug: 'ventas', title: 'Actualizar por email', description: null,
  action: 'email_sheet_sync', schedule: '', config: { dataset: 'ventas' }, trigger_type: 'event', event_type: 'email.received',
  enabled: true, last_status: 'success', last_error: null, last_run_at: '2026-11-18T12:00:00Z', next_run_at: '2026-11-19T12:00:00Z',
};

describe('Automate tab', () => {
  function paint(jobs: unknown[]) {
    const win = globalThis.window as unknown as Record<string, unknown>;
    win.WSX_WS = 'wsp_test';
    const opened: unknown[] = [];
    const ctx = {
      rbodyEl: document.createElement('div'),
      autoCache: { art_1: { jobs, alerts: [] } } as Record<string, unknown>,
      metaCache: { art_1: { can_edit: true } } as Record<string, unknown>,
      activeArt: null as unknown, window: win,
      i18nLoad: () => '', i18nEmpty: (k: string) => k, esc: (s: string) => String(s), t: (k: string) => en[k] ?? k,
      cronHuman: (s: string) => s, isvg: () => '', okOr: (r: unknown) => r, failToast: () => {},
      openAutoForm: () => {}, agentAsk: () => {}, railRetry: () => {}, fetchMeta: () => {},
      renderDeliver: () => {}, renderWatches: () => {},
      openDriveSync: () => {}, openSheetLinkSync: () => {}, openEmailSync: (art: unknown) => { opened.push(art); },
    };
    const run = new Function('ctx', `with (ctx) { ${automateJs}; return { renderAutomate: renderAutomate }; }`)(ctx) as { renderAutomate: (a: unknown) => void };
    const art = { id: 'art_1', name: 'Ventas' };
    ctx.activeArt = art;
    run.renderAutomate(art);
    return { box: ctx.rbodyEl, opened };
  }

  it('groups Drive, link and email under “Update the data”, above Monitoring and Send now', () => {
    const { box } = paint([]);
    const labels = [...box.querySelectorAll('.wsx-auto__sec > .wsx-det__label')].map((l) => (l.querySelector('.wsx-det__labeltxt') || l).textContent);
    expect(labels[0]).toBe(en['inspector.dataIn']);
    expect(labels.indexOf(en['inspector.dataIn'])).toBeLessThan(labels.indexOf(en['inspector.watches']));
    const first = box.querySelector('.wsx-auto__sec')!;
    expect([...first.querySelectorAll('[data-aauto]')].map((b) => b.getAttribute('data-aauto'))).toEqual(['drivesync', 'sheetlink', 'emailsync']);
    expect(first.textContent).toContain(en['esync.tileSub']);
    // Nothing is lost: schedule, alert and crew still there.
    for (const k of ['schedule', 'alert', 'crew', 'chat']) expect(box.querySelector(`[data-aauto="${k}"]`)).not.toBeNull();
  });

  it('when on: the tile says so, and the running row opens the panel in the viewer’s language', () => {
    const { box, opened } = paint([EMAIL_JOB]);
    expect(box.querySelector('.wsx-auto__sec [data-aauto="emailsync"]')!.textContent).toContain(en['esync.tileOn']);
    const row = box.querySelector<HTMLButtonElement>('.wsx-list [data-aauto="emailsync"]')!;
    expect(row.tagName).toBe('BUTTON');
    expect(row.textContent).toContain(en['esync.jobTitle']);
    expect(row.textContent).not.toContain('Actualizar por email');
    expect(row.textContent).toContain(en['esync.rowSub']);
    row.click();
    expect(opened).toEqual([{ id: 'art_1', name: 'Ventas' }]);
  });
});

describe('Automations list and detail', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const opened: unknown[] = [];
  function load(copy: Record<string, string>) {
    const win = globalThis.window as unknown as Record<string, unknown>;
    win.WSX_WS = 'wsp_test';
    const loaded = { schedules: 1 };
    const scope = new Proxy({}, {
      has: () => true,
      get: (target: Record<string | symbol, unknown>, prop) => {
        if (typeof prop === 'symbol') return undefined;
        if (prop in target) return target[prop];
        if (prop === 'window') return win;
        if (prop === 't') return (k: string) => copy[k] ?? k;
        if (prop === 'esc') return (s: unknown) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        if (prop === 'fetch') return (...a: unknown[]) => fetchMock(...a);
        if (prop === 'loaded') return loaded;
        if (prop === 'locTag') return () => 'en-US';
        if (prop === 'timeAgo') return () => 'just now';
        if (prop === 'isvg') return () => '<svg></svg>';
        if (prop === 'openEmailSync') return (art: unknown) => { opened.push(art); };
        if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
        return () => '';
      },
    });
    const body = `with (scope) {\n${schedulesJs}\n${autoFormsJs}\n${modalsJs}\n${sharedJs}\n${jobDetailJs}\n; return { loadSchedules, schedRoute }; }`;
    return new Function('scope', body)(scope) as { loadSchedules: () => void; schedRoute: (id: string) => void };
  }
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
  const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } });

  beforeEach(() => {
    document.body.innerHTML = '<div id="wsxSchedMount"></div>';
    opened.length = 0;
    fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/v1/jobs?')) return json({ jobs: [EMAIL_JOB] });
      if (url === '/v1/jobs/job_e/logs') return json({ logs: [] });
      if (url === '/v1/artifacts/art_1/email-sync') return json({ address: ADDRESS, reads: ['ventas'] });
      return json({});
    });
  });

  it('the list says when it runs in plain words, shows the address, and has no Run now', async () => {
    load(en).loadSchedules(); await flush();
    const card = document.querySelector('.wsx-sched[data-job="job_e"]')!;
    expect(card.querySelector('.wsx-sched__title')!.textContent).toBe(en['esync.jobTitle']);
    expect(card.textContent).toContain(en['esync.rowSub']);
    expect(card.textContent).not.toMatch(/email\.received|happens/);
    expect(card.querySelector('[data-es-addr]')!.textContent).toBe(ADDRESS);
    expect(card.querySelector('[data-sched-run]')).toBeNull();
    // An event job has no "next run".
    expect(card.textContent).not.toContain(en['sched.next']);
  });

  it('the same job reads in Spanish for a Spanish viewer', async () => {
    load(es).loadSchedules(); await flush();
    expect(document.querySelector('.wsx-sched__title')!.textContent).toBe('Actualizar por email');
    expect(document.querySelector('.wsx-sched')!.textContent).toContain(es['esync.rowSub']);
  });

  it('the detail page: plain when, the address, a button to the panel instead of Run now', async () => {
    const lens = load(en);
    lens.loadSchedules(); await flush();
    lens.schedRoute('job_e'); await flush();
    const page = document.querySelector('.wsx-adet')!;
    expect(page.querySelector('.wsx-adet__title')!.textContent).toBe(en['esync.jobTitle']);
    expect(page.textContent).toContain(en['esync.rowSub']);
    expect(page.textContent).not.toMatch(/email\.received/);
    expect(page.querySelector('[data-jd-addr]')!.textContent).toBe(ADDRESS);
    expect(page.querySelector('[data-jd="run"]')).toBeNull();
    page.querySelector<HTMLButtonElement>('[data-jd="esync"]')!.click();
    expect(opened).toEqual([{ id: 'art_1', name: 'Ventas' }]);
  });

  it('editing: the file name is “starts with”, and a name the page does not show is flagged as you type', async () => {
    const lens = load(en);
    lens.loadSchedules(); await flush();
    lens.schedRoute('job_e'); await flush();
    document.querySelector<HTMLButtonElement>('[data-jd="edit"]')!.click(); await flush();
    expect(document.body.textContent).toContain(en['esync.dataset']);
    const ds = document.querySelector<HTMLInputElement>('#jd_dataset')!, warn = document.querySelector<HTMLElement>('#jd_dswarn')!;
    expect(warn.hidden).toBe(true);
    ds.value = 'otra'; ds.dispatchEvent(new Event('input'));
    expect(warn.hidden).toBe(false);
    expect(warn.textContent).toContain('“otra”');
    ds.value = 'ventas'; ds.dispatchEvent(new Event('input'));
    expect(warn.hidden).toBe(true);
  });
});

describe('phones and tablets: the right rail opens as a sheet', () => {
  it('the artifact bar has an Options button; it opens and closes the sheet', async () => {
    const { buildWorkspaceBody } = await import('../../../src/pages/home/render-workspace/template');
    const { workspace_client_inspector_sheet_JS: sheetJs } = await import('../../../src/pages/home/render-workspace/client-script/inspector-sheet');
    const { WORKSPACE_STYLES } = await import('../../../src/pages/home/render-workspace/styles');
    const base = { user: { id: 'u', email: null }, userInfo: null, workspaces: [], workspace: '', workspaceId: null, workspaceRole: null, createEnabled: false };
    document.body.innerHTML = buildWorkspaceBody(base as never);
    const btn = document.getElementById('wsxInspBtn')!, ws = document.getElementById('wsx')!;
    expect(btn.closest('#wsxArtBar')).not.toBeNull();
    expect(document.getElementById('wsxInspClose')!.closest('.wsx__activity')).not.toBeNull();
    // Below 1100px the sheet rule beats the one that hides the rail.
    expect(WORKSPACE_STYLES).toMatch(/@media \(max-width: 1100px\) \{[^@]*\.wsx\.is-insp-open \.wsx__activity \{ display: flex; position: fixed;/);
    new Function('ws', sheetJs + '; return inspSheet;')(ws);
    btn.click();
    expect(ws.classList.contains('is-insp-open')).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('wsxInspScrim')!.hidden).toBe(false);
    document.getElementById('wsxInspClose')!.click();
    expect(ws.classList.contains('is-insp-open')).toBe(false);
    btn.click();
    document.getElementById('wsxInspScrim')!.click();
    expect(ws.classList.contains('is-insp-open')).toBe(false);
    btn.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(ws.classList.contains('is-insp-open')).toBe(false);
  });
});
