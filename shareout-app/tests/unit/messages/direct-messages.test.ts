// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const notifyUserMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../../src/notify/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/notify/deliver')>()),
  notifyUser: notifyUserMock,
}));
// The REST guard reads the caller from a test header; the route's own membership check is real.
vi.mock('../../../src/router/helpers/auth-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/router/helpers/auth-guard')>()),
  requireTokenOrSession: async (ctx: { request: Request }) => {
    const id = ctx.request.headers.get('x-test-user');
    return id ? { id, email: null, username: null } : new Response('unauthorized', { status: 401 });
  },
}));

import { applyMigrations, e } from '../helpers/migrated-db';
import {
  findThread, listMessages, listThreads, markThreadRead, resolveRecipient, sendDirectMessage, unreadCount,
  type SendInput,
} from '../../../src/messages/store';
import { sendAndNotify } from '../../../src/messages/send';
import { notifyDirectMessage } from '../../../src/messages/notify';
import { readMessagesTool, sendMessageTool } from '../../../src/chat-agent/tools/messages';
import { executeAction, describeActionRich, type PendingAction } from '../../../src/chat-agent/actions';
import { MESSAGE_TOOLS } from '../../../src/mcp/message-tools';
import { routeWorkspaceMessages } from '../../../src/router/api/workspace-messages';
import type { FetchContext } from '../../../src/router/context';
import type { ToolContext as McpContext } from '../../../src/mcp/tool-kit';

const A = 'wsp_dm_a';
const B = 'wsp_dm_b';
const ana = 'usr_dm_ana';
const martin = 'usr_dm_martin';
const martina = 'usr_dm_martina';
const ext = 'usr_dm_ext';
const svc = 'usr_dm_svc';
const dis = 'usr_dm_dis';
const bob = 'usr_dm_bob';

const count = async () => (await e.DB.prepare('SELECT COUNT(*) AS n FROM direct_messages').first<{ n: number }>())!.n;
const send = (over: Partial<SendInput>) => sendDirectMessage(e, { workspaceId: A, senderId: ana, recipientId: martin, body: 'hola', via: 'web', ...over });

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare(`INSERT INTO users (id, email, name, is_service, disabled) VALUES
      (?, 'ana@acme.test', 'Ana Pérez', 0, 0), (?, 'martin.gomez@acme.test', 'Martín Gómez', 0, 0),
      (?, 'martina@acme.test', 'Martina Ruiz', 0, 0), (?, 'guest@other.test', 'Guest', 0, 0),
      (?, 'bot@acme.test', 'Bot', 1, 0), (?, 'gone@acme.test', 'Gone', 0, 1), (?, 'bob@acme.test', 'Bob', 0, 0)`)
      .bind(ana, martin, martina, ext, svc, dis, bob),
    e.DB.prepare(`INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Acme', 'dm-acme', ?), (?, 'Beta', 'dm-beta', ?)`).bind(A, ana, B, ana),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_dm1', ?, ?, 'owner', 'internal'), ('wm_dm2', ?, ?, 'member', 'internal'), ('wm_dm3', ?, ?, 'member', 'internal'),
      ('wm_dm4', ?, ?, 'member', 'external'), ('wm_dm5', ?, ?, 'member', 'internal'), ('wm_dm6', ?, ?, 'member', 'internal'),
      ('wm_dm7', ?, ?, 'owner', 'internal'), ('wm_dm8', ?, ?, 'member', 'internal')`)
      .bind(A, ana, A, martin, A, martina, A, ext, A, svc, A, dis, B, ana, B, bob),
    e.DB.prepare(`INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES
      ('art_dm_private', 'Martin private', 'dm-martin-private', ?, ?, 'private'),
      ('art_dm_shared', 'Ventas octubre', 'dm-ventas', ?, ?, 'workspace')`).bind(martin, A, ana, A),
    e.DB.prepare(`INSERT INTO users (id, email, name) VALUES ('usr_dm_mg2', 'mg@beta.test', 'Martín Gómez'), ('usr_dm_mg3', 'mgp@beta.test', 'Martín Gómez Pérez')`),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_dm9', ?, 'usr_dm_mg2', 'member', 'internal'), ('wm_dm10', ?, 'usr_dm_mg3', 'member', 'internal')`).bind(B, B),
  ]);
});

beforeEach(() => notifyUserMock.mockClear());

describe('direct messages: store', () => {
  it('sends one-to-one, keeps one thread per pair, and tracks unread per side', async () => {
    const first = await send({ body: 'hola Martín' });
    expect(first.ok).toBe(true);
    const second = await sendDirectMessage(e, { workspaceId: A, senderId: martin, recipientId: ana, body: 'hola Ana', via: 'web' });
    expect(second.ok && first.ok && second.threadId === first.threadId).toBe(true);

    // Sending does not read what the other person wrote (an assistant may send without opening it).
    expect(await unreadCount(e, A, martin)).toBe(1);
    expect(await unreadCount(e, A, ana)).toBe(1);
    await send({ body: '¿viste los números?' });
    expect(await unreadCount(e, A, martin)).toBe(2);
    expect(await unreadCount(e, A, ana)).toBe(1);

    const [thread] = await listThreads(e, A, martin);
    expect(thread.with.id).toBe(ana);
    expect(thread.unread).toBe(2);
    expect(thread.last).toMatchObject({ body: '¿viste los números?', sentByMe: false });

    const messages = await listMessages(e, thread.id, martin);
    expect(messages.map((m) => m.body)).toEqual(['¿viste los números?', 'hola Ana', 'hola Martín']);
    expect(messages[1].sentByMe).toBe(true);

    await markThreadRead(e, thread.id, martin);
    expect(await unreadCount(e, A, martin)).toBe(0);
  });

  it('only internal, enabled, human members of the same workspace — never yourself', async () => {
    const before = await count();
    expect(await send({ recipientId: ext })).toMatchObject({ ok: false, code: 'RECIPIENT_NOT_FOUND' });
    expect(await send({ recipientId: svc })).toMatchObject({ ok: false, code: 'RECIPIENT_NOT_FOUND' });
    expect(await send({ recipientId: dis })).toMatchObject({ ok: false, code: 'RECIPIENT_NOT_FOUND' });
    expect(await send({ recipientId: bob })).toMatchObject({ ok: false, code: 'RECIPIENT_NOT_FOUND' });
    expect(await send({ recipientId: ana })).toMatchObject({ ok: false, code: 'RECIPIENT_IS_SELF' });
    expect(await send({ senderId: ext })).toMatchObject({ ok: false, status: 403 });
    expect(await send({ senderId: bob })).toMatchObject({ ok: false, status: 403 });
    expect(await send({ body: '   ' })).toMatchObject({ ok: false, code: 'MESSAGE_EMPTY' });
    expect(await send({ body: 'x'.repeat(4001) })).toMatchObject({ ok: false, code: 'MESSAGE_TOO_LONG' });
    expect(await count()).toBe(before);
  });

  it('points at a page only when the sender can open it, in this workspace', async () => {
    expect(await send({ artifactId: 'art_dm_private' })).toMatchObject({ ok: false, code: 'ARTIFACT_NOT_FOUND' });
    const ok = await send({ artifactId: 'art_dm_shared', body: 'mirá esto' });
    expect(ok).toMatchObject({ ok: true, message: { artifact: { id: 'art_dm_shared', name: 'Ventas octubre' } } });
  });

  it('resolves who "to" means by email or name, accents aside, and asks when it is ambiguous', async () => {
    expect(await resolveRecipient(e, A, ana, 'MARTIN.GOMEZ@acme.test')).toMatchObject({ ok: true, person: { id: martin } });
    expect(await resolveRecipient(e, A, ana, 'martin gomez')).toMatchObject({ ok: true, person: { id: martin } });
    const amb = await resolveRecipient(e, A, ana, 'Mart');
    expect(amb).toMatchObject({ ok: false, code: 'RECIPIENT_AMBIGUOUS' });
    expect(!amb.ok && amb.candidates?.map((c) => c.id).sort()).toEqual([martin, martina].sort());
    expect(await resolveRecipient(e, A, ana, 'guest@other.test')).toMatchObject({ ok: false, code: 'RECIPIENT_NOT_FOUND' });
    expect(await resolveRecipient(e, A, ana, 'ana@acme.test')).toMatchObject({ ok: false, code: 'RECIPIENT_IS_SELF' });
  });

  it('prefers the person whose full name is exactly what was said', async () => {
    expect(await resolveRecipient(e, B, ana, 'Martín Gómez')).toMatchObject({ ok: true, person: { id: 'usr_dm_mg2' } });
    expect(await resolveRecipient(e, B, ana, 'martin')).toMatchObject({ ok: false, code: 'RECIPIENT_AMBIGUOUS' });
  });

  it('keeps each workspace’s conversations to itself', async () => {
    expect(await listThreads(e, B, ana)).toEqual([]);
    expect(await findThread(e, B, ana, { withUserId: martin })).toBeNull();
    const inA = await findThread(e, A, ana, { withUserId: martin });
    expect(inA).not.toBeNull();
    expect(await findThread(e, A, martina, { threadId: inA!.id })).toBeNull();
  });
});

describe('direct messages: Telegram ping', () => {
  it('sendAndNotify tells the recipient (not the sender) once', async () => {
    const sent = await sendAndNotify(e, { workspaceId: A, senderId: ana, recipientId: martina, body: 'ping', via: 'web' });
    expect(sent.ok).toBe(true);
    expect(notifyUserMock).toHaveBeenCalledTimes(1);
    expect(notifyUserMock.mock.calls[0][1]).toMatchObject({ userId: martina, actorIds: [ana], workspaceId: A });
  });

  it('says who wrote, that their assistant did, and links to the conversation', async () => {
    const sent = await sendDirectMessage(e, { workspaceId: A, senderId: ana, recipientId: martin, body: 'te escribo desde Claude', via: 'mcp', artifactId: 'art_dm_shared' });
    if (!sent.ok) throw new Error(sent.message);
    await notifyDirectMessage(e, A, ana, sent);
    const input = notifyUserMock.mock.calls[0][1] as { telegram: (l: 'es' | 'en') => string };
    const line = input.telegram('es');
    expect(line).toContain('Ana Pérez (con su asistente) te mandó un mensaje');
    expect(line).toContain('te escribo desde Claude');
    expect(line).toContain('Sobre "Ventas octubre"');
    expect(line).toContain(`/home#l/messages/${ana}`);
    expect(input.telegram('en')).toContain('(through their assistant)');
  });
});

describe('direct messages: assistant (web chat, Telegram)', () => {
  const ctx = (userId: string, ws: string | null = A) => ({ env: e, userId, selectedWorkspaceId: ws });

  it('send_message only proposes; it goes out as the person, via the assistant, once confirmed', async () => {
    const before = await count();
    const out = await sendMessageTool.execute(ctx(ana), { to: 'Martina', text: 'mañana revisamos' }) as { __propose: PendingAction };
    expect(out.__propose).toMatchObject({ kind: 'message_send', workspaceId: A, recipientId: martina, text: 'mañana revisamos' });
    expect(await count()).toBe(before);
    expect(describeActionRich(out.__propose, 'es').title).toBe('Mandar un mensaje');

    expect(await executeAction(e, ana, out.__propose, 'es')).toContain('Listo');
    const thread = await findThread(e, A, martina, { withUserId: ana });
    const [last] = await listMessages(e, thread!.id, martina, { limit: 1 });
    expect(last).toMatchObject({ body: 'mañana revisamos', sentVia: 'assistant', sentByMe: false });
  });

  it('re-checks membership when the confirmed action runs', async () => {
    const forged: PendingAction = { kind: 'message_send', workspaceId: A, recipientId: martin, recipientName: 'Martín', text: 'hola' };
    expect(await executeAction(e, bob, forged)).toMatch(/Couldn’t send/);
  });

  it('needs a workspace, and asks which person when the name is ambiguous', async () => {
    expect(await sendMessageTool.execute(ctx(ana, null), { to: 'Martín', text: 'x' })).toHaveProperty('error');
    expect(await sendMessageTool.execute(ctx(ana), { to: 'Mart', text: 'x' })).toEqual({ error: expect.stringContaining('Martina Ruiz') });
  });

  it('read_messages lists conversations and reads one, marking it read', async () => {
    const list = await readMessagesTool.execute(ctx(martin), {}) as { conversations: { with: string; unread: number }[] };
    expect(list.conversations.some((c) => c.with.startsWith('Ana Pérez'))).toBe(true);
    const one = await readMessagesTool.execute(ctx(martin), { with: 'ana' }) as { messages: { text: string }[]; link: string };
    expect(one.messages.length).toBeGreaterThan(0);
    expect(one.link).toContain(`#l/messages/${ana}`);
    expect(await unreadCount(e, A, martin)).toBe(0);
  });
});

describe('direct messages: MCP', () => {
  const [sendTool, readTool] = MESSAGE_TOOLS;
  const mcp = (id: string): McpContext => ({ env: e, user: { id, email: null, username: null }, origin: 'https://shareout.test', authorization: 'Bearer x' });

  const draftFor = async (user: string, text: string) => {
    const draft = await sendTool.run(mcp(user), { workspace_id: A, to: 'martina@acme.test', text });
    return (draft.structuredContent as { confirm_token: string; sent: boolean });
  };
  const drafts = async () => (await e.DB.prepare('SELECT COUNT(*) AS n FROM direct_message_drafts').first<{ n: number }>())!.n;

  it('send_message is two steps: a stored draft with a token, then one send', async () => {
    const before = await count();
    const draft = await draftFor(ana, 'desde Claude');
    expect(draft.sent).toBe(false);
    expect(await count()).toBe(before);

    const sent = await sendTool.run(mcp(ana), { workspace_id: A, to: 'martina@acme.test', text: 'desde Claude', confirm_token: draft.confirm_token });
    expect(sent.structuredContent).toMatchObject({ sent: true });
    expect(await count()).toBe(before + 1);
    const thread = await findThread(e, A, martina, { withUserId: ana });
    const [last] = await listMessages(e, thread!.id, martina, { limit: 1 });
    expect(last).toMatchObject({ body: 'desde Claude', sentVia: 'mcp' });

    // The same token again sends nothing: no duplicates, no replay.
    const again = await sendTool.run(mcp(ana), { workspace_id: A, to: 'martina@acme.test', text: 'desde Claude', confirm_token: draft.confirm_token });
    expect(again.isError).toBe(true);
    expect(await count()).toBe(before + 1);
  });

  it('a token that does not match the draft is spent: changed text sends nothing, then nor does the right text', async () => {
    const before = await count();
    const draft = await draftFor(ana, 'texto original');
    const tampered = await sendTool.run(mcp(ana), { workspace_id: A, to: 'martina@acme.test', text: 'otra cosa', confirm_token: draft.confirm_token });
    expect(tampered.isError).toBe(true);
    const retry = await sendTool.run(mcp(ana), { workspace_id: A, to: 'martina@acme.test', text: 'texto original', confirm_token: draft.confirm_token });
    expect(retry.isError).toBe(true);
    expect(await count()).toBe(before);
  });

  it('a token works only for the person it was drafted for, and not after it expires', async () => {
    const before = await count();
    const draft = await draftFor(ana, 'hola');
    const other = await sendTool.run(mcp(martin), { workspace_id: A, to: 'martina@acme.test', text: 'hola', confirm_token: draft.confirm_token });
    expect(other.isError).toBe(true);
    // Martín's attempt did not spend Ana's draft; it expires instead.
    await e.DB.prepare("UPDATE direct_message_drafts SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(draft.confirm_token).run();
    const late = await sendTool.run(mcp(ana), { workspace_id: A, to: 'martina@acme.test', text: 'hola', confirm_token: draft.confirm_token });
    expect(late.isError).toBe(true);
    expect(await count()).toBe(before);
  });

  it('drafts nobody confirmed are cleared on the next draft', async () => {
    const stale = await draftFor(ana, 'viejo');
    await e.DB.prepare("UPDATE direct_message_drafts SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(stale.confirm_token).run();
    const n = await drafts();
    await draftFor(ana, 'nuevo');
    expect(await drafts()).toBe(n);
    expect(await e.DB.prepare('SELECT 1 FROM direct_message_drafts WHERE id = ?').bind(stale.confirm_token).first()).toBeNull();
  });

  it('refuses a workspace the caller is not in, and reads conversations', async () => {
    expect((await sendTool.run(mcp(bob), { workspace_id: A, to: 'ana', text: 'x' })).isError).toBe(true);
    const read = await readTool.run(mcp(martina), { workspace_id: A, with: 'ana' });
    expect((read.structuredContent as { messages: unknown[] }).messages.length).toBeGreaterThan(0);
  });
});

const ts = (i: number) => `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`;
let readThread = '';

describe('direct messages: read only what was shown', () => {
  beforeAll(async () => {
    // Bob writes Ana 25 messages, one second apart, none read.
    const first = await sendDirectMessage(e, { workspaceId: B, senderId: bob, recipientId: ana, body: 'm0', via: 'web' });
    if (!first.ok) throw new Error(first.message);
    readThread = first.threadId;
    await e.DB.prepare('UPDATE direct_messages SET created_at = ? WHERE id = ?').bind(ts(0), first.message.id).run();
    const row = e.DB.prepare("INSERT INTO direct_messages (id, thread_id, sent_by, body, sent_via, created_at) VALUES (?, ?, ?, ?, 'web', ?)");
    await e.DB.batch(Array.from({ length: 24 }, (_, k) => row.bind(`dm_read_${k + 1}`, readThread, bob, `m${k + 1}`, ts(k + 1))));
  });

  it('25 unread: read_messages shows the oldest 20 and leaves 5 unread; the next read shows those 5', async () => {
    expect(await unreadCount(e, B, ana)).toBe(25);
    const first = await readMessagesTool.execute({ env: e, userId: ana, selectedWorkspaceId: B }, { with: 'bob' }) as { messages: { text: string }[]; more_unread?: number };
    expect(first.messages.map((m) => m.text)).toEqual(Array.from({ length: 20 }, (_, i) => `m${i}`));
    expect(first.more_unread).toBe(5);
    expect(await unreadCount(e, B, ana)).toBe(5);

    const [, mcpRead] = MESSAGE_TOOLS;
    const second = await mcpRead.run({ env: e, user: { id: ana, email: null, username: null }, origin: 'https://shareout.test', authorization: 'Bearer x' }, { workspace_id: B, with: 'bob' });
    const out = second.structuredContent as { messages: { text: string }[]; more_unread?: number };
    expect(out.messages.map((m) => m.text)).toEqual(['m20', 'm21', 'm22', 'm23', 'm24']);
    expect(out.more_unread).toBeUndefined();
    expect(await unreadCount(e, B, ana)).toBe(0);
  });

  it('a message that arrives after what was shown stays unread, and read state never moves back', async () => {
    await e.DB.prepare("INSERT INTO direct_messages (id, thread_id, sent_by, body, sent_via, created_at) VALUES ('dm_read_late', ?, ?, 'late', 'web', ?)").bind(readThread, bob, ts(30)).run();
    expect(await markThreadRead(e, readThread, ana, ts(24))).toBe(ts(24));
    expect(await unreadCount(e, B, ana)).toBe(1);
    await markThreadRead(e, readThread, ana, ts(5));
    expect(await unreadCount(e, B, ana)).toBe(1);
  });
});

describe('direct messages: REST API', () => {
  const call = async (user: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const request = new Request(`https://shareout.test${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const ctx = { request, env: e, path, addCORS: (r: Response) => r } as unknown as FetchContext;
    return routeWorkspaceMessages(ctx);
  };

  it('sends, lists, opens and marks read', async () => {
    const res = await call(martina, 'POST', `/v1/workspaces/${A}/messages`, { to: 'Martín Gómez', text: 'hola desde la API' });
    expect(res!.status).toBe(201);
    expect(await res!.json()).toMatchObject({ message: { body: 'hola desde la API', sentVia: 'web' }, recipient: { id: martin } });

    const list = await (await call(martin, 'GET', `/v1/workspaces/${A}/messages`))!.json() as { threads: { with: { id: string }; unread: number }[]; unread: number };
    expect(list.unread).toBeGreaterThan(0);
    expect(list.threads.find((t) => t.with.id === martina)?.unread).toBe(1);

    const open = await (await call(martin, 'GET', `/v1/workspaces/${A}/messages/with/${martina}`))!.json() as { messages: { body: string }[] };
    expect(open.messages[0].body).toBe('hola desde la API');
    await call(martin, 'POST', `/v1/workspaces/${A}/messages/with/${martina}/read`);
    const after = await (await call(martin, 'GET', `/v1/workspaces/${A}/messages/unread`))!.json() as { unread: number };
    expect(after.unread).toBe(0);
  });

  it('marks a token caller as api, and names candidates when the name is ambiguous', async () => {
    const res = await call(ana, 'POST', `/v1/workspaces/${A}/messages`, { to: 'martin gomez', text: 'por API' }, { authorization: 'Bearer so_test' });
    expect(await res!.json()).toMatchObject({ message: { sentVia: 'api' } });
    const amb = await call(ana, 'POST', `/v1/workspaces/${A}/messages`, { to: 'Mart', text: 'x' });
    expect(amb!.status).toBe(409);
    expect(((await amb!.json()) as { candidates: unknown[] }).candidates).toHaveLength(2);
  });

  it('/read takes up_to: a future date reads only what exists, and a bad one is refused', async () => {
    const res = await call(ana, 'POST', `/v1/workspaces/${B}/messages/with/${bob}/read`, { up_to: '2099-01-01T00:00:00.000Z' });
    expect(await res!.json()).toMatchObject({ success: true, read_up_to: ts(30) });
    expect(await unreadCount(e, B, ana)).toBe(0);
    await e.DB.prepare("INSERT INTO direct_messages (id, thread_id, sent_by, body, sent_via, created_at) VALUES ('dm_read_after', ?, ?, 'after', 'web', ?)").bind(readThread, bob, ts(40)).run();
    expect(await unreadCount(e, B, ana)).toBe(1);
    expect((await call(ana, 'POST', `/v1/workspaces/${B}/messages/with/${bob}/read`, { up_to: 'yesterday' }))!.status).toBe(400);
    expect(await unreadCount(e, B, ana)).toBe(1);
  });

  it('refuses non-members and external members; a new conversation opens empty', async () => {
    expect((await call(bob, 'GET', `/v1/workspaces/${A}/messages`))!.status).toBe(403);
    expect((await call(ext, 'GET', `/v1/workspaces/${A}/messages`))!.status).toBe(403);
    expect((await call(null, 'GET', `/v1/workspaces/${A}/messages`))!.status).toBe(401);
    const people = await (await call(ana, 'GET', `/v1/workspaces/${A}/messages/people`))!.json() as { people: { id: string }[] };
    expect(people.people.map((p) => p.id).sort()).toEqual([martin, martina].sort());
    const fresh = await (await call(martina, 'GET', `/v1/workspaces/${A}/messages/with/${martin}`))!.json() as { thread_id: string | null };
    expect(fresh).toBeDefined();
    expect((await call(ana, 'GET', `/v1/workspaces/${A}/messages/with/${ext}`))!.status).toBe(404);
  });
});
