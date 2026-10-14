// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { componentScripts } from '../../../src/design-system/components/index';

type Opts = {
  key?: string;
  apply?: () => void;
  rollback?: () => void;
  request: () => unknown;
  success?: string;
  error?: string;
  undo?: boolean;
  done?: (r: unknown) => void;
};
type Leave = { restore(): void; commit(): void };
type Opt = ((o: Opts) => Promise<boolean>) & { busy(k: string): boolean; flush(): void; leave(els: unknown): Leave; labels: Record<string, string> };
const opt = () => (window as unknown as { soOptimistic: Opt }).soOptimistic;
const toasts = () => [...document.querySelectorAll('.so-c-toast')];
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => {
  document.body.innerHTML = '<ul><li id="a">A</li><li id="b">B</li></ul>';
  eval(componentScripts);
});
afterEach(() => vi.useRealTimers());

describe('soOptimistic', () => {
  it('applies immediately, then rolls back exactly and offers Retry when the request fails', async () => {
    let name = 'Old';
    const request = vi.fn(async () => new Response('{}', { status: 500 }));
    const p = opt()({ apply: () => { name = 'New'; }, rollback: () => { name = 'Old'; }, request, error: "Couldn't rename" });
    expect(name).toBe('New');
    expect(await p).toBe(false);
    expect(name).toBe('Old');
    const t = toasts()[0];
    expect(t.textContent).toContain("Couldn't rename");
    expect(t.getAttribute('role')).toBe('alert');
    t.querySelector<HTMLButtonElement>('.so-c-toast__act')!.click();
    expect(name).toBe('New');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps the change and shows the success toast when the request succeeds', async () => {
    const rollback = vi.fn();
    const done = vi.fn();
    const ok = await opt()({ apply: () => {}, rollback, request: async () => new Response('{}'), success: 'Saved', done });
    expect(ok).toBe(true);
    expect(rollback).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalled();
    expect(toasts()[0].textContent).toContain('Saved');
  });

  it('defers a destructive request until the undo window closes; Undo cancels it and restores', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => new Response('{}'));
    let gone = false;
    const p = opt()({ key: 'del:1', undo: true, apply: () => { gone = true; }, rollback: () => { gone = false; }, request, success: 'Deleted' });
    expect(gone).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(opt().busy('del:1')).toBe(true);
    toasts()[0].querySelector<HTMLButtonElement>('.so-c-toast__act')!.click();
    expect(await p).toBe(false);
    expect(gone).toBe(false);
    vi.advanceTimersByTime(10000);
    expect(request).not.toHaveBeenCalled();
    expect(opt().busy('del:1')).toBe(false);
  });

  it('sends the deferred request once the undo window expires (or the page hides)', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => new Response('{}'));
    const p = opt()({ undo: true, apply: () => {}, rollback: () => {}, request, success: 'Deleted' });
    vi.advanceTimersByTime(5000);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(await p).toBe(true);

    const r2 = vi.fn(async () => new Response('{}'));
    opt()({ undo: true, apply: () => {}, request: r2, success: 'Deleted' });
    window.dispatchEvent(new Event('pagehide'));
    expect(r2).toHaveBeenCalledTimes(1);
  });

  it('ignores repeat clicks on the same key while it is in flight', async () => {
    let resolve!: (r: Response) => void;
    const request = vi.fn(() => new Promise<Response>((r) => { resolve = r; }));
    const apply = vi.fn();
    const first = opt()({ key: 'fav:1', apply, request });
    const second = await opt()({ key: 'fav:1', apply, request });
    expect(second).toBe(false);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    resolve(new Response('{}'));
    expect(await first).toBe(true);
    expect(opt().busy('fav:1')).toBe(false);
  });

  it('uses the surface labels for Undo / Retry', async () => {
    opt().labels = { undo: 'Deshacer', retry: 'Reintentar' };
    opt()({ undo: true, apply: () => {}, request: async () => new Response('{}'), success: 'Artefacto eliminado' });
    expect(toasts()[0].textContent).toContain('Deshacer');
    await opt()({ request: async () => { throw new Error('offline'); }, error: 'No se pudo' });
    expect(toasts()[1].textContent).toContain('Reintentar');
  });

  it('leave() fades rows out in place and restore() brings them back in the same spot', () => {
    vi.useFakeTimers();
    const a = document.getElementById('a')!;
    const h = opt().leave(a);
    vi.advanceTimersByTime(200);
    expect(a.style.display).toBe('none');
    h.restore();
    expect(a.style.display).toBe('');
    expect(a.classList.contains('so-c-leaving')).toBe(false);
    expect(document.querySelector('ul')!.firstElementChild).toBe(a);
    opt().leave([a]).commit();
    expect(document.getElementById('a')).toBeNull();
  });
});

describe('showToast', () => {
  it('renders an action button that closes the toast and runs the callback', () => {
    const run = vi.fn();
    (window as unknown as { showToast: (m: string, t?: string, o?: unknown) => void }).showToast('Deleted', 'success', { action: { label: 'Undo', run } });
    document.querySelector<HTMLButtonElement>('.so-c-toast__act')!.click();
    expect(run).toHaveBeenCalled();
    expect(document.querySelector('.so-c-toast')).toBeNull();
  });
});
