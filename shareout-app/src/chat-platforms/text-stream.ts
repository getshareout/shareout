/** Minimum gap between in-place edits of a streaming bot reply. */
export const STREAM_EDIT_INTERVAL_MS = 1000;

/** Platform calls a streaming bot reply needs. Failures resolve to null/false, never throw. */
export interface TextStreamTransport {
  /** Post a new message; returns its ref for later edits, or null on failure. */
  post(text: string): Promise<unknown>;
  edit(ref: unknown, text: string): Promise<boolean>;
  send(text: string): Promise<void>;
}

async function attempt<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/**
 * Progressive bot reply: posts a placeholder on the first delta, edits it at most once
 * per STREAM_EDIT_INTERVAL_MS, and settles it to the final text. If the placeholder or
 * an edit fails, editing stops and the final text is sent once as a new message.
 */
export function createTextStream(t: TextStreamTransport, now: () => number = Date.now) {
  let text = '';
  let shown = '';
  let ref: unknown = null;
  let started = false;
  let broken = false;
  let lastEdit = 0;

  return {
    async delta(chunk: string): Promise<void> {
      text += chunk;
      if (broken || !text.trim()) return;
      if (!started) {
        started = true;
        lastEdit = now();
        ref = await attempt(() => t.post(text), null);
        if (ref == null) broken = true;
        else shown = text;
        return;
      }
      if (now() - lastEdit < STREAM_EDIT_INTERVAL_MS || text === shown) return;
      lastEdit = now();
      if (await attempt(() => t.edit(ref, text), false)) shown = text;
      else broken = true;
    },

    async finish(final: string): Promise<void> {
      if (!final) return;
      if (!started) {
        await t.send(final);
        return;
      }
      if (!broken && (final === shown || await attempt(() => t.edit(ref, final), false))) return;
      await t.send(final);
    },
  };
}
