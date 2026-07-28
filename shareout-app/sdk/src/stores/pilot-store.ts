import { ShareOutError } from '../shareout-error';
import type { SdkClient } from '../core/sdk-client';

/**
 * `so.agent.pilot` — an in-page GUI agent (vendored page-agent, MIT) that reads
 * the artifact's DOM and clicks/types/scrolls to carry out a natural-language
 * task. The PagePilot bundle is loaded lazily from /sdk/page-pilot.js on first
 * use so the core SDK stays small; LLM calls are proxied through the worker
 * (server-side key, owner opt-in, 20-step cap).
 */

export interface PilotOptions {
  /** Max ReAct steps before the run gives up. Clamped to 1..20. @default 15 */
  maxSteps?: number;
  /** Extra system-level guidance prepended to the agent's instructions. */
  instructions?: string;
  /** Show the floating control panel while the run executes. @default true */
  showPanel?: boolean;
  /** Redact card-like numbers and emails from the page text sent to the LLM. @default true */
  maskContent?: boolean;
  /** Stream status / activity / history events as they happen. */
  onEvent?: (e: { kind: 'status' | 'activity' | 'history'; detail: unknown }) => void;
  /**
   * Answer the agent's `ask_user` questions. When set, the run can pause to ask
   * for clarification; resolve the returned promise with the user's answer.
   * When unset, the `ask_user` tool stays disabled.
   */
  onAskUser?: (question: string) => Promise<string>;
}

export interface PilotResult {
  success: boolean;
  data: string;
  steps: number;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// ---- Minimal shape of the vendored page-agent API we depend on -------------
// (verified against node_modules/page-agent + @page-agent/core .d.ts)

interface PilotStepEvent {
  type: 'step';
  action?: { name: string; input: unknown; output: string };
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}
type PilotHistoryEvent = PilotStepEvent | { type: string };

interface PilotAgent extends EventTarget {
  history: PilotHistoryEvent[];
  panel?: { hide(): void; show(): void };
  execute(task: string): Promise<{ success: boolean; data: string; history: PilotHistoryEvent[] }>;
  stop(): Promise<void>;
  dispose(): void;
}

interface PilotAgentConfig {
  model: string;
  apiKey: string;
  baseURL: string;
  language: 'en-US';
  maxSteps: number;
  stepDelay: number;
  instructions?: { system?: string };
  customFetch?: typeof fetch;
  interactiveBlacklist?: Element[];
  transformPageContent?: (content: string) => string;
  onBeforeStep?: (agent: PilotAgent, stepCount: number) => void;
  onAskUser?: (question: string, options?: { signal: AbortSignal }) => Promise<string>;
}

interface PagePilotGlobal {
  PageAgent: new (config: PilotAgentConfig) => PilotAgent;
}

interface AgentConfigResponse {
  pilot_enabled?: boolean;
}

// ---- Module-level state ----------------------------------------------------
// `so.agent` returns a fresh AgentStore per access, so the loader promise and
// the active run must live at module scope for `pilot()` and `pilot.stop()` to
// share them.

const PILOT_BUNDLE_PATH = '/sdk/page-pilot.js';
const LOAD_TIMEOUT_MS = 15_000;
const MAX_STEPS_CAP = 20;

let loaderPromise: Promise<PagePilotGlobal> | null = null;
let activeAgent: PilotAgent | null = null;

function loadPagePilot(): Promise<PagePilotGlobal> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(
      new ShareOutError('sdk.agent.pilot requires a browser environment.', 'PILOT_NO_BROWSER', 500)
    );
  }
  const w = window as Window & { PagePilot?: PagePilotGlobal };
  if (w.PagePilot) return Promise.resolve(w.PagePilot);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<PagePilotGlobal>((resolve, reject) => {
    const fail = (err: ShareOutError) => {
      loaderPromise = null;
      reject(err);
    };
    const timer = setTimeout(
      () => fail(new ShareOutError('Timed out loading the pilot engine.', 'PILOT_LOAD_FAILED', 504)),
      LOAD_TIMEOUT_MS
    );
    const src = new URL(PILOT_BUNDLE_PATH, location.origin).href;
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => {
      clearTimeout(timer);
      if (w.PagePilot) resolve(w.PagePilot);
      else fail(new ShareOutError('Pilot engine unavailable after load.', 'PILOT_LOAD_FAILED', 500));
    };
    script.onerror = () => {
      clearTimeout(timer);
      fail(new ShareOutError('Failed to load the pilot engine.', 'PILOT_LOAD_FAILED', 500));
    };
    document.head.appendChild(script);
  });
  return loaderPromise;
}

// String-level redaction of the page text handed to the LLM. Card-like runs of
// 13–19 digits collapse to a block; emails keep the first two chars only.
function maskPageContent(content: string): string {
  return content
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '████')
    .replace(
      /([A-Za-z0-9._%+-]{1,2})[A-Za-z0-9._%+-]*@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
      '$1***@***'
    );
}

// Loop guard: catches identical-3 (last 3 steps ran the same action + input) OR
// an A-B-A-B oscillation (last 4 steps alternate between two distinct actions).
// Either way the agent is stuck; stop it so the run settles instead of burning
// the step budget.
function isLooping(agent: PilotAgent): boolean {
  const steps = agent.history.filter((e): e is PilotStepEvent => e.type === 'step');
  const key = (s: PilotStepEvent) =>
    `${s.action?.name ?? ''}:${JSON.stringify(s.action?.input ?? null)}`;
  if (steps.length >= 3) {
    const last3 = steps.slice(-3);
    const first = key(last3[0]);
    if (last3.every((s) => key(s) === first)) return true;
  }
  if (steps.length >= 4) {
    const last4 = steps.slice(-4);
    const a = key(last4[0]);
    const b = key(last4[1]);
    if (a !== b && key(last4[2]) === a && key(last4[3]) === b) return true;
  }
  return false;
}

function aggregateUsage(history: PilotHistoryEvent[]): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  for (const e of history) {
    if (e.type === 'step' && (e as PilotStepEvent).usage) {
      const u = (e as PilotStepEvent).usage!;
      usage.promptTokens += u.promptTokens ?? 0;
      usage.completionTokens += u.completionTokens ?? 0;
      usage.totalTokens += u.totalTokens ?? 0;
    }
  }
  return usage;
}

export class PilotStore {
  constructor(private sdk: SdkClient) {}

  async run(task: string, opts: PilotOptions = {}): Promise<PilotResult> {
    const maxSteps = Math.min(MAX_STEPS_CAP, Math.max(1, Math.floor(opts.maxSteps ?? 15)));
    const showPanel = opts.showPanel ?? true;
    const maskContent = opts.maskContent ?? true;

    await this.preflight();

    const { PageAgent } = await loadPagePilot();
    const taskId = crypto.randomUUID();

    // [data-so-private] elements are hidden from the LLM's DOM view entirely
    // (page-agent's interactiveBlacklist takes real Elements, not selectors).
    const blacklist =
      typeof document !== 'undefined'
        ? Array.from(document.querySelectorAll<HTMLElement>('[data-so-private]'))
        : [];

    let loopStopped = false;

    const agent: PilotAgent = new PageAgent({
      model: 'proxy',
      apiKey: 'proxy',
      baseURL: `${this.sdk._baseUrl}/v1/data/${this.sdk._artifactId}/agent/pilot`,
      language: 'en-US',
      maxSteps,
      stepDelay: 0.3,
      instructions: opts.instructions ? { system: opts.instructions } : undefined,
      customFetch: (url: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        headers.set('x-pilot-task', taskId);
        return fetch(url, { ...init, headers });
      },
      interactiveBlacklist: blacklist.length ? blacklist : undefined,
      transformPageContent: maskContent ? maskPageContent : undefined,
      onAskUser: opts.onAskUser
        ? (question: string) => opts.onAskUser!(question)
        : undefined,
      onBeforeStep: (a: PilotAgent) => {
        if (!loopStopped && isLooping(a)) {
          loopStopped = true;
          void a.stop();
        }
      },
    } as PilotAgentConfig);

    if (!showPanel) agent.panel?.hide();

    const forward =
      (kind: 'status' | 'activity' | 'history') =>
      (ev: Event) => {
        opts.onEvent?.({ kind, detail: (ev as CustomEvent).detail ?? null });
      };
    const onStatus = forward('status');
    const onActivity = forward('activity');
    const onHistory = forward('history');
    if (opts.onEvent) {
      agent.addEventListener('statuschange', onStatus);
      agent.addEventListener('activity', onActivity);
      agent.addEventListener('historychange', onHistory);
    }

    activeAgent = agent;
    try {
      const result = await agent.execute(task);
      const usage = aggregateUsage(agent.history);
      const steps = agent.history.filter((e) => e.type === 'step').length;
      return {
        success: loopStopped ? false : result.success,
        data: loopStopped ? 'Stopped: agent was looping' : result.data,
        steps,
        usage,
      };
    } finally {
      if (opts.onEvent) {
        agent.removeEventListener('statuschange', onStatus);
        agent.removeEventListener('activity', onActivity);
        agent.removeEventListener('historychange', onHistory);
      }
      if (activeAgent === agent) activeAgent = null;
      agent.dispose();
    }
  }

  async stop(): Promise<void> {
    await activeAgent?.stop();
  }

  // Owner opt-in gate: GET /agent/config → { pilot_enabled }. A network failure
  // is not an answer — skip the gate and let the completions call surface the
  // real error; an explicit `false` throws.
  private async preflight(): Promise<void> {
    let config: AgentConfigResponse;
    try {
      config = await this.sdk._internalFetch<AgentConfigResponse>('/agent/config');
    } catch (err) {
      if (err instanceof ShareOutError && err.code === 'NETWORK_ERROR') return;
      throw err;
    }
    if (!config.pilot_enabled) {
      throw new ShareOutError(
        'Pilot is not enabled for this artifact — the owner can enable it in agent settings.',
        'PILOT_DISABLED',
        403
      );
    }
  }
}

/** Callable `so.agent.pilot(task, opts)` with a `.stop()` method. */
export type Pilot = ((task: string, opts?: PilotOptions) => Promise<PilotResult>) & {
  stop: () => Promise<void>;
};

export function createPilot(sdk: SdkClient): Pilot {
  const store = new PilotStore(sdk);
  const fn = ((task: string, opts?: PilotOptions) => store.run(task, opts)) as Pilot;
  fn.stop = () => store.stop();
  return fn;
}

// Exposed for unit tests; not part of the public API surface.
export const _internal = {
  maskPageContent,
  isLooping,
  aggregateUsage,
  loadPagePilot,
  _reset(): void {
    loaderPromise = null;
    activeAgent = null;
  },
};
