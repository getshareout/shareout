import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChatController } from '../src/controller';
import { createChatView } from '../src/view';

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

function makeView() {
  document.body.innerHTML = '<div id="c"></div>';
  const container = document.getElementById('c') as HTMLElement;
  return {
    container,
    view: createChatView(container, {
      userClass: 'msg user',
      botClass: 'msg ai',
      typingClass: 'typing',
      typingHtml: '<i></i>',
    }),
  };
}

describe('createChatController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the user message, streams events, and clears typing on done', async () => {
    const { container, view } = makeView();
    const events: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: {"type":"text","text":"hi"}\n\n', 'data: {"type":"done"}\n\n'])));

    const c = createChatController({
      view,
      request: (t) => ({ url: '/chat', body: { text: t } }),
      onEvent: (ev) => { if (ev.type === 'text') events.push(ev.text as string); },
    });
    await c.send('hello');

    expect(container.querySelector('.msg.user')?.textContent).toBe('hello');
    expect(events).toEqual(['hi']);
    expect(container.querySelector('.typing')).toBeNull(); // removed on done
    vi.unstubAllGlobals();
  });

  it('calls onError with the Response on a non-OK reply (no event-stream)', async () => {
    const { view } = makeView();
    const onError = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'limit' }), { status: 429 })));

    const c = createChatController({
      view,
      request: () => ({ url: '/chat' }),
      onEvent: () => {},
      onError,
    });
    await c.send('x');

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Response).status).toBe(429);
    vi.unstubAllGlobals();
  });

  it('cancels the in-flight turn when a newer send starts (no error surfaced)', async () => {
    const { view } = makeView();
    const onError = vi.fn();
    const signals: AbortSignal[] = [];
    // Never-resolving body so the first turn stays in-flight until aborted.
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return new Response(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } });
    }));

    const c = createChatController({ view, request: () => ({ url: '/chat' }), onEvent: () => {}, onError });
    c.send('first');
    await Promise.resolve();
    c.cancel();

    expect(signals[0].aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled(); // AbortError swallowed
    vi.unstubAllGlobals();
  });
});
