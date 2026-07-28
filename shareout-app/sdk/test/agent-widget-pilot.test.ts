// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareOut, ShareOutError } from '../src/index';
import type { AgentStore } from '../src/stores/agent-store';
import type { Pilot, PilotOptions, PilotResult } from '../src/stores/pilot-store';

function createSdk() {
  const win = window as unknown as { parent: unknown };
  win.parent = window;
  return new ShareOut({ artifactId: 'art_1', baseUrl: 'https://api.example.com' });
}

// Capture the closed ShadowRoot the widget attaches so tests can inspect its DOM.
function captureShadow(): { get(): ShadowRoot | null } {
  const ref: { root: ShadowRoot | null } = { root: null };
  const real = HTMLElement.prototype.attachShadow;
  vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (
    this: HTMLElement,
    init: ShadowRootInit
  ) {
    const root = real.call(this, { ...init, mode: 'open' });
    ref.root = root;
    return root;
  });
  return { get: () => ref.root };
}

function stubEnabled(agent: AgentStore, enabled: boolean): void {
  vi.spyOn(agent, '_pilotEnabled').mockResolvedValue(enabled);
}

function stubPilot(agent: AgentStore, impl: Pilot): void {
  vi.spyOn(agent, 'pilot', 'get').mockReturnValue(impl);
}

function fakePilot(
  run: (task: string, opts: PilotOptions) => Promise<PilotResult>
): Pilot {
  const fn = vi.fn((task: string, opts?: PilotOptions) => run(task, opts ?? {})) as unknown as Pilot;
  fn.stop = vi.fn(async () => {});
  return fn;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="chat"></div>';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('widget pilot toggle visibility', () => {
  it('fetches /agent/config on mount and shows the toggle when enabled', async () => {
    const shadow = captureShadow();
    const agent = createSdk().agent;
    stubEnabled(agent, true);

    agent.widget.mount('#chat');
    await flush();

    expect(agent._pilotEnabled).toHaveBeenCalled();
    const toggle = shadow.get()!.querySelector('.chat-mode') as HTMLElement;
    expect(toggle.hidden).toBe(false);
    expect(toggle.querySelectorAll('.mode-btn').length).toBe(2);
  });

  it('hides the toggle when pilot is not enabled', async () => {
    const shadow = captureShadow();
    const agent = createSdk().agent;
    stubEnabled(agent, false);

    agent.widget.mount('#chat');
    await flush();

    expect((shadow.get()!.querySelector('.chat-mode') as HTMLElement).hidden).toBe(true);
  });

  it('mode:"ask" never fetches config or shows the toggle', async () => {
    const shadow = captureShadow();
    const agent = createSdk().agent;
    stubEnabled(agent, true);

    agent.widget.mount('#chat', { mode: 'ask' });
    await flush();

    expect(agent._pilotEnabled).not.toHaveBeenCalled();
    expect((shadow.get()!.querySelector('.chat-mode') as HTMLElement).hidden).toBe(true);
  });

  it('pilot:false forces the toggle hidden even when enabled', async () => {
    const shadow = captureShadow();
    const agent = createSdk().agent;
    stubEnabled(agent, true);

    agent.widget.mount('#chat', { pilot: false });
    await flush();

    expect(agent._pilotEnabled).not.toHaveBeenCalled();
    expect((shadow.get()!.querySelector('.chat-mode') as HTMLElement).hidden).toBe(true);
  });
});

describe('widget submit routing', () => {
  it('DO mode calls pilot() and not chat()', async () => {
    const shadow = captureShadow();
    const agent = createSdk().agent;
    stubEnabled(agent, true);
    const pilot = fakePilot(async () => ({
      success: true,
      data: 'All set.',
      steps: 1,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }));
    stubPilot(agent, pilot);
    const chatSpy = vi.spyOn(agent, 'chat');

    agent.widget.mount('#chat');
    await flush();

    const root = shadow.get()!;
    (root.querySelector('[data-mode="auto"]') as HTMLButtonElement).click();
    const input = root.querySelector('textarea') as HTMLTextAreaElement;
    input.value = 'book the slot';
    (root.querySelector('.send-btn') as HTMLButtonElement).click();
    await flush();

    expect(pilot).toHaveBeenCalledWith('book the slot', expect.objectContaining({
      showPanel: false,
      maskContent: true,
      maxSteps: 15,
    }));
    expect(chatSpy).not.toHaveBeenCalled();
    expect(root.querySelector('.message.assistant')!.textContent).toContain('All set.');
  });

  it('ASK mode calls chat() and not pilot()', async () => {
    const shadow = captureShadow();
    const agent = createSdk().agent;
    stubEnabled(agent, true);
    const pilot = fakePilot(async () => {
      throw new Error('should not run');
    });
    stubPilot(agent, pilot);
    vi.spyOn(agent, 'chat').mockImplementation(async function* () {
      yield { type: 'content', content: 'hi there' } as never;
      yield { type: 'done' } as never;
    });

    agent.widget.mount('#chat');
    await flush();

    const root = shadow.get()!;
    // toggle defaults to Ask
    const input = root.querySelector('textarea') as HTMLTextAreaElement;
    input.value = 'what is this?';
    (root.querySelector('.send-btn') as HTMLButtonElement).click();
    await flush();

    expect(agent.chat).toHaveBeenCalled();
    expect(pilot).not.toHaveBeenCalled();
  });
});

describe('widget activity bubble', () => {
  it('updates the activity bubble from onEvent', async () => {
    const shadow = captureShadow();
    const agent = createSdk().agent;
    stubEnabled(agent, true);

    let capturedOnEvent: PilotOptions['onEvent'] | undefined;
    const pilot = fakePilot(async (_task, opts) => {
      capturedOnEvent = opts.onEvent;
      capturedOnEvent?.({ kind: 'activity', detail: { type: 'thinking' } });
      capturedOnEvent?.({ kind: 'activity', detail: { type: 'executing', tool: 'click_element_by_index', input: {} } });
      return {
        success: true,
        data: 'done',
        steps: 1,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    });
    stubPilot(agent, pilot);

    agent.widget.mount('#chat');
    await flush();
    const root = shadow.get()!;
    (root.querySelector('[data-mode="auto"]') as HTMLButtonElement).click();

    // Assert bubble text mid-run by pausing the pilot promise.
    let resolveRun!: (r: PilotResult) => void;
    stubPilot(
      agent,
      fakePilot((_task, opts) => {
        opts.onEvent?.({ kind: 'activity', detail: { type: 'thinking' } });
        return new Promise<PilotResult>((res) => {
          resolveRun = res;
          opts.onEvent?.({ kind: 'activity', detail: { type: 'executing', tool: 'click_element_by_index', input: {} } });
        });
      })
    );

    const input = root.querySelector('textarea') as HTMLTextAreaElement;
    input.value = 'go';
    (root.querySelector('.send-btn') as HTMLButtonElement).click();
    await flush();

    const bubble = root.querySelector('.message.activity') as HTMLElement;
    expect(bubble).toBeTruthy();
    expect(bubble.textContent).toBe('Clicking…');

    resolveRun({ success: true, data: 'ok', steps: 1, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
    await flush();
    expect(root.querySelector('.message.activity')).toBeNull();
  });
});

describe('widget pilot outcomes', () => {
  it('renders an assistant bubble with result.data on success', async () => {
    const shadow = captureShadow();
    const agent = createSdk().agent;
    stubEnabled(agent, true);
    stubPilot(
      agent,
      fakePilot(async () => ({
        success: true,
        data: 'Booked for 3pm.',
        steps: 2,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      }))
    );

    agent.widget.mount('#chat');
    await flush();
    const root = shadow.get()!;
    (root.querySelector('[data-mode="auto"]') as HTMLButtonElement).click();
    (root.querySelector('textarea') as HTMLTextAreaElement).value = 'book it';
    (root.querySelector('.send-btn') as HTMLButtonElement).click();
    await flush();

    const bubbles = root.querySelectorAll('.message.assistant');
    expect(bubbles[bubbles.length - 1].textContent).toBe('Booked for 3pm.');
  });

  it('PILOT_DISABLED throw hides the toggle and shows the disabled message', async () => {
    const shadow = captureShadow();
    const agent = createSdk().agent;
    stubEnabled(agent, true);
    stubPilot(
      agent,
      fakePilot(async () => {
        throw new ShareOutError('nope', 'PILOT_DISABLED', 403);
      })
    );

    agent.widget.mount('#chat');
    await flush();
    const root = shadow.get()!;
    (root.querySelector('[data-mode="auto"]') as HTMLButtonElement).click();
    (root.querySelector('textarea') as HTMLTextAreaElement).value = 'do it';
    (root.querySelector('.send-btn') as HTMLButtonElement).click();
    await flush();

    expect((root.querySelector('.chat-mode') as HTMLElement).hidden).toBe(true);
    const bubbles = root.querySelectorAll('.message.assistant');
    expect(bubbles[bubbles.length - 1].textContent).toContain("doesn't have Pilot enabled");
  });
});

describe('widget concurrency', () => {
  it('ignores a submit while a pilot run is active', async () => {
    const shadow = captureShadow();
    const agent = createSdk().agent;
    stubEnabled(agent, true);
    let resolveRun!: (r: PilotResult) => void;
    const runImpl = vi.fn(
      () => new Promise<PilotResult>((res) => { resolveRun = res; })
    );
    stubPilot(agent, fakePilot(runImpl));

    agent.widget.mount('#chat');
    await flush();
    const root = shadow.get()!;
    (root.querySelector('[data-mode="auto"]') as HTMLButtonElement).click();
    const input = root.querySelector('textarea') as HTMLTextAreaElement;
    input.value = 'first';
    (root.querySelector('.send-btn') as HTMLButtonElement).click();
    await flush();

    // second submit while running is ignored
    input.value = 'second';
    (root.querySelector('.send-btn') as HTMLButtonElement).click();
    await flush();

    expect(runImpl).toHaveBeenCalledTimes(1);

    resolveRun({ success: true, data: 'x', steps: 1, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
    await flush();
  });

  it('stops the pilot when the Stop control is clicked mid-run', async () => {
    const shadow = captureShadow();
    const agent = createSdk().agent;
    stubEnabled(agent, true);
    const runImpl = vi.fn(() => new Promise<PilotResult>(() => {}));
    const pilot = fakePilot(runImpl);
    stubPilot(agent, pilot);

    agent.widget.mount('#chat');
    await flush();
    const root = shadow.get()!;
    (root.querySelector('[data-mode="auto"]') as HTMLButtonElement).click();
    const input = root.querySelector('textarea') as HTMLTextAreaElement;
    input.value = 'do a thing';
    const send = root.querySelector('.send-btn') as HTMLButtonElement;
    send.click();
    await flush();

    // While running, the send button acts as Stop.
    send.click();
    await flush();
    expect(pilot.stop).toHaveBeenCalled();
  });

  it('stops an in-flight pilot run on unmount', async () => {
    const shadow = captureShadow();
    const agent = createSdk().agent;
    stubEnabled(agent, true);
    const runImpl = vi.fn(() => new Promise<PilotResult>(() => {}));
    const pilot = fakePilot(runImpl);
    stubPilot(agent, pilot);

    agent.widget.mount('#chat');
    await flush();
    const root = shadow.get()!;
    (root.querySelector('[data-mode="auto"]') as HTMLButtonElement).click();
    const input = root.querySelector('textarea') as HTMLTextAreaElement;
    input.value = 'do a thing';
    (root.querySelector('.send-btn') as HTMLButtonElement).click();
    await flush();

    agent.widget.unmount();
    expect(pilot.stop).toHaveBeenCalled();
  });
});

describe('widget ask_user bridge', () => {
  it('shows the question and resolves it from the next submit', async () => {
    const shadow = captureShadow();
    const agent = createSdk().agent;
    stubEnabled(agent, true);

    let answer: string | null = null;
    const runImpl = vi.fn(async (_task: string, opts: PilotOptions) => {
      answer = (await opts.onAskUser?.('Which date?')) ?? null;
      return {
        success: true,
        data: `Booked ${answer}`,
        steps: 1,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      } as PilotResult;
    });
    stubPilot(agent, fakePilot(runImpl));

    agent.widget.mount('#chat');
    await flush();
    const root = shadow.get()!;
    (root.querySelector('[data-mode="auto"]') as HTMLButtonElement).click();
    const input = root.querySelector('textarea') as HTMLTextAreaElement;
    const send = root.querySelector('.send-btn') as HTMLButtonElement;

    input.value = 'book something';
    send.click();
    await flush();

    // The question appears as an assistant bubble.
    expect(
      Array.from(root.querySelectorAll('.message.assistant')).some((b) =>
        b.textContent?.includes('Which date?')
      )
    ).toBe(true);

    // The next submit answers it rather than starting a new run.
    input.value = 'Friday';
    send.click();
    await flush();
    await flush();

    expect(answer).toBe('Friday');
    expect(runImpl).toHaveBeenCalledTimes(1);
    const bubbles = root.querySelectorAll('.message.assistant');
    expect(bubbles[bubbles.length - 1].textContent).toBe('Booked Friday');
  });
});
