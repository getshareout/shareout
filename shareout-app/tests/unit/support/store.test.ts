import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import type { Env } from '../../../src/types';
import {
  createTicket, appendMessage, getTicket, getThread, threadAsChatHistory,
  setStatus, assign, setTriage, listForWorkspace, listAll, listForRequester,
  findLatestOpenTicketByEmail, autoCloseIdleTickets,
} from '../../../src/support/store';

const e = env as unknown as Env;

beforeAll(async () => {
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, workspace_id TEXT, requester_user_id TEXT, requester_email TEXT, channel TEXT NOT NULL, channel_ref TEXT, subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', priority TEXT, category TEXT, assignee_user_id TEXT, ai_draft TEXT, ai_meta_json TEXT, sla_due INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_msg_at INTEGER NOT NULL)`
  );
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS ticket_messages (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)`
  );
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM ticket_messages');
  await e.DB.exec('DELETE FROM tickets');
});

describe('createTicket', () => {
  it('opens a ticket seeded with the first customer message', async () => {
    const t = await createTicket(e, {
      workspaceId: 'wsp_1', requesterEmail: 'user@example.com',
      channel: 'ui', subject: 'Cannot publish', body: 'Publish button does nothing.',
    });
    expect(t.status).toBe('open');
    expect(t.channel).toBe('ui');
    const thread = await getThread(e, t.id);
    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({ author: 'customer', body: 'Publish button does nothing.' });
  });
});

describe('appendMessage lifecycle', () => {
  it('staff reply moves ticket to pending; customer reply reopens', async () => {
    const t = await createTicket(e, { workspaceId: 'wsp_1', channel: 'email', subject: 'Q', body: 'hi' });
    await appendMessage(e, t.id, 'staff', 'Here is your answer.');
    expect((await getTicket(e, t.id))!.status).toBe('pending');
    await appendMessage(e, t.id, 'customer', 'Still broken.');
    expect((await getTicket(e, t.id))!.status).toBe('open');
    expect(await getThread(e, t.id)).toHaveLength(3);
  });

  it('ai message does not change status', async () => {
    const t = await createTicket(e, { workspaceId: 'wsp_1', channel: 'ui', subject: 'Q', body: 'hi' });
    await appendMessage(e, t.id, 'ai', 'draft note');
    expect((await getTicket(e, t.id))!.status).toBe('open');
  });

  it('maps thread to chat history roles', async () => {
    const t = await createTicket(e, { workspaceId: 'wsp_1', channel: 'ui', subject: 'Q', body: 'customer says' });
    await appendMessage(e, t.id, 'staff', 'staff says');
    const hist = await threadAsChatHistory(e, t.id);
    expect(hist).toEqual([
      { role: 'user', content: 'customer says' },
      { role: 'assistant', content: 'staff says' },
    ]);
  });
});

describe('status, assign, triage', () => {
  it('sets status and assignee', async () => {
    const t = await createTicket(e, { workspaceId: 'wsp_1', channel: 'ui', subject: 'Q', body: 'hi' });
    await setStatus(e, t.id, 'resolved');
    await assign(e, t.id, 'usr_staff');
    const got = (await getTicket(e, t.id))!;
    expect(got.status).toBe('resolved');
    expect(got.assignee_user_id).toBe('usr_staff');
  });

  it('stores triage draft without sending', async () => {
    const t = await createTicket(e, { workspaceId: 'wsp_1', channel: 'ui', subject: 'Q', body: 'hi' });
    await setTriage(e, t.id, { category: 'bug', priority: 'high', draft: 'Try X.' });
    const got = (await getTicket(e, t.id))!;
    expect(got.category).toBe('bug');
    expect(got.priority).toBe('high');
    expect(got.ai_draft).toBe('Try X.');
    // Draft stored, but no staff/ai message was appended to the thread.
    expect(await getThread(e, t.id)).toHaveLength(1);
  });
});

describe('listing + scope', () => {
  it('scopes by workspace, requester, status, and lists all for super-admin', async () => {
    const a = await createTicket(e, { workspaceId: 'wsp_a', requesterUserId: 'usr_1', channel: 'ui', subject: 'A', body: 'x' });
    await createTicket(e, { workspaceId: 'wsp_b', requesterUserId: 'usr_2', channel: 'ui', subject: 'B', body: 'y' });
    const personal = await createTicket(e, { workspaceId: null, requesterUserId: 'usr_1', channel: 'ui', subject: 'P', body: 'z' });

    expect((await listForWorkspace(e, 'wsp_a')).map((t) => t.id)).toEqual([a.id]);
    expect((await listForWorkspace(e, null)).map((t) => t.id)).toEqual([personal.id]);
    expect((await listAll(e)).length).toBe(3);
    expect((await listForRequester(e, 'usr_1')).length).toBe(2);

    await setStatus(e, a.id, 'closed');
    expect((await listForWorkspace(e, 'wsp_a', { status: 'open' })).length).toBe(0);
    expect((await listAll(e, { status: 'closed' })).map((t) => t.id)).toEqual([a.id]);
  });
});

describe('email threading + auto-close', () => {
  it('finds the latest open email ticket for a sender', async () => {
    await createTicket(e, { requesterEmail: 'a@x.com', channel: 'email', channelRef: 'a@x.com', subject: 'one', body: 'x' });
    const second = await createTicket(e, { requesterEmail: 'a@x.com', channel: 'email', channelRef: 'a@x.com', subject: 'two', body: 'y' });
    const found = await findLatestOpenTicketByEmail(e, 'a@x.com');
    expect(found?.id).toBe(second.id);
    await setStatus(e, second.id, 'closed');
    // first is still open → returned now
    const next = await findLatestOpenTicketByEmail(e, 'a@x.com');
    expect(next?.subject).toBe('one');
  });

  it('auto-closes resolved tickets idle past the window', async () => {
    const t = await createTicket(e, { workspaceId: 'wsp_1', channel: 'ui', subject: 'old', body: 'x' });
    await setStatus(e, t.id, 'resolved');
    // backdate last_msg_at to 10 days ago
    await e.DB.prepare('UPDATE tickets SET last_msg_at = ? WHERE id = ?').bind(Date.now() - 10 * 86400000, t.id).run();
    const fresh = await createTicket(e, { workspaceId: 'wsp_1', channel: 'ui', subject: 'new', body: 'x' });
    await setStatus(e, fresh.id, 'resolved');
    const closed = await autoCloseIdleTickets(e, 7);
    expect(closed).toBe(1);
    expect((await getTicket(e, t.id))!.status).toBe('closed');
    expect((await getTicket(e, fresh.id))!.status).toBe('resolved');
  });
});
