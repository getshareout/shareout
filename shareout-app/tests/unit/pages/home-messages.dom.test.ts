// @vitest-environment happy-dom
//
// Direct messages in the workspace Home: the rail badge and the bell share one unread count, a
// bell row opens the conversation (#l/messages/<userId>, the link the Telegram notice uses), the
// conversation is marked read, Enter sends, a refusal is one plain sentence, and New message
// picks a person. One shell boot for the file: a booted shell keeps its window listeners.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { componentScripts } from '../../../src/design-system/components/index';
import { buildWorkspaceView } from '../../../src/pages/home/render-workspace';
import { lazyChunkBody } from '../../../src/pages/home/render-workspace/client-script/lazy-chunks';
import type { RenderArgs } from '../../../src/pages/home/types';

const args = {
  user: { id: 'usr_ana', email: 'ana@example.com' }, userInfo: { name: 'Ana', picture: null },
  workspaces: [{ id: 'wsp_acme', name: 'Acme', slug: 'acme', branding: null }],
  workspace: 'wsp_acme', workspaceId: 'wsp_acme', workspaceRole: 'member', wsKnowledgePaid: true,
  createEnabled: true, locale: null,
} as unknown as RenderArgs;

const MARTIN = { id: 'usr_martin', name: 'Martín Gómez', email: 'martin@example.com', picture: null };
const LUCIA = { id: 'usr_lucia', name: 'Lucía Díaz', email: 'lucia@example.com', picture: null };
const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const martinMsgs = [
  { id: 'm2', body: 'Te paso el resumen', sentByMe: false, senderId: MARTIN.id, sentVia: 'assistant', artifact: { id: 'art_1', name: 'Ventas de octubre', slug: 'ventas-octubre' }, createdAt: at(10) },
  { id: 'm1', body: 'Hola Ana', sentByMe: false, senderId: MARTIN.id, sentVia: 'web', artifact: null, createdAt: at(12) },
];
let martinUnread = 2;
const thread = () => ({ id: 'dmt_1', with: MARTIN, last: { body: 'Te paso el resumen', sentByMe: false, sentVia: 'assistant', at: at(10) }, unread: martinUnread, lastMessageAt: at(10) });

type Call = { url: string; method: string; body: unknown };
const calls: Call[] = [];
// While set, the conversation list request hangs until release() (a slow refresh).
let holdList: { release: () => void } | null = null;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

function route(url: string, method: string, body: Record<string, unknown> | null): Response {
  const chunk = url.match(/^\/sdk\/home-lens-([a-z]+)\.js/);
  if (chunk) return new Response(lazyChunkBody(chunk[1]!));
  const base = '/v1/workspaces/wsp_acme/messages';
  if (!url.startsWith(base)) return json({});
  const sub = url.slice(base.length);
  if (method === 'POST' && sub === '') {
    if (body?.text === 'fail') return json({ success: false, error: 'Slow down', code: 'RATE_LIMITED' }, 429);
    return json({ message: { id: 'm3', body: body?.text, sentByMe: true, senderId: 'usr_ana', sentVia: 'web', artifact: null, createdAt: new Date().toISOString() }, thread_id: 'dmt_1', recipient: MARTIN }, 201);
  }
  if (method === 'POST' && sub === `/with/${MARTIN.id}/read`) { martinUnread = 0; return json({ success: true }); }
  if (sub.startsWith('?')) {
    const threads = [thread()].filter((t) => !sub.includes('unread=1') || t.unread > 0);
    return json({ threads, unread: martinUnread });
  }
  if (sub === '/people') return json({ people: [LUCIA, MARTIN] });
  if (sub.startsWith(`/with/${MARTIN.id}?`)) return json({ thread_id: 'dmt_1', with: MARTIN, messages: martinMsgs });
  if (sub.startsWith(`/with/${LUCIA.id}?`)) return json({ thread_id: null, with: LUCIA, messages: [] });
  return json({ error: 'not found' }, 404);
}

const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0)); };
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const posts = (suffix: string) => calls.filter((c) => c.method === 'POST' && c.url.endsWith(suffix));
const railBadge = () => $('[data-lens="messages"] .wsx-lens__bdg');
function type(text: string, opts: KeyboardEventInit = {}) {
  const ta = $<HTMLTextAreaElement>('#wsxMsgText')!;
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...opts }));
}

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input).replace(/^https?:\/\/[^/]+/, '');
    const method = (init?.method || 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    if (holdList && method === 'GET' && url.startsWith('/v1/workspaces/wsp_acme/messages?')) {
      const held = holdList;
      return new Promise<Response>((resolve) => { held.release = () => resolve(route(url, method, body)); });
    }
    return route(url, method, body);
  }));
  const { body, scripts } = buildWorkspaceView(args);
  document.body.innerHTML = body;
  (0, eval)(componentScripts);
  (0, eval)(scripts);
  await settle();
});
afterAll(() => {
  // Leave the view so its 20 s poll stops.
  $<HTMLElement>('[data-lens="brief"]')?.click();
  vi.unstubAllGlobals();
});

describe('workspace messages', () => {
  it('one boot request feeds the rail badge and the bell', () => {
    expect(calls.filter((c) => c.url.startsWith('/v1/workspaces/wsp_acme/messages'))).toHaveLength(1);
    expect(railBadge()?.hidden).toBe(false);
    expect(railBadge()?.textContent).toBe('2');
    expect($('#wsxNotifBadge')?.textContent).toBe('2');
  });

  it('Messages paints the conversations at once from the boot request, then refreshes behind', async () => {
    // Pointing at Messages fetches the view's code before the click.
    $<HTMLElement>('[data-lens="messages"]')!.dispatchEvent(new Event('pointerenter'));
    await settle();
    expect(calls.filter((c) => c.url.startsWith('/sdk/home-lens-messages.js'))).toHaveLength(1);

    holdList = { release: () => {} };
    $<HTMLElement>('[data-lens="messages"]')!.click();
    await settle();
    // The refresh is still out, yet the list is there, not a spinner.
    expect(calls.filter((c) => c.url.startsWith('/v1/workspaces/wsp_acme/messages?'))).toHaveLength(2);
    const rows = [...document.querySelectorAll('.wsx-dm__row')];
    expect(rows.map((r) => r.getAttribute('data-msg-open'))).toEqual([MARTIN.id]);
    expect(rows[0]!.textContent).toContain('Te paso el resumen');
    holdList.release();
    holdList = null;
    await settle();
    expect(document.querySelectorAll('.wsx-dm__row')).toHaveLength(1);
  });

  it('the bell lists unread conversations; a row opens it and marks it read', async () => {
    $<HTMLElement>('#wsxNotifBtn')!.click();
    await settle();
    const row = $<HTMLAnchorElement>('#wsxNotifBody [data-msg-with]')!;
    expect($('#wsxNotifBody')!.textContent).toContain('Messages');
    expect(row.getAttribute('href')).toBe(`#l/messages/${MARTIN.id}`);
    expect(row.textContent).toContain('Martín Gómez');
    expect(row.textContent).toContain('Te paso el resumen');
    row.click();
    await settle();
    expect($('#wsxNotifPanel')!.hidden).toBe(true);
    expect($('.wsx__view[data-view="messages"]')!.classList.contains('is-active')).toBe(true);
    expect($('.wsx-dm__head')!.textContent).toContain('Martín Gómez');
    const bubbles = [...document.querySelectorAll('.wsx-dm__bub')].map((b) => b.textContent);
    expect(bubbles).toEqual(['Hola Ana', 'Te paso el resumen']);
    expect($('.wsx-dm__log')!.textContent).toContain('through their assistant');
    expect($('.wsx-dm__art')!.getAttribute('href')).toBe('/a/ventas-octubre/');
    expect(posts(`/with/${MARTIN.id}/read`).length).toBeGreaterThan(0);
    // Read up to the newest message on screen, not "now": one that arrives meanwhile stays unread.
    expect(posts(`/with/${MARTIN.id}/read`)[0].body).toEqual({ up_to: martinMsgs[0].createdAt });
    expect(railBadge()?.hidden).toBe(true);
    expect($('#wsxNotifBadge')!.hidden).toBe(true);
  });

  it('Enter sends, Shift+Enter does not, and a refusal reads as one sentence', async () => {
    type('line one', { shiftKey: true });
    await settle();
    expect(posts('/messages')).toHaveLength(0);

    type('Lo miro ahora');
    await settle();
    expect(posts('/messages').map((c) => c.body)).toEqual([{ to: MARTIN.id, text: 'Lo miro ahora' }]);
    expect([...document.querySelectorAll('.wsx-dm__b.is-mine .wsx-dm__bub')].map((b) => b.textContent)).toEqual(['Lo miro ahora']);
    expect($<HTMLTextAreaElement>('#wsxMsgText')!.value).toBe('');

    type('fail');
    await settle();
    const err = $('#wsxMsgErr')!;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toBe('You’re sending a lot of messages. Wait a minute and try again.');
    expect($<HTMLTextAreaElement>('#wsxMsgText')!.value).toBe('fail');
    expect($<HTMLTextAreaElement>('#wsxMsgText')!.disabled).toBe(false);
  });

  it('New message picks a person and opens an empty conversation ready to write', async () => {
    $<HTMLElement>('[data-msg-new]')!.click();
    await settle();
    const find = $<HTMLInputElement>('.wsx-dm__find')!;
    find.value = 'luc';
    find.dispatchEvent(new Event('input', { bubbles: true }));
    const people = [...document.querySelectorAll('[data-msg-person]')];
    expect(people.map((p) => p.getAttribute('data-msg-person'))).toEqual([LUCIA.id]);
    (people[0] as HTMLElement).click();
    await settle();
    expect($('.wsx-modal')).toBeNull();
    expect(location.hash).toBe(`#l/messages/${LUCIA.id}`);
    expect($('.wsx-dm__hello')!.textContent).toBe('No messages with Lucía yet. Write the first one below.');
    expect($('#wsxMsgText')).not.toBeNull();
    // She joins the list before the first message, selected.
    expect($('.wsx-dm__row.is-on')!.getAttribute('data-msg-open')).toBe(LUCIA.id);
  });

  it('back returns to the list (#l/messages)', async () => {
    $<HTMLElement>('[data-msg-back]')!.click();
    await settle();
    expect(location.hash).toBe('#l/messages');
    expect($('#wsxMsgMount')!.classList.contains('is-conv')).toBe(false);
  });
});
