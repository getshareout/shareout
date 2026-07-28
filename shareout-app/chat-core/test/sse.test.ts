import { describe, it, expect, vi } from 'vitest';
import { readSSE, streamSSE } from '../src/sse';

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

describe('readSSE', () => {
  it('decodes data: events split across chunks', async () => {
    const res = sseResponse(['data: {"type":"text","te', 'xt":"hi"}\n\n', 'data: {"type":"done"}\n\n']);
    const events = [];
    for await (const ev of readSSE(res)) events.push(ev);
    expect(events).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'done' },
    ]);
  });

  it('skips blank and malformed records', async () => {
    const res = sseResponse(['\n\n', 'data: not json\n\n', 'data: {"type":"ok"}\n\n']);
    const events = [];
    for await (const ev of readSSE(res)) events.push(ev);
    expect(events).toEqual([{ type: 'ok' }]);
  });

  it('yields nothing for a bodyless response', async () => {
    const events = [];
    for await (const ev of readSSE(new Response(null))) events.push(ev);
    expect(events).toEqual([]);
  });
});

describe('streamSSE', () => {
  it('posts JSON and forwards each event', async () => {
    const onEvent = vi.fn();
    const fetchMock = vi.fn(async () => sseResponse(['data: {"type":"a"}\n\n', 'data: {"type":"b"}\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    const res = await streamSSE({ url: '/x', body: { q: 1 }, onEvent });

    expect(res.ok).toBe(true);
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenNthCalledWith(1, { type: 'a' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ q: 1 });
    vi.unstubAllGlobals();
  });

  it('returns a non-stream error response without calling onEvent', async () => {
    const onEvent = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await streamSSE({ url: '/x', body: {}, onEvent });

    expect(res.status).toBe(429);
    expect(onEvent).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ error: 'nope' });
    vi.unstubAllGlobals();
  });
});
