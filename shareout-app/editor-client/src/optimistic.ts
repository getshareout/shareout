/**
 * Optimistic actions for the editor — same contract as the platform's
 * window.soOptimistic (src/design-system/components/optimistic.ts), ported to a typed
 * module because the editor page doesn't load the shared component scripts.
 *
 * apply() updates the UI now, request() runs behind; a rejection or non-ok Response
 * rolls back exactly and shows an error toast with Retry. `undo: true` (destructive)
 * holds the request behind an "… · Undo" toast and sends it when the toast expires
 * (or the page hides). `key` ignores repeat clicks while an action is pending.
 *
 * withBusy() is for the listed exceptions (uploads, publish, restore-and-reload):
 * the trigger shows a busy label and is disabled until the work settles.
 */
import { showToast } from './toast';

export const UNDO_MS = 5000;

export interface OptimisticOptions<T = unknown> {
  key?: string;
  apply?: () => void;
  rollback?: (err?: unknown) => void;
  request: () => Promise<T> | T;
  success?: string;
  error?: string | ((err: unknown) => string);
  undo?: boolean;
  retry?: boolean;
  done?: (result: T) => void;
}

/** Throw from request() to fail with a user-facing message; noRetry hides Retry (e.g. a policy refusal). */
export class ActionError extends Error {
  noRetry: boolean;
  constructor(message: string, opts: { noRetry?: boolean } = {}) {
    super(message);
    this.noRetry = !!opts.noRetry;
  }
}

const inflight = new Set<string>();
const pending = new Set<() => void>();

function isResponse(x: unknown): x is Response {
  return !!x && typeof x === 'object' && typeof (x as Response).ok === 'boolean' && typeof (x as Response).status === 'number';
}

export function isBusy(key: string): boolean {
  return inflight.has(key);
}

/** Send every deferred (undo-window) request now. */
export function flushPending(): void {
  Array.from(pending).forEach((fire) => fire());
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', flushPending);

export function optimistic<T>(o: OptimisticOptions<T>): Promise<boolean> {
  const key = o.key;
  if (key && inflight.has(key)) return Promise.resolve(false);
  if (key) inflight.add(key);
  try {
    o.apply?.();
  } catch (e) {
    if (key) inflight.delete(key);
    return Promise.reject(e);
  }
  return new Promise<boolean>((resolve) => {
    const settle = (ok: boolean): void => {
      if (key) inflight.delete(key);
      resolve(ok);
    };
    const fail = (err: unknown): void => {
      try { o.rollback?.(err); } catch { /* rollback is best-effort */ }
      const msg = typeof o.error === 'function' ? o.error(err) : o.error;
      const noRetry = o.retry === false || (err instanceof ActionError && err.noRetry);
      showToast(msg || 'Couldn’t save that change. Check your connection?', 'error', {
        action: noRetry ? null : { label: 'Retry', run: () => void optimistic(o) },
        duration: 6000,
      });
      settle(false);
    };
    const send = (): void => {
      let p: Promise<T>;
      try { p = Promise.resolve(o.request()); } catch (e) { p = Promise.reject(e); }
      p.then((res) => {
        if (isResponse(res) && !res.ok) throw new Error(`HTTP ${res.status}`);
        if (!o.undo && o.success) showToast(o.success, 'success');
        try { o.done?.(res); } catch { /* caller follow-up is best-effort */ }
        settle(true);
      }).catch(fail);
    };
    if (!o.undo) {
      send();
      return;
    }
    let fired = false;
    const fire = (): void => {
      if (fired) return;
      fired = true;
      clearTimeout(timer);
      pending.delete(fire);
      toast.close();
      send();
    };
    pending.add(fire);
    const toast = showToast(o.success || 'Done', 'success', {
      action: {
        label: 'Undo',
        run: () => {
          if (fired) return;
          fired = true;
          clearTimeout(timer);
          pending.delete(fire);
          try { o.rollback?.(); } catch { /* best-effort */ }
          settle(false);
        },
      },
      duration: UNDO_MS,
    });
    const timer = setTimeout(fire, UNDO_MS);
  });
}

/** Exceptions only: busy label + disabled trigger while `fn` runs; repeat clicks are ignored. */
export async function withBusy<T>(btn: HTMLButtonElement | null | undefined, label: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (btn?.dataset.busy === '1') return undefined;
  const prev = btn?.innerHTML ?? '';
  if (btn) {
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = label;
  }
  try {
    return await fn();
  } finally {
    if (btn) {
      delete btn.dataset.busy;
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.innerHTML = prev;
    }
  }
}
