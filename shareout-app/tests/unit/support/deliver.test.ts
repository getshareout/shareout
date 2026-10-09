import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';

const dispatchMock = vi.fn(async () => ({ sent: true }));
vi.mock('../../../src/email/gateway', () => ({ dispatchLifecycleEmail: (...a: unknown[]) => dispatchMock(...a) }));

import { deliverReply } from '../../../src/support/deliver';
import { createTicket, getThread } from '../../../src/support/store';
import { EMAILS } from '../../../src/email/catalog';
import type { Env } from '../../../src/types';

const e = env as unknown as Env;

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, workspace_id TEXT, requester_user_id TEXT, requester_email TEXT, channel TEXT NOT NULL, channel_ref TEXT, subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', priority TEXT, category TEXT, assignee_user_id TEXT, ai_draft TEXT, ai_meta_json TEXT, sla_due INTEGER, severity TEXT, request_id TEXT, page_url TEXT, artifact_id TEXT, user_agent TEXT, client TEXT, idempotency_key TEXT, locale TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_msg_at TEXT NOT NULL)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS ticket_messages (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, recipient_type TEXT NOT NULL, recipient_id TEXT NOT NULL, kind TEXT NOT NULL, subject_type TEXT, subject_id TEXT, message TEXT, payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
});

beforeEach(async () => {
  dispatchMock.mockClear();
  await e.DB.exec('DELETE FROM ticket_messages');
  await e.DB.exec('DELETE FROM tickets');
  await e.DB.exec('DELETE FROM notifications');
});

describe('deliverReply', () => {
  it('emails an in-app requester in their language and rings their bell', async () => {
    const t = await createTicket(e, { requesterUserId: 'usr_1', requesterEmail: 'a@b.com', channel: 'ui', subject: 'Help', body: 'x', locale: 'es' });
    const res = await deliverReply(e, t, 'Listo, ya está.');
    expect(res).toEqual({ delivered: true, via: 'ui', error: undefined });
    expect(dispatchMock).toHaveBeenCalledWith(e, expect.objectContaining({
      type: 'support_reply', toUserId: 'usr_1', toEmail: 'a@b.com',
      data: expect.objectContaining({ subject: 'Help', body: 'Listo, ya está.', locale: 'es', ticketUrl: expect.stringContaining('/home#help') }),
    }));
    const bell = await e.DB.prepare(`SELECT * FROM notifications WHERE kind = 'support_reply'`).all<{ recipient_id: string; subject_id: string; message: string }>();
    expect(bell.results).toEqual([expect.objectContaining({ recipient_id: 'usr_1', subject_id: t.id, message: 'Help' })]);
    expect((await getThread(e, t.id)).map((m) => m.author)).toEqual(['customer', 'staff']);
  });

  it('records the reply but reports it undelivered when nobody can be reached', async () => {
    const t = await createTicket(e, { channel: 'skill', subject: 'Help', body: 'x' });
    const res = await deliverReply(e, t, 'hi');
    expect(res.delivered).toBe(false);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(await getThread(e, t.id)).toHaveLength(2);
  });
});

describe('support_reply email copy', () => {
  const build = EMAILS.support_reply.build!;
  const ctx = { env: e, baseUrl: 'https://x' };

  it('writes Spanish with voseo and points in-app requesters at the Help panel', () => {
    const out = build({ subject: 'Ayuda', body: 'Hola', ticketUrl: 'https://x/home#help', locale: 'es' }, ctx);
    expect(out.heading).toBe('Respuesta del soporte de ShareOut');
    expect(out.cta?.label).toBe('Ver tu consulta');
    expect(out.footerNote).toContain('abrí');
  });

  it('defaults to English and keeps reply-by-email for email tickets', () => {
    const out = build({ subject: 'Help', body: 'Hi' }, ctx);
    expect(out.heading).toBe('Reply from ShareOut support');
    expect(out.cta).toBeUndefined();
    expect(out.footerNote).toBe('Reply to this email to continue the conversation.');
  });
});
