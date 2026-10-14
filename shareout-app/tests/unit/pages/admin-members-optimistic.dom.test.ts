// @vitest-environment happy-dom
//
// Admin → Members is optimistic: removing a member takes the row out at once behind a
// "Member removed · Undo" toast; the DELETE fires when the toast closes, Undo cancels it,
// and a refused DELETE brings the row back with an error. Changing a role flips the
// select now and puts it back if the server refuses.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { componentScripts } from '../../../src/design-system/components/index';
import { workspace_client_home_views_admin_JS as adminJs } from '../../../src/pages/home/render-workspace/client-script/home-views/admin';

let fetchMock: ReturnType<typeof vi.fn>;
let deleteStatus = 200;
let roleStatus = 200;

const members = [
  { user_id: 'u1', email: 'owner@estudio.com.ar', role: 'owner', joined_at: '2026-01-02T00:00:00Z' },
  { user_id: 'u2', email: 'lucia@estudio.com.ar', name: 'Lucía Paz', role: 'member', joined_at: '2026-02-02T00:00:00Z' },
];
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });

function load(): { adMembers: () => void } {
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = 'wsp_1';
  const blackhole: unknown = new Proxy(function () {}, {
    get: (_t, p) => (p === Symbol.toPrimitive ? () => '' : blackhole),
    apply: () => blackhole,
  });
  // Names admin.ts declares itself must resolve locally, not through the stub scope.
  const local = new Set([...adminJs.matchAll(/(?:var|function)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  const scope = new Proxy({}, {
    has: (_t, p) => typeof p !== 'string' || !local.has(p),
    get: (_t, prop) => {
      if (typeof prop === 'symbol') return prop === Symbol.unscopables ? undefined : blackhole;
      if (prop === 'window') return win;
      if (prop === 'document') return globalThis.document;
      if (prop === 'needWs') return () => false;
      if (prop === 'esc') return (s: unknown) => (s == null ? '' : String(s));
      if (prop === 't') return (k: unknown) => String(k);
      if (prop.startsWith('i18n')) return () => '';
      if (prop === 'adRelDate') return () => '';
      if (prop === 'invTeamAccess') return () => {};
      if (prop === 'optimistic') return (o: unknown) => (win.soOptimistic as (o: unknown) => Promise<boolean>)(o);
      if (prop === 'optBusy') return (k: string) => (win.soOptimistic as { busy(k: string): boolean }).busy(k);
      if (prop === 'showToast') return win.showToast;
      if (prop === 'fetch') return (...a: unknown[]) => fetchMock(...a);
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return blackhole;
    },
  });
  return new Function('scope', `with (scope) {\n${adminJs}\n; return { adMembers: adMembers }; }`)(scope);
}

const row = () => document.querySelector<HTMLElement>('[data-mem="u2"]');
const gone = () => { const r = row(); return !r || r.classList.contains('so-c-leaving') || r.style.display === 'none'; };
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const deletes = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE');

async function render() {
  load().adMembers();
  await flush();
  expect(row()).not.toBeNull();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="wsxAdminMount"></div>';
  eval(componentScripts);
  (window as unknown as { confirm: () => boolean }).confirm = () => true;
  deleteStatus = 200; roleStatus = 200;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return json({}, deleteStatus);
    if (init?.method === 'POST' && url.endsWith('/members')) return json(roleStatus === 200 ? {} : { error: 'Only owners can promote' }, roleStatus);
    if (url.includes('/members/metrics')) return json({ members });
    if (url.includes('/invites')) return json({ invites: [] });
    return json({});
  });
});
afterEach(() => vi.useRealTimers());

describe('admin members — remove', () => {
  it('the row leaves at once and the DELETE waits for the undo window', async () => {
    await render();
    vi.useFakeTimers();
    row()!.querySelector<HTMLElement>('[data-mem-rm]')!.click();
    expect(gone()).toBe(true);
    expect(deletes()).toHaveLength(0);
    expect(document.querySelector('.so-c-toast')!.textContent).toContain('admin.memberRemoved');
    vi.advanceTimersByTime(5000);
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0][0]).toBe('/v1/workspaces/wsp_1/members/u2');
    expect((deletes()[0][1] as RequestInit).keepalive).toBe(true);
  });

  it('Undo restores the row and never sends the DELETE', async () => {
    await render();
    vi.useFakeTimers();
    row()!.querySelector<HTMLElement>('[data-mem-rm]')!.click();
    document.querySelector<HTMLButtonElement>('.so-c-toast__act')!.click();
    expect(gone()).toBe(false);
    vi.advanceTimersByTime(10000);
    expect(deletes()).toHaveLength(0);
  });

  it('a refused DELETE brings the row back with an error toast', async () => {
    deleteStatus = 500;
    await render();
    vi.useFakeTimers();
    row()!.querySelector<HTMLElement>('[data-mem-rm]')!.click();
    vi.advanceTimersByTime(5000);
    await vi.advanceTimersByTimeAsync(10);
    expect(gone()).toBe(false);
    const err = document.querySelector('.so-c-toast--error')!;
    expect(err.textContent).toContain('admin.memberRemoveFailed');
    expect(err.querySelector('.so-c-toast__act')).not.toBeNull();
  });
});

describe('admin members — role', () => {
  it('a refused role change puts the old role back and shows the server reason', async () => {
    roleStatus = 403;
    await render();
    const sel = document.querySelector<HTMLSelectElement>('[data-mem-role="lucia@estudio.com.ar"]')!;
    sel.value = 'admin';
    sel.dispatchEvent(new Event('change'));
    expect(sel.value).toBe('admin');
    await flush();
    expect(sel.value).toBe('member');
    expect(document.querySelector('.so-c-toast--error')!.textContent).toContain('Only owners can promote');
  });

  it('a second change while the first is saving snaps back instead of silently not saving', async () => {
    await render();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.endsWith('/members')) { await gate; return json({}); }
      return base(url, init);
    });
    const sel = document.querySelector<HTMLSelectElement>('[data-mem-role="lucia@estudio.com.ar"]')!;
    sel.value = 'admin';
    sel.dispatchEvent(new Event('change'));
    sel.value = 'viewer';
    sel.dispatchEvent(new Event('change'));
    expect(sel.value).toBe('admin');
    release();
    await flush();
    const posts = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
    expect(posts).toHaveLength(1);
  });
});
