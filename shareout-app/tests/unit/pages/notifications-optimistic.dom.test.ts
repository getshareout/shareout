// @vitest-environment happy-dom
//
// Notification card actions are optimistic: dismiss / mark-all-read take effect on
// click and a failed request brings the items back where they were, with an error toast.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { componentScripts } from '../../../src/design-system/components/index';
import { workspace_client_notifications_JS as notifJs } from '../../../src/pages/home/render-workspace/client-script/notifications';

let fetchMock: ReturnType<typeof vi.fn>;
const feed = { needs: [{ id: 'e1', kind: 'comment', summary: 'First', ts: Date.now() }, { id: 'e2', kind: 'comment', summary: 'Second', ts: Date.now() }], actionItems: [], seen: [] };

function load() {
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.WSX_WS = null;
  const scope = new Proxy({}, {
    has: () => true,
    get: (target: Record<string | symbol, unknown>, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'window') return win;
      if (prop === 't') return (k: string) => k;
      if (prop === 'esc') return (s: unknown) => (s == null ? '' : String(s));
      if (prop === 'iconChip' || prop === 'timeAgo' || prop === 'i18nSpin') return () => '';
      if (prop === 'optimistic') return (o: unknown) => (win.soOptimistic as (o: unknown) => Promise<boolean>)(o);
      if (prop === 'fetch') return (...a: unknown[]) => fetchMock(...a);
      if (prop === 'showToast') return win.showToast;
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
  });
  new Function('scope', `with (scope) {\n${notifJs}\n}`)(scope);
}

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
const ids = () => [...document.querySelectorAll('#wsxNotifBody [data-eid]')].map((el) => el.getAttribute('data-eid'));
const toastText = () => [...document.querySelectorAll('.so-c-toast')].map((t) => t.textContent).join(' | ');

beforeEach(async () => {
  document.body.innerHTML = '<button id="wsxNotifBtn"></button><span id="wsxNotifBadge"></span><div id="wsxNotifPanel" hidden><div><button id="wsxNotifTabUnread" data-tab="unread"></button></div><div id="wsxNotifBody"></div><button id="wsxNotifReadAll"></button></div>';
  eval(componentScripts);
  fetchMock = vi.fn(async () => new Response(JSON.stringify(feed)));
  load();
  document.getElementById('wsxNotifBtn')!.click();
  await flush();
});

describe('notifications', () => {
  it('opening the panel marks needs-you items read: badge clears, items stay listed', () => {
    const marked = fetchMock.mock.calls.find((c) => String(c[0]).includes('/v1/home/dismiss-event'));
    expect(JSON.parse((marked![1] as RequestInit).body as string)).toEqual({ eventIds: ['e1', 'e2'] });
    expect(document.getElementById('wsxNotifBadge')!.hidden).toBe(true);
    expect(ids()).toEqual(['e1', 'e2']);
  });

  it('dismiss removes the card at once and puts it back in place if the request fails', async () => {
    let fail!: () => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => { fail = () => r(new Response('{}', { status: 500 })); }));
    expect(ids()).toEqual(['e1', 'e2']);
    document.querySelector<HTMLElement>('[data-dismiss="e1"]')!.click();
    expect(ids()).toEqual(['e2']);
    fail();
    await flush();
    expect(ids()).toEqual(['e1', 'e2']);
    expect(toastText()).toContain('evt.dismissFailed');
  });

  it('mark all read empties the list at once and restores it on failure', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 500 }));
    document.getElementById('wsxNotifReadAll')!.click();
    expect(ids()).toEqual([]);
    await flush();
    expect(ids()).toEqual(['e1', 'e2']);
  });
});
