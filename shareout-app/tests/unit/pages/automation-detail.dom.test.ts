// @vitest-environment happy-dom
//
// Automation and AI task detail pages: a card opens its page (own route), which shows
// what it does, when it runs and its run history, and edits everything in one save.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_home_views_schedules_JS as schedulesJs } from '../../../src/pages/home/render-workspace/client-script/home-views/schedules';
import { workspace_client_home_views_autoForms_JS as autoFormsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/auto-forms';
import { workspace_client_home_views_modalsForms_JS as modalsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/modals-forms';
import { workspace_client_home_views_autoDetailShared_JS as sharedJs } from '../../../src/pages/home/render-workspace/client-script/home-views/automation-detail-shared';
import { workspace_client_home_views_jobDetail_JS as jobDetailJs } from '../../../src/pages/home/render-workspace/client-script/home-views/job-detail';
import { workspace_client_home_views_crew_JS as crewJs } from '../../../src/pages/home/render-workspace/client-script/home-views/crew';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';

type Lens = {
  loadSchedules: () => void;
  loadCrew: () => void;
  schedRoute: (id: string) => void;
  crewRoute: (id: string) => void;
  afCron: (freq: string, time: string, day: string, tz: string, at?: Date) => { cron?: string; err?: string };
  afParseCron: (cron: string, tz: string, at?: Date) => { freq: string; time: string; day: string } | null;
  state: () => { schedDetail: string; crewDetail: string };
};

const copy = HOME_COPY.en as Record<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;
let sent: Array<{ url: string; method: string; body: unknown }>;
const toast = vi.fn();
const syncHash = vi.fn();
const drawer = vi.fn();

function load(): Lens {
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_test';
  win.SO_openRunDrawer = drawer;
  const loaded = { schedules: 1, crew: 1 };
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
      if (prop === 'syncHash') return syncHash;
      if (prop === 'loaded') return loaded;
      if (prop === 'locTag') return () => 'en-US';
      if (prop === 'timeAgo') return () => 'just now';
      if (prop === 'isvg') return () => '<svg></svg>';
      if (prop === 'needWs') return () => false;
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
  });
  const body = `with (scope) {\n${schedulesJs}\n${autoFormsJs}\n${modalsJs}\n${sharedJs}\n${jobDetailJs}\n${crewJs}\n; return { loadSchedules, loadCrew, schedRoute, crewRoute, afCron, afParseCron, state: function () { return { schedDetail: schedDetail, crewDetail: crewDetail }; } }; }`;
  return new Function('scope', body)(scope);
}

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const setVal = (sel: string, v: string) => { const el = $<HTMLInputElement>(sel); el.value = v; el.dispatchEvent(new Event('change')); };

const JOB = {
  id: 'job_1', artifact_id: 'art_1', artifact_name: 'Sales', artifact_slug: 'sales', title: 'Daily sales', description: null,
  action: 'email', schedule: '0 12 * * *', config: { recipients: ['ana@x.com', 'bob@x.com'], includeArtifactLink: true },
  trigger_type: 'cron', enabled: true, last_status: 'failed', last_error: 'SMTP down', last_run_at: '2026-10-28T12:00:00Z', next_run_at: '2026-10-29T12:00:00Z',
};
const AUTO = {
  id: 'trg1', kind: 'cron', cron: '0 12 * * 1-5', enabled: true, crew_name: 'Daily report', crew_instructions: 'Summarise yesterday',
  crew_model: 'claude-sonnet-x', crew_max_iterations: 8, crew_run_budget_micro_usd: 250000, artifact_name: 'Weekly sales', artifact_slug: 'weekly-sales',
  owner_name: 'Leo', last_run_at: '2026-10-28T13:03:00Z', next_run_at: '2026-10-29T12:00:00Z',
};

function routes(over: Record<string, unknown> = {}) {
  sent = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET';
    if (method !== 'GET') {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      sent.push({ url, method, body });
      if (url === '/v1/jobs/job_1' && method === 'PATCH') return json(over.patch ?? { job: { ...JOB, ...(body as object), artifact_name: undefined } });
      return json({ success: true });
    }
    if (url.startsWith('/v1/jobs?')) return json({ jobs: [JOB] });
    if (url === '/v1/jobs/job_1/logs') return json({ logs: [
      { id: 'log2', status: 'failed', created_at: '2026-10-28T12:00:00Z', duration_ms: 1200, error: 'SMTP down' },
      { id: 'log1', status: 'success', created_at: '2026-10-27T12:00:00Z', duration_ms: 900, error: null },
    ] });
    if (url === '/v1/workspaces/wsp_test/automations') return json({ automations: [AUTO], models: ['claude-sonnet-x', 'claude-haiku-y'] });
    if (url === '/v1/workspaces/wsp_test/automations/trg1/runs') return json({ runs: [{ id: 'run1', status: 'done', started_at: '2026-10-28T13:03:00Z', ended_at: '2026-10-28T13:03:20Z', result_text: 'Sent the report' }] });
    return json({});
  });
}

beforeEach(() => {
  document.body.innerHTML = '<div id="wsxSchedMount"></div><div id="wsxCrewMount"></div>';
  toast.mockReset(); syncHash.mockReset(); drawer.mockReset();
});

describe('automation detail page', () => {
  it('a card opens its page: what it does, when it runs, and every run', async () => {
    routes();
    const lens = load();
    lens.loadSchedules(); await flush();
    $('.wsx-sched[data-job] .wsx-sched__flow').click(); await flush();
    expect(lens.state().schedDetail).toBe('job_1');
    expect(syncHash).toHaveBeenCalled();
    expect($('.wsx-adet__title').textContent).toBe('Daily sales');
    expect($('[data-jd-dest]').textContent).toBe('ana@x.com, bob@x.com');
    expect(document.querySelector('.wsx-adet')!.textContent).toContain('SMTP down');
    const runs = [...document.querySelectorAll<HTMLElement>('.wsx-adet__run')];
    expect(runs.map((r) => r.querySelector('.wsx-adet__pill')!.textContent)).toEqual(['Failed', 'OK']);
    runs[0].click();
    expect(drawer).toHaveBeenCalledWith('job', 'log2');

    $('[data-jd="back"]').click(); await flush();
    expect(lens.state().schedDetail).toBe('');
    expect(document.querySelector('.wsx-sched[data-job]')).not.toBeNull();
  });

  it('saves name, schedule and recipients in one PATCH, sending only what changed', async () => {
    routes();
    const lens = load();
    lens.loadSchedules(); await flush();
    lens.schedRoute('job_1'); await flush();
    $('[data-jd="edit"]').click();
    setVal('#jd_title', 'Weekday sales');
    setVal('#jd_freq', 'weekdays'); setVal('#jd_time', '08:30'); setVal('#jd_tz', 'UTC');
    setVal('#jd_to', 'ana@x.com, carl@x.com');
    $('[data-jd="save"]').click(); await flush();
    expect(sent).toEqual([{ url: '/v1/jobs/job_1', method: 'PATCH', body: {
      title: 'Weekday sales', schedule: '30 8 * * 1-5', config: { recipients: ['ana@x.com', 'carl@x.com'], includeArtifactLink: true },
    } }]);
    expect($('.wsx-adet__title').textContent).toBe('Weekday sales');
    expect(document.querySelector('#jd_title')).toBeNull();
    expect(toast).toHaveBeenCalledWith(copy['adet.saved']);
  });

  it('shows the server\'s reason and keeps the form when it refuses', async () => {
    routes({ patch: { error: 'Invalid cron expression' } });
    const lens = load();
    lens.loadSchedules(); await flush();
    lens.schedRoute('job_1'); await flush();
    $('[data-jd="edit"]').click();
    setVal('#jd_freq', 'custom'); setVal('#jd_cron', '99 * * * *');
    $('[data-jd="save"]').click(); await flush();
    expect($('#jd_err').textContent).toBe('Invalid cron expression');
    expect(document.querySelector('#jd_title')).not.toBeNull();
  });

  it('the full JSON config wins when edited, and invalid JSON is refused before saving', async () => {
    routes();
    const lens = load();
    lens.loadSchedules(); await flush();
    lens.schedRoute('job_1'); await flush();
    $('[data-jd="edit"]').click();
    setVal('#jd_json', '{ nope');
    $('[data-jd="save"]').click(); await flush();
    expect($('#jd_err').textContent).toBe(copy['adet.errJson']);
    expect(sent).toEqual([]);
    setVal('#jd_json', '{"recipients":["z@x.com"],"subject":"Daily"}');
    $('[data-jd="save"]').click(); await flush();
    expect(sent[0].body).toEqual({ config: { recipients: ['z@x.com'], subject: 'Daily' } });
  });

  it('delete goes back to the list', async () => {
    routes();
    const lens = load();
    lens.loadSchedules(); await flush();
    lens.schedRoute('job_1'); await flush();
    (window as unknown as { confirm: () => boolean }).confirm = () => true;
    $('[data-jd="del"]').click(); await flush();
    expect(sent).toEqual([{ url: '/v1/jobs/job_1', method: 'DELETE', body: null }]);
    expect(lens.state().schedDetail).toBe('');
  });
});

describe('schedule fields read a stored cron back', () => {
  const tz = 'America/Argentina/Buenos_Aires';   // UTC-3, no DST
  it('round-trips every simple frequency, including ones that cross midnight in UTC', () => {
    const lens = load();
    for (const [freq, time, day] of [['daily', '09:00', '1'], ['weekdays', '22:30', '1'], ['weekly', '23:00', '0'], ['monthly', '22:00', '1'], ['hourly', '09:00', '1']]) {
      const { cron } = lens.afCron(freq, time, day, tz);
      expect(lens.afParseCron(cron!, tz), `${freq} ${time} → ${cron}`).toEqual({ freq, time, day });
    }
    expect(lens.afCron('weekdays', '22:30', '1', tz).cron).toBe('30 1 * * 2-6');
  });
  it('leaves anything else to the custom field', () => {
    const lens = load();
    expect(lens.afParseCron('*/15 * * * *', tz)).toBeNull();
    expect(lens.afParseCron('0 9 * * 1,3', tz)).toBeNull();
  });
});

describe('AI task detail page', () => {
  it('a card opens its page with instructions, limits and runs', async () => {
    routes();
    const lens = load();
    lens.loadCrew(); await flush();
    $('.wsx-sched[data-crew] .wsx-sched__flow').click(); await flush();
    expect(lens.state().crewDetail).toBe('trg1');
    expect($('.wsx-adet__instr').textContent).toBe('Summarise yesterday');
    expect(document.querySelector('.wsx-adet')!.textContent).toContain('8 steps · US$ 0.25');
    const run = $('.wsx-adet__run');
    expect(run.textContent).toContain('Sent the report');
    run.click();
    expect(drawer).toHaveBeenCalledWith('crew', 'run1');
  });

  it('edits name, instructions, model and budget through the workspace automation PATCH', async () => {
    routes();
    const lens = load();
    lens.loadCrew(); await flush();
    lens.crewRoute('trg1'); await flush();
    $('[data-cd="edit"]').click();
    setVal('#cd_name', 'Weekly report');
    setVal('#cd_instr', 'Summarise the week');
    setVal('#cd_model', 'claude-haiku-y');
    setVal('#cd_budget', '0.50');
    $('[data-cd="save"]').click(); await flush();
    expect(sent).toEqual([{ url: '/v1/workspaces/wsp_test/automations/trg1', method: 'PATCH', body: {
      name: 'Weekly report', instructions: 'Summarise the week', model: 'claude-haiku-y', runBudgetMicroUsd: 500000,
    } }]);
    expect($('.wsx-adet__title').textContent).toBe('Weekly report');
    expect(document.querySelector('.wsx-adet')!.textContent).toContain('US$ 0.50');
  });

  it('refuses an empty name before saving', async () => {
    routes();
    const lens = load();
    lens.loadCrew(); await flush();
    lens.crewRoute('trg1'); await flush();
    $('[data-cd="edit"]').click();
    setVal('#cd_name', '  ');
    $('[data-cd="save"]').click(); await flush();
    expect($('#cd_err').textContent).toBe(copy['adet.errName']);
    expect(sent).toEqual([]);
  });

  it('pause from the page sends only enabled', async () => {
    routes();
    const lens = load();
    lens.loadCrew(); await flush();
    lens.crewRoute('trg1'); await flush();
    $('[data-cd="toggle"]').click(); await flush();
    expect(sent).toEqual([{ url: '/v1/workspaces/wsp_test/automations/trg1', method: 'PATCH', body: { enabled: false } }]);
    expect($('[data-cd="toggle"]').textContent).toBe(copy['crew.resume']);
  });
});
