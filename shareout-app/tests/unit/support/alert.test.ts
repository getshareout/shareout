import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';

const sendMock = vi.fn(async () => undefined);
vi.mock('../../../src/telegram/client', () => ({ sendMessage: (...a: unknown[]) => sendMock(...a) }));
vi.mock('../../../src/support/triage', () => ({ triageTicket: async () => null }));

import { alertOperator } from '../../../src/support/alert';
import { openTicket } from '../../../src/support/intake';
import { createTicket } from '../../../src/support/store';
import type { Env } from '../../../src/types';

const base = env as unknown as Env;
const on = { ...base, TELEGRAM_BOT_TOKEN: 'bot', SUPPORT_ALERT_TELEGRAM_CHAT_ID: '12345' } as Env;

beforeAll(async () => {
  await base.DB.exec(`CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, workspace_id TEXT, requester_user_id TEXT, requester_email TEXT, channel TEXT NOT NULL, channel_ref TEXT, subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', priority TEXT, category TEXT, assignee_user_id TEXT, ai_draft TEXT, ai_meta_json TEXT, sla_due INTEGER, severity TEXT, request_id TEXT, page_url TEXT, artifact_id TEXT, user_agent TEXT, client TEXT, idempotency_key TEXT, locale TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_msg_at TEXT NOT NULL)`);
  await base.DB.exec(`CREATE TABLE IF NOT EXISTS ticket_messages (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)`);
});

beforeEach(async () => {
  sendMock.mockReset();
  await base.DB.exec('DELETE FROM ticket_messages');
  await base.DB.exec('DELETE FROM tickets');
});

describe('alertOperator', () => {
  it('pings the configured chat with who, where and what', async () => {
    const t = await createTicket(base, { workspaceId: 'ws_1', requesterEmail: 'a@b.com', channel: 'skill', client: 'api', severity: 'blocker', subject: 'Publish 403', body: 'error code: 1010' });
    expect(await alertOperator(on, t, 'error code: 1010')).toBe(true);
    expect(sendMock).toHaveBeenCalledWith(on, 12345, expect.stringContaining(t.id));
    const text = sendMock.mock.calls[0][2] as string;
    expect(text).toContain('Publish 403');
    expect(text).toContain('a@b.com');
    expect(text).toContain('ws_1');
    expect(text).toContain('Severity: blocker');
    expect(text).toContain('error code: 1010');
  });

  it('does nothing when the instance has no alert chat configured', async () => {
    const t = await createTicket(base, { channel: 'skill', subject: 'x', body: 'y' });
    expect(await alertOperator({ ...base, TELEGRAM_BOT_TOKEN: 'bot' } as Env, t, 'y')).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('never throws when Telegram fails', async () => {
    sendMock.mockRejectedValueOnce(new Error('down'));
    const t = await createTicket(base, { channel: 'skill', subject: 'x', body: 'y' });
    expect(await alertOperator(on, t, 'y')).toBe(false);
  });

  it('fires for tickets opened through the shared intake (MCP, bots, email)', async () => {
    const t = await openTicket(on, { requesterEmail: 'c@d.com', channel: 'skill', client: 'mcp', subject: 'Blocked', body: 'details' });
    expect(sendMock).toHaveBeenCalledWith(on, 12345, expect.stringContaining(t.id));
  });
});
