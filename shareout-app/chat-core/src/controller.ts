import type { SSEEvent } from './types';
import { streamSSE } from './sse';
import type { ChatView, MessageHandle, TypingHandle } from './view';

export interface ChatRequest {
  url: string;
  body?: unknown;
  method?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
}

export interface ChatTurnContext {
  /** The user's own message bubble for this turn (null if renderUser returned null). */
  user: MessageHandle | null;
  /** The typing indicator for this turn (null if disabled). */
  typing: TypingHandle | null;
  /** Aborts when a newer send() supersedes this turn or cancel() is called. */
  signal: AbortSignal;
}

export interface ChatControllerOptions {
  view: ChatView;
  /** Build the request for a user message. */
  request: (text: string) => ChatRequest;
  /** Handle each streamed SSE event (the terminal `doneType` event is consumed internally). */
  onEvent: (ev: SSEEvent, ctx: ChatTurnContext) => void;
  /** Runs after the user bubble + typing indicator are added, before the request fires. */
  onSend?: (text: string, ctx: ChatTurnContext) => void;
  /** Non-OK response or a thrown error (AbortError is swallowed — it means superseded). */
  onError?: (err: unknown, ctx: ChatTurnContext) => void;
  /** The stream ended cleanly. */
  onDone?: (ctx: ChatTurnContext) => void;
  /** Render the user's own message. Default: view.addUser(text). Return null to skip. */
  renderUser?: (text: string) => MessageHandle | null;
  /** Show a typing indicator until the reply / terminal event. Default true. */
  typing?: boolean;
  /** SSE event type that ends the turn (removes typing). Default 'done'. */
  doneType?: string;
}

export interface ChatController {
  /** Send a message. Automatically cancels any in-flight turn first. */
  send(text: string): Promise<void>;
  /** Abort the in-flight turn, if any. */
  cancel(): void;
}

/**
 * Orchestrates one chat turn: render the user message, show a typing indicator,
 * POST + stream the reply through `onEvent`, and tear down. A new send() (or
 * cancel()) aborts the previous turn via AbortController, so a fast follow-up
 * never races an older stream.
 */
export function createChatController(opts: ChatControllerOptions): ChatController {
  const showTyping = opts.typing !== false;
  const doneType = opts.doneType ?? 'done';
  let current: AbortController | null = null;

  function cancel(): void {
    if (current) {
      current.abort();
      current = null;
    }
  }

  async function send(text: string): Promise<void> {
    cancel();
    const ac = new AbortController();
    current = ac;

    const user = opts.renderUser ? opts.renderUser(text) : opts.view.addUser(text);
    const typing = showTyping ? opts.view.typing() : null;
    const ctx: ChatTurnContext = { user, typing, signal: ac.signal };

    if (opts.onSend) opts.onSend(text, ctx);

    try {
      const req = opts.request(text);
      const res = await streamSSE({
        url: req.url,
        body: req.body,
        method: req.method,
        headers: req.headers,
        credentials: req.credentials,
        signal: ac.signal,
        onEvent: (ev) => {
          if (ev.type === doneType) {
            if (typing) typing.remove();
            return;
          }
          opts.onEvent(ev, ctx);
        },
      });
      if (typing) typing.remove();
      if (!res.ok || !res.body) {
        if (opts.onError) opts.onError(res, ctx);
      } else if (opts.onDone) {
        opts.onDone(ctx);
      }
    } catch (err) {
      if (typing) typing.remove();
      // A newer send aborted this turn — not a failure to surface.
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      if (opts.onError) opts.onError(err, ctx);
    } finally {
      if (current === ac) current = null;
    }
  }

  return { send, cancel };
}
