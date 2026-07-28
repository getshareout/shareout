import type { SSEEvent } from './types';

/**
 * Read a `text/event-stream` response and yield each decoded `data:` event.
 *
 * This is the loop every ShareOut chat (home, create, editor) used to hand-roll:
 * pull from the reader, decode, split on the SSE record separator (`\n\n`), strip
 * the `data: ` prefix, and JSON-parse. Malformed/blank records are skipped, and a
 * partial record at the tail is held in the buffer until the next chunk completes it.
 */
export async function* readSSE(res: Response): AsyncGenerator<SSEEvent> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const record = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = record.replace(/^data: /, '').trim();
        if (!line) continue;
        let ev: SSEEvent;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        yield ev;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* reader already released */
    }
  }
}

export interface StreamSSEOptions {
  url: string;
  body?: unknown;
  method?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
  /** Called once per decoded SSE event (only when the response is a readable stream). */
  onEvent: (ev: SSEEvent) => void;
}

/**
 * POST `body` as JSON and stream the SSE response through `onEvent`.
 *
 * Returns the raw `Response` so callers can branch on a non-stream reply (e.g. a
 * JSON error/limit body returned instead of `text/event-stream`). When the response
 * is OK and has a body, every event is delivered to `onEvent` before this resolves.
 */
export async function streamSSE(opts: StreamSSEOptions): Promise<Response> {
  const res = await fetch(opts.url, {
    method: opts.method ?? 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    credentials: opts.credentials,
    signal: opts.signal,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok || !res.body) return res;
  for await (const ev of readSSE(res)) opts.onEvent(ev);
  return res;
}
