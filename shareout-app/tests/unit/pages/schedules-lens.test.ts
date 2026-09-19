// @vitest-environment happy-dom
//
// Runtime tests for the Schedules + Crew lens client script: cron wording, job
// "Run now" (inline outcome + run-history refresh) and the live crew step log.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_home_views_schedules_JS as schedulesJs } from '../../../src/pages/home/render-workspace/client-script/home-views/schedules';
import { workspace_client_home_views_crew_JS as crewJs } from '../../../src/pages/home/render-workspace/client-script/home-views/crew';
import { WORKSPACE_COPY } from '../../../src/pages/home/home-i18n/copy/workspace';

type Lens = {
  cronHuman: (c: string) => string;
  runJobNow: (b: HTMLButtonElement) => void;
  crewRunLive: (b: HTMLButtonElement, card: HTMLElement, base: string) => void;
};

const copy = WORKSPACE_COPY.en as Record<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;

function loadLens(): Lens {
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_test';
  const scope = new Proxy({}, {
    has: () => true,
    get: (target: Record<string | symbol, unknown>, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop]; // vars the script itself declared
      if (prop === 'window') return win;
      if (prop === 't') return (k: string) => copy[k] ?? k;
      if (prop === 'esc') return (s: unknown) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      if (prop === 'fetch') return (...a: unknown[]) => fetchMock(...a);
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
  });
  const body = `with (scope) {\n${schedulesJs}\n${crewJs}\n; return { cronHuman, runJobNow, crewRunLive }; }`;
  return new Function('scope', body)(scope);
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });

describe('cronHuman', () => {
  const { cronHuman } = loadLens();
  it.each([
    ['0 9 * * *', 'Daily · 09:00 UTC'],
    ['30 14 * * 1', 'Weekly · Mon 14:30 UTC'],
    ['0 9 * * 1,3', 'Weekly · Mon, Wed 09:00 UTC'],
    ['0 9 * * 1-5', 'Weekdays · 09:00 UTC'],
    ['0 8 1 * *', 'Monthly · day 1 08:00 UTC'],
    ['0 * * * *', 'Hourly · at :00'],
    ['15 */6 * * *', 'Every 6 hours · at :15'],
    ['*/15 * * * *', 'Every 15 min'],
    ['* * * * *', 'Every minute'],
    ['0 0 1 1 *', 'Custom · 0 0 1 1 * UTC'],
  ])('%s → %s', (cron, label) => {
    expect(cronHuman(cron)).toBe(label);
  });
});

describe('job Run now', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div class="wsx-sched" data-job="job_1">
      <span class="wsx-sched__badge">idle</span>
      <div class="wsx-runst is-fail" data-last-err>old error</div>
      <div class="wsx-runbars" data-runs="job_1"></div>
      <div class="wsx-sched__actions"><button data-sched-run>Run now</button><span class="wsx-runst"></span></div>
    </div>`;
  });

  it('shows the real failure inline, updates the badge and reloads run history', async () => {
    fetchMock = vi.fn(async (url: string) => url.endsWith('/run')
      ? json({ execution: { success: false, status: 'failed', error: 'Connection "warehouse" not found', duration_ms: 40 } })
      : json({ logs: [{ id: 'log_1', status: 'failed', error: 'Connection "warehouse" not found' }] }));
    const { runJobNow } = loadLens();
    const b = document.querySelector<HTMLButtonElement>('[data-sched-run]')!;

    runJobNow(b);
    expect(b.disabled).toBe(true);
    expect(b.textContent).toBe('Running…');
    expect(document.querySelector('[data-last-err]')).toBeNull();
    await flush(); await flush(); await flush();

    expect(fetchMock).toHaveBeenCalledWith('/v1/jobs/job_1/run', expect.objectContaining({ method: 'POST' }));
    const out = document.querySelector('.wsx-sched__actions .wsx-runst')!;
    expect(out.textContent).toBe('Failed: Connection "warehouse" not found');
    expect(out.className).toContain('is-fail');
    expect(document.querySelector('.wsx-sched__badge')!.className).toContain('fail');
    expect(fetchMock).toHaveBeenCalledWith('/v1/jobs/job_1/logs', expect.anything());
    expect(document.querySelector('.wsx-runbar')!.getAttribute('title')).toContain('Connection "warehouse" not found');
    expect(b.disabled).toBe(false);
  });

  it('reports success with the duration', async () => {
    fetchMock = vi.fn(async (url: string) => url.endsWith('/run')
      ? json({ execution: { success: true, status: 'success', duration_ms: 1234 } })
      : json({ logs: [] }));
    const { runJobNow } = loadLens();
    runJobNow(document.querySelector<HTMLButtonElement>('[data-sched-run]')!);
    await flush(); await flush(); await flush();
    expect(document.querySelector('.wsx-sched__actions .wsx-runst')!.textContent).toBe('Ran successfully in 1.2 s');
  });

  it('surfaces an API refusal instead of pretending it ran', async () => {
    fetchMock = vi.fn(async () => json({ success: false, error: 'Permission denied', code: 'FORBIDDEN' }, 403));
    const { runJobNow } = loadLens();
    runJobNow(document.querySelector<HTMLButtonElement>('[data-sched-run]')!);
    await flush(); await flush();
    expect(document.querySelector('.wsx-sched__actions .wsx-runst')!.textContent).toBe('Permission denied');
  });
});

describe('crew Run now', () => {
  function sse(events: unknown[]): Response {
    const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
    // Split mid-event to prove chunk reassembly.
    const cut = Math.floor(body.length / 2);
    const stream = new ReadableStream({
      start(c) { const enc = new TextEncoder(); c.enqueue(enc.encode(body.slice(0, cut))); c.enqueue(enc.encode(body.slice(cut))); c.close(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  }

  beforeEach(() => {
    document.body.innerHTML = `<div class="wsx-sched" data-crew="trg_1">
      <div class="wsx-runbars" data-crew-runs="trg_1"></div>
      <div class="wsx-sched__actions"><button data-crew-act="run">Run now</button></div>
    </div>`;
  });

  it('streams each step into the card log', async () => {
    fetchMock = vi.fn(async (url: string) => url.endsWith('/run')
      ? sse([
          { type: 'run_start', runId: 'crun_1' },
          { type: 'reasoning', content: 'hm' },
          { type: 'tool_call', tool: 'table_query', input: {} },
          { type: 'tool_result', tool: 'table_query', result: {}, is_error: false },
          { type: 'finish', summary: 'Posted the weekly numbers', status: 'success' },
          { type: 'done', runId: 'crun_1', terminationReason: 'goal_met', iterations: 2 },
        ])
      : json({ runs: [] }));
    const { crewRunLive } = loadLens();
    const card = document.querySelector<HTMLElement>('[data-crew]')!;
    const b = card.querySelector<HTMLButtonElement>('button')!;

    crewRunLive(b, card, '/v1/workspaces/wsp_test/automations/trg_1');
    expect(b.textContent).toBe('Running…');
    for (let i = 0; i < 8; i++) await flush();

    const lines = [...card.querySelectorAll('.wsx-crewlog__ln')].map((l) => l.textContent);
    expect(lines).toEqual([
      'Run started', 'Thinking…', 'Using table_query…', 'table_query done',
      'Posted the weekly numbers', 'Done · 2 steps',
    ]);
    expect(b.disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith('/v1/workspaces/wsp_test/automations/trg_1/runs', expect.anything());
  });

  it('shows the server refusal (e.g. concurrency limit) in the log', async () => {
    fetchMock = vi.fn(async (url: string) => url.endsWith('/run')
      ? json({ success: false, error: 'Could not start run (crew inactive or at concurrency limit)' }, 409)
      : json({ runs: [] }));
    const { crewRunLive } = loadLens();
    const card = document.querySelector<HTMLElement>('[data-crew]')!;
    crewRunLive(card.querySelector('button')!, card, '/v1/workspaces/wsp_test/automations/trg_1');
    for (let i = 0; i < 6; i++) await flush();
    const ln = card.querySelector('.wsx-crewlog__ln')!;
    expect(ln.textContent).toBe('Could not start run (crew inactive or at concurrency limit)');
    expect(ln.className).toContain('is-fail');
  });
});
