import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareOut, ShareOutError } from '../src/index';
import { _internal } from '../src/stores/pilot-store';

function createSdk() {
  return new ShareOut({ artifactId: 'art_1', baseUrl: 'https://api.example.com' });
}

interface FakeStep {
  type: 'step';
  action: { name: string; input: unknown; output: string };
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// A stand-in for page-agent's PageAgent: records construction config, exposes a
// history array, and lets each test decide what execute() does.
class FakeAgent extends EventTarget {
  static lastConfig: Record<string, unknown> | null = null;
  static instances: FakeAgent[] = [];
  history: FakeStep[] = [];
  disposed = false;
  stopped = false;
  panelHidden = false;
  panel = { hide: () => { this.panelHidden = true; }, show: () => {} };
  onExecute: ((self: FakeAgent) => { success: boolean; data: string }) | null = null;

  constructor(config: Record<string, unknown>) {
    super();
    FakeAgent.lastConfig = config;
    FakeAgent.instances.push(this);
  }
  async execute(_task: string) {
    const r = this.onExecute ? this.onExecute(this) : { success: true, data: 'done' };
    return { ...r, history: this.history };
  }
  async stop() { this.stopped = true; }
  dispose() { this.disposed = true; }
}

let scriptOnLoad: (() => void) | null = null;
let scriptsAppended = 0;

function stubBrowser(pilotPreloaded = false) {
  scriptOnLoad = null;
  const win: Record<string, unknown> = pilotPreloaded ? { PagePilot: { PageAgent: FakeAgent } } : {};
  // `window.parent === window` marks a top-level (non-sandboxed) frame so the
  // ShareOut constructor treats reads as initialized without postMessage.
  win.parent = win;
  vi.stubGlobal('window', win);
  vi.stubGlobal('location', { origin: 'https://api.example.com' });
  vi.stubGlobal('crypto', { randomUUID: () => 'task-uuid-1' });
  vi.stubGlobal('document', {
    getElementById: () => null,
    querySelectorAll: () => [] as unknown as NodeListOf<HTMLElement>,
    createElement: () => {
      const el: Record<string, unknown> = {};
      // Injecting the script makes PagePilot available, then fires onload.
      Object.defineProperty(el, 'src', {
        set() { (win as Record<string, unknown>).PagePilot = { PageAgent: FakeAgent }; },
      });
      Object.defineProperty(el, 'onload', { set(fn: () => void) { scriptOnLoad = fn; } });
      Object.defineProperty(el, 'onerror', { set() {} });
      return el;
    },
    head: { appendChild: () => { scriptsAppended++; scriptOnLoad?.(); } },
  });
}

function okConfigFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ data: { pilot_enabled: true }, success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  );
}

beforeEach(() => {
  FakeAgent.lastConfig = null;
  FakeAgent.instances = [];
  scriptsAppended = 0;
  _internal._reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pilot lazy loader', () => {
  it('injects /sdk/page-pilot.js once across two pilot() calls', async () => {
    stubBrowser(false);
    vi.stubGlobal('fetch', okConfigFetch());

    const pilot = createSdk().agent.pilot;
    await pilot('task one');
    await pilot('task two');

    // First call injects the script; the loader is cached module-wide after.
    expect(scriptsAppended).toBe(1);
    expect(FakeAgent.instances.length).toBe(2);
  });
});

describe('pilot preflight', () => {
  it('throws PILOT_DISABLED when the owner has not enabled it', async () => {
    stubBrowser(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: { pilot_enabled: false }, success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    );

    await expect(createSdk().agent.pilot('go')).rejects.toMatchObject({
      code: 'PILOT_DISABLED',
    });
  });

  it('skips the gate on a network error and lets the run proceed', async () => {
    stubBrowser(true);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed to fetch'); }));

    const res = await createSdk().agent.pilot('go');
    expect(res.success).toBe(true);
  });
});

describe('pilot wiring', () => {
  it('attaches x-pilot-task via customFetch', async () => {
    stubBrowser(true);
    vi.stubGlobal('fetch', okConfigFetch());

    await createSdk().agent.pilot('go');

    const cfg = FakeAgent.lastConfig!;
    expect(cfg.baseURL).toBe('https://api.example.com/v1/data/art_1/agent/pilot');
    expect(cfg.model).toBe('proxy');

    // customFetch must stamp the task header on every LLM request.
    const seen: Record<string, string> = {};
    const spyFetch = vi.fn(async (_u: unknown, init: RequestInit) => {
      new Headers(init.headers).forEach((v, k) => { seen[k] = v; });
      return new Response('{}');
    });
    vi.stubGlobal('fetch', spyFetch);
    await (cfg.customFetch as typeof fetch)('https://api.example.com/x', { method: 'POST' });
    expect(seen['x-pilot-task']).toBe('task-uuid-1');
  });

  it('clamps maxSteps to 1..20 and hides the panel when showPanel=false', async () => {
    stubBrowser(true);
    vi.stubGlobal('fetch', okConfigFetch());

    await createSdk().agent.pilot('go', { maxSteps: 99, showPanel: false });
    expect(FakeAgent.lastConfig!.maxSteps).toBe(20);
    expect(FakeAgent.instances[0].panelHidden).toBe(true);

    await createSdk().agent.pilot('go', { maxSteps: 0 });
    expect(FakeAgent.lastConfig!.maxSteps).toBe(1);
  });

  it('disposes the agent after the run', async () => {
    stubBrowser(true);
    vi.stubGlobal('fetch', okConfigFetch());
    await createSdk().agent.pilot('go');
    expect(FakeAgent.instances[0].disposed).toBe(true);
  });
});

describe('pilot usage aggregation', () => {
  it('sums per-step usage across the history', async () => {
    stubBrowser(true);
    vi.stubGlobal('fetch', okConfigFetch());

    // A run with no steps aggregates to zeros.
    const res = await createSdk().agent.pilot('go');
    expect(res.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });

    const history: FakeStep[] = [
      { type: 'step', action: { name: 'click', input: 1, output: '' }, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      { type: 'step', action: { name: 'type', input: 2, output: '' }, usage: { promptTokens: 20, completionTokens: 7, totalTokens: 27 } },
    ];
    expect(_internal.aggregateUsage(history)).toEqual({
      promptTokens: 30,
      completionTokens: 12,
      totalTokens: 42,
    });
  });
});

describe('pilot loop guard', () => {
  it('stops the run after 3 identical steps and reports looping', async () => {
    stubBrowser(true);
    vi.stubGlobal('fetch', okConfigFetch());

    const same = (): FakeStep => ({
      type: 'step',
      action: { name: 'click', input: { index: 3 }, output: 'ok' },
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    await createSdk().agent.pilot('loop forever');

    // Drive the captured onBeforeStep hook after seeding 3 identical steps.
    const cfg = FakeAgent.lastConfig!;
    const agent = FakeAgent.instances[0];
    agent.history = [same(), same(), same()];
    (cfg.onBeforeStep as (a: FakeAgent, n: number) => void)(agent, 3);
    expect(agent.stopped).toBe(true);
  });

  it('_internal.isLooping is false for <3 or differing steps', () => {
    const step = (name: string): FakeStep => ({
      type: 'step',
      action: { name, input: 1, output: '' },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
    const agent2 = { history: [step('a'), step('a')] } as unknown as Parameters<typeof _internal.isLooping>[0];
    expect(_internal.isLooping(agent2)).toBe(false);
    const agent3diff = { history: [step('a'), step('a'), step('b')] } as unknown as Parameters<typeof _internal.isLooping>[0];
    expect(_internal.isLooping(agent3diff)).toBe(false);
    const agent3same = { history: [step('a'), step('a'), step('a')] } as unknown as Parameters<typeof _internal.isLooping>[0];
    expect(_internal.isLooping(agent3same)).toBe(true);
  });

  it('_internal.isLooping detects an A,B,A,B oscillation', () => {
    const step = (name: string): FakeStep => ({
      type: 'step',
      action: { name, input: 1, output: '' },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
    const abab = { history: [step('a'), step('b'), step('a'), step('b')] } as unknown as Parameters<typeof _internal.isLooping>[0];
    expect(_internal.isLooping(abab)).toBe(true);
    // A,B,C,A is not a clean 2-cycle.
    const abca = { history: [step('a'), step('b'), step('c'), step('a')] } as unknown as Parameters<typeof _internal.isLooping>[0];
    expect(_internal.isLooping(abca)).toBe(false);
  });
});

describe('pilot masking', () => {
  it('redacts card-like numbers and emails, keeping 2 email chars', () => {
    const masked = _internal.maskPageContent('pay 4111 1111 1111 1111 to alice@example.com now');
    expect(masked).toContain('████');
    expect(masked).not.toContain('4111 1111 1111 1111');
    expect(masked).toContain('al***@***');
    expect(masked).not.toContain('alice@example.com');
  });
});
