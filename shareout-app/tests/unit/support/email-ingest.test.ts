import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/support/triage', () => ({ triageTicket: vi.fn(async () => null) }));
vi.mock('../../../src/superadmin/recipients', async (orig) => {
  const actual = await orig<typeof import('../../../src/superadmin/recipients')>();
  return { ...actual, notifySuperadmins: vi.fn(async () => true) };
});

import { ingestSupportEmail } from '../../../src/support/email-ingest';
import { getTicket, getThread } from '../../../src/support/store';
import type { Env } from '../../../src/types';

const e = env as unknown as Env;

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, workspace_id TEXT, requester_user_id TEXT, requester_email TEXT, channel TEXT NOT NULL, channel_ref TEXT, subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', priority TEXT, category TEXT, assignee_user_id TEXT, ai_draft TEXT, ai_meta_json TEXT, sla_due INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_msg_at INTEGER NOT NULL)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS ticket_messages (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)`);
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM ticket_messages');
  await e.DB.exec('DELETE FROM tickets');
});

describe('ingestSupportEmail', () => {
  it('opens a new email ticket, then threads the next mail from the same sender', async () => {
    const first = await ingestSupportEmail(e, { from: 'User@Co.com', subject: 'Help me', body: 'broken' });
    expect(first.threaded).toBe(false);
    const t = (await getTicket(e, first.ticketId))!;
    expect(t.channel).toBe('email');
    expect(t.requester_email).toBe('user@co.com'); // normalized lowercase
    expect(t.subject).toBe('Help me');

    const second = await ingestSupportEmail(e, { from: 'user@co.com', subject: 'Re: Help me', body: 'still broken' });
    expect(second.threaded).toBe(true);
    expect(second.ticketId).toBe(first.ticketId);
    expect(await getThread(e, first.ticketId)).toHaveLength(2);
  });

  it('falls back to a placeholder body and default subject', async () => {
    const r = await ingestSupportEmail(e, { from: 'a@b.com', subject: '', body: '' });
    const t = (await getTicket(e, r.ticketId))!;
    expect(t.subject).toBe('Support request');
    expect((await getThread(e, r.ticketId))[0].body).toBe('(no message body)');
  });
});
