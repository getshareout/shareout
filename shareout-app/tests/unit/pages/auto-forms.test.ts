// @vitest-environment happy-dom
//
// Step-by-step (no AI) "Schedule a send" / "Create alert" forms and the
// Schedules/Alerts lens list actions (finding B3).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_home_views_schedules_JS as schedulesJs } from '../../../src/pages/home/render-workspace/client-script/home-views/schedules';
import { workspace_client_home_views_autoForms_JS as autoFormsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/auto-forms';
import { workspace_client_home_views_modalsForms_JS as modalsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/modals-forms';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';

type Lens = {
  afCron: (freq: string, time: string, day: string, tz: string, at?: Date) => { cron?: string; err?: string };
  openAutoForm: (kind: string, preset?: { id: string; name: string }, onDone?: () => void) => { close: () => void };
  loadSchedules: () => void;
  loadAlerts: () => void;
};

const copy = HOME_COPY.en as Record<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;
const agentAsk = vi.fn();
const toast = vi.fn();

function loadLens(): Lens {
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
      if (prop === 'agentAsk') return agentAsk;
      if (prop === 'wsxToast') return toast;
      if (prop === 'loaded') return {};
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
  });
  const body = `with (scope) {\n${schedulesJs}\n${autoFormsJs}\n${modalsJs}\n; return { afCron, openAutoForm, loadSchedules, loadAlerts }; }`;
  return new Function('scope', body)(scope);
}

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const setVal = (sel: string, v: string) => { const el = $<HTMLInputElement>(sel); el.value = v; el.dispatchEvent(new Event('change')); };

function status(role: string, extra: Record<string, unknown> = {}) {
  return {
    role,
    email: { available: true, address: 'laura@incro.com' },
    telegram: { linked: false },
    slack: { available: true, connected: true, connectionName: 'slack-incro' },
    ...extra,
  };
}

function routeFetch(st: unknown, defs: unknown[] = [], posts: Array<{ url: string; body: unknown; method: string }> = []) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') { posts.push({ url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : null }); return json({ job: { id: 'job_1' }, alert: { id: 'alert_1' } }, 201); }
    if (url.endsWith('/deliver')) return json(st);
    if (url.includes('/deliver/slack-channels')) return json({ channels: [{ id: 'C1', name: 'general' }] });
    if (url.startsWith('/v1/metric-alerts/definitions')) return json({ definitions: defs });
    if (url.startsWith('/v1/artifacts?')) return json({ artifacts: [{ id: 'art_1', name: 'Glosario INCRO' }] });
    return json({});
  });
  return posts;
}

beforeEach(() => { document.body.innerHTML = ''; agentAsk.mockReset(); toast.mockReset(); });

describe('afCron — local time + zone → UTC cron', () => {
  const { afCron } = loadLens();
  const at = new Date('2026-10-12T15:00:00Z');
  it.each([
    ['weekly', '09:00', '1', 'America/Argentina/Buenos_Aires', '0 12 * * 1'],
    ['daily', '09:00', '1', 'UTC', '0 9 * * *'],
    ['weekdays', '22:30', '1', 'America/Argentina/Buenos_Aires', '30 1 * * 2-6'],
    ['weekdays', '08:00', '1', 'Asia/Tokyo', '0 23 * * 0-4'],
    ['weekly', '08:00', '1', 'Asia/Tokyo', '0 23 * * 0'],
    ['weekly', '22:00', '6', 'America/Argentina/Buenos_Aires', '0 1 * * 0'],
    ['daily', '09:00', '1', 'Asia/Kolkata', '30 3 * * *'],
    ['monthly', '09:00', '15', 'America/Argentina/Buenos_Aires', '0 12 15 * *'],
    ['hourly', '', '', 'UTC', '0 * * * *'],
  ])('%s %s (day %s) in %s → %s', (freq, time, day, tz, cron) => {
    expect(afCron(freq, time, day, tz, at)).toEqual({ cron });
  });
  it('refuses a month day that would fall outside 1–28 in UTC', () => {
    expect(afCron('monthly', '08:00', '1', 'Asia/Tokyo', at)).toEqual({ err: 'autof.errMonthDay' });
  });
  it('requires a time', () => {
    expect(afCron('daily', '', '1', 'UTC', at)).toEqual({ err: 'autof.errTime' });
  });
});

describe('Schedule a send form', () => {
  it('a viewer gets their own email, read-only, and no Slack channel option', async () => {
    routeFetch(status('viewer', { telegram: { linked: true } }));
    loadLens().openAutoForm('schedule', { id: 'art_1', name: 'Glosario INCRO' });
    await flush();
    const to = $<HTMLInputElement>('#af_to');
    expect(to.value).toBe('laura@incro.com');
    expect(to.readOnly).toBe(true);
    expect(document.body.textContent).toContain(copy['autof.selfOnly']);
    const chans = Array.from($<HTMLSelectElement>('#af_ch').options).map((o) => o.value);
    expect(chans).toEqual(['email', 'telegram']);
  });

  it('an owner can edit recipients and pick Slack when the workspace has it; Telegram hidden until linked', async () => {
    routeFetch(status('owner'));
    loadLens().openAutoForm('schedule', { id: 'art_1', name: 'Glosario INCRO' });
    await flush();
    expect($<HTMLInputElement>('#af_to').readOnly).toBe(false);
    expect(Array.from($<HTMLSelectElement>('#af_ch').options).map((o) => o.value)).toEqual(['email', 'slack']);
  });

  it('offers only email when nothing else is connected', async () => {
    routeFetch(status('owner', { slack: { available: true, connected: false } }));
    loadLens().openAutoForm('schedule', { id: 'art_1', name: 'G' });
    await flush();
    expect(Array.from($<HTMLSelectElement>('#af_ch').options).map((o) => o.value)).toEqual(['email']);
  });

  it('creates the job through POST /v1/jobs with a UTC cron', async () => {
    const posts = routeFetch(status('owner'));
    const onDone = vi.fn();
    loadLens().openAutoForm('schedule', undefined, onDone);
    await flush();
    setVal('#af_art', 'art_1');
    await flush();
    setVal('#af_to', 'laura@incro.com, ana@incro.com');
    setVal('#af_freq', 'weekly');
    setVal('#af_day', '1');
    setVal('#af_time', '09:00');
    setVal('#af_tz', 'America/Buenos_Aires');
    $<HTMLButtonElement>('#af_submit').click();
    await flush();
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('/v1/jobs');
    expect(posts[0].body).toEqual({
      artifact_id: 'art_1', action: 'email', schedule: '0 12 * * 1',
      config: { recipients: ['laura@incro.com', 'ana@incro.com'], includeArtifactLink: true },
    });
    expect(onDone).toHaveBeenCalled();
    expect(document.querySelector('.wsx-modal')).toBeNull();
  });

  it('shows the server refusal instead of closing', async () => {
    routeFetch(status('owner'));
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => init?.method === 'POST'
      ? json({ error: 'Scheduling is disabled for this workspace' }, 400) : base(url, init));
    loadLens().openAutoForm('schedule', { id: 'art_1', name: 'G' });
    await flush();
    $<HTMLButtonElement>('#af_submit').click();
    await flush();
    expect($('#af_err').textContent).toBe('Scheduling is disabled for this workspace');
    expect(document.querySelector('.wsx-modal')).not.toBeNull();
  });

  it('keeps the AI path as an option', async () => {
    routeFetch(status('owner'));
    loadLens().openAutoForm('schedule', { id: 'art_1', name: 'Glosario INCRO' });
    await flush();
    $<HTMLButtonElement>('#af_ai').click();
    expect(agentAsk).toHaveBeenCalledWith(expect.stringContaining('Glosario INCRO'));
  });
});

describe('Create alert form', () => {
  it('explains when the artifact has no metrics and blocks submit', async () => {
    routeFetch(status('owner'), []);
    loadLens().openAutoForm('alert', { id: 'art_1', name: 'G' });
    await flush();
    expect(document.body.textContent).toContain(copy['autof.noMetrics']);
    expect($<HTMLButtonElement>('#af_submit').disabled).toBe(true);
  });

  it('creates the alert through POST /v1/metric-alerts', async () => {
    const posts = routeFetch(status('viewer'), [{ metric_id: 'views', label: 'Vistas' }]);
    loadLens().openAutoForm('alert', { id: 'art_1', name: 'Glosario' });
    await flush();
    setVal('#af_op', 'lt');
    setVal('#af_val', '10');
    setVal('#af_freq', 'hourly');
    $<HTMLButtonElement>('#af_submit').click();
    await flush();
    expect(posts[0].url).toBe('/v1/metric-alerts');
    expect(posts[0].body).toEqual({
      artifact_id: 'art_1', metric_id: 'views', name: 'Vistas · Glosario',
      condition: { op: 'lt', value: 10 }, schedule: '0 * * * *',
      destination: { kind: 'email', config: { recipients: ['laura@incro.com'], includeArtifactLink: true } },
    });
  });

  it('asks for a number', async () => {
    routeFetch(status('owner'), [{ metric_id: 'views', label: 'Vistas' }]);
    loadLens().openAutoForm('alert', { id: 'art_1', name: 'G' });
    await flush();
    $<HTMLButtonElement>('#af_submit').click();
    expect($('#af_err').textContent).toBe(copy['autof.errValue']);
  });
});

describe('Schedules / Alerts lens', () => {
  it('empty Schedules says so and offers the form first, chat second', async () => {
    document.body.innerHTML = '<div id="wsxSchedMount"></div>';
    fetchMock = vi.fn(async () => json({ jobs: [] }));
    loadLens().loadSchedules();
    await flush();
    const m = $('#wsxSchedMount');
    expect(m.textContent).toContain(copy['autof.schedEmpty']);
    const tiles = m.querySelectorAll('.wsx-qa');
    expect(tiles[0].getAttribute('data-autoform')).toBe('schedule');
    expect(tiles[1].hasAttribute('data-newauto')).toBe(true);
  });

  it('lists my scheduled sends with Pause and Delete, and Pause PATCHes enabled=false', async () => {
    document.body.innerHTML = '<div id="wsxSchedMount"></div>';
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.startsWith('/v1/jobs?')) return json({ jobs: [{ id: 'job_1', action: 'email', schedule: '0 12 * * 1', enabled: true, artifact_name: 'Glosario' }] });
      return json({ logs: [] });
    });
    loadLens().loadSchedules();
    await flush();
    const card = $('[data-af-id="job_1"]');
    expect(card.querySelector('[data-af-act="toggle"]')!.textContent).toBe(copy['autof.pause']);
    expect(card.querySelector('[data-af-act="del"]')).not.toBeNull();
    expect($('[data-autoform="schedule"]')).not.toBeNull();
    card.querySelector<HTMLButtonElement>('[data-af-act="toggle"]')!.click();
    await flush();
    const patch = calls.find(([u, i]) => u === '/v1/jobs/job_1' && i?.method === 'PATCH');
    expect(JSON.parse(String(patch![1]!.body))).toEqual({ enabled: false });
  });

  it('a paused job reads as paused even after a past run', async () => {
    document.body.innerHTML = '<div id="wsxSchedMount"></div>';
    fetchMock = vi.fn(async (url: string) => url.startsWith('/v1/jobs?')
      ? json({ jobs: [{ id: 'job_1', action: 'email', schedule: '0 9 * * *', enabled: false, last_status: 'success' }] })
      : json({ logs: [] }));
    loadLens().loadSchedules();
    await flush();
    expect($('.wsx-sched__badge').textContent).toBe(copy['sched.badgePaused']);
    expect($('[data-af-act="toggle"]').textContent).toBe(copy['autof.resume']);
  });

  it('alerts list gets Delete, which calls DELETE /v1/metric-alerts/:id', async () => {
    document.body.innerHTML = '<div id="wsxAlertMount"></div>';
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.startsWith('/v1/metric-alerts?')) return json({ alerts: [{ id: 'alert_1', name: 'Vistas', enabled: true }] });
      return json({ events: [] });
    });
    (window as unknown as { confirm: () => boolean }).confirm = () => true;
    loadLens().loadAlerts();
    await flush();
    $<HTMLButtonElement>('[data-af-id="alert_1"] [data-af-act="del"]').click();
    await flush();
    expect(calls.some(([u, i]) => u === '/v1/metric-alerts/alert_1' && i?.method === 'DELETE')).toBe(true);
    expect(document.querySelector('[data-af-id="alert_1"]')).toBeNull();
  });
});
