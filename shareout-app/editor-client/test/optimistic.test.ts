// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn(async () => true) }));

import { optimistic, withBusy, ActionError, isBusy } from '../src/optimistic';
import { renderMetricsPanel } from '../src/rail/metrics-panel';

const toastText = () => document.getElementById('toast-container')?.textContent ?? '';
const actionBtn = () => document.querySelector<HTMLButtonElement>('#toast-container .toast-action');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('editor optimistic()', () => {
  it('applies now, rolls back on failure, and offers Retry that re-runs the action', async () => {
    let v = 'old';
    const request = vi.fn(async () => new Response('{}', { status: 500 }));
    const p = optimistic({ apply: () => { v = 'new'; }, rollback: () => { v = 'old'; }, request, error: 'Couldn’t rename' });
    expect(v).toBe('new');
    expect(await p).toBe(false);
    expect(v).toBe('old');
    expect(toastText()).toContain('Couldn’t rename');
    actionBtn()!.click();
    expect(v).toBe('new');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('hides Retry for a refusal (ActionError noRetry)', async () => {
    await optimistic({ request: async () => { throw new ActionError('Held', { noRetry: true }); }, error: (e) => (e as Error).message });
    expect(toastText()).toContain('Held');
    expect(actionBtn()).toBeNull();
  });

  it('undo: defers the request; Undo restores and never sends', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => new Response('{}'));
    let gone = false;
    const p = optimistic({ key: 'k', undo: true, apply: () => { gone = true; }, rollback: () => { gone = false; }, request, success: 'Deleted' });
    expect(gone).toBe(true);
    expect(isBusy('k')).toBe(true);
    actionBtn()!.click();
    expect(await p).toBe(false);
    expect(gone).toBe(false);
    vi.advanceTimersByTime(10000);
    expect(request).not.toHaveBeenCalled();
  });

  it('ignores repeat calls on the same key while pending', async () => {
    let release!: () => void;
    const request = vi.fn(() => new Promise<Response>((r) => { release = () => r(new Response('{}')); }));
    const first = optimistic({ key: 'x', request });
    expect(await optimistic({ key: 'x', request })).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toBe(true);
  });

  it('withBusy shows a busy label, ignores re-entry, then restores the button', async () => {
    const btn = document.createElement('button');
    btn.innerHTML = '<b>Publish</b>';
    let release!: () => void;
    const work = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const run = withBusy(btn, 'Publishing…', work);
    expect(btn.textContent).toBe('Publishing…');
    expect(btn.disabled).toBe(true);
    await withBusy(btn, 'Publishing…', work);
    expect(work).toHaveBeenCalledTimes(1);
    release();
    await run;
    expect(btn.innerHTML).toBe('<b>Publish</b>');
    expect(btn.disabled).toBe(false);
  });
});

describe('metrics panel', () => {
  it('deleting an alert removes it at once, holds the DELETE behind Undo, and a reload keeps it hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls: [string, RequestInit | undefined][] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.startsWith('/v1/metric-alerts/definitions')) return json({ definitions: [] });
      if (url.startsWith('/v1/metric-alerts?')) return json({ alerts: [{ id: 'al_1', name: 'Rev drop', metric_id: 'revenue', enabled: true }] });
      return json({});
    }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ctx = { config: { artifactId: 'a1' } } as never;
    await renderMetricsPanel(ctx, host);
    host.querySelector<HTMLButtonElement>('[data-alert-del="al_1"]')!.click();
    await flush();
    expect(host.querySelector('[data-alert-del="al_1"]')).toBeNull();
    expect(toastText()).toContain('Alert deleted');
    await renderMetricsPanel(ctx, host); // a reload mid-undo window must not flash it back
    expect(host.querySelector('[data-alert-del="al_1"]')).toBeNull();
    expect(calls.some(([, i]) => i?.method === 'DELETE')).toBe(false);
    vi.advanceTimersByTime(5000);
    await flush();
    const del = calls.find(([, i]) => i?.method === 'DELETE');
    expect(del?.[0]).toBe('/v1/metric-alerts/al_1');
    expect(del?.[1]?.keepalive).toBe(true);
  });
});
