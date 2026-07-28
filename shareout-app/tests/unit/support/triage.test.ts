import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';

const streamTurnMock = vi.fn();
vi.mock('../../../src/crew/provider', async (orig) => {
  const actual = await orig<typeof import('../../../src/crew/provider')>();
  return { ...actual, getCrewProvider: () => ({ provider: 'test', model: 'test', streamTurn: streamTurnMock }) };
});

import { triageTicket } from '../../../src/support/triage';
import { createTicket, getTicket, getThread } from '../../../src/support/store';
import type { Env } from '../../../src/types';

const e = env as unknown as Env;

async function* deltas(text: string) {
  yield { type: 'text_delta' as const, text };
  yield { type: 'message_stop' as const, stopReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } };
}

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, workspace_id TEXT, requester_user_id TEXT, requester_email TEXT, channel TEXT NOT NULL, channel_ref TEXT, subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', priority TEXT, category TEXT, assignee_user_id TEXT, ai_draft TEXT, ai_meta_json TEXT, sla_due INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_msg_at INTEGER NOT NULL)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS ticket_messages (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)`);
});

beforeEach(async () => {
  streamTurnMock.mockReset();
  await e.DB.exec('DELETE FROM ticket_messages');
  await e.DB.exec('DELETE FROM tickets');
});

describe('triageTicket', () => {
  it('parses JSON, stores draft, and never appends to the thread', async () => {
    streamTurnMock.mockReturnValue(deltas('{"category":"bug","priority":"high","draft":"We are on it."}'));
    const t = await createTicket(e, { workspaceId: 'wsp_1', channel: 'ui', subject: 'Broken', body: 'It crashes.' });
    const triage = await triageTicket(e, t.id);
    expect(triage).toEqual({ category: 'bug', priority: 'high', draft: 'We are on it.' });
    const got = (await getTicket(e, t.id))!;
    expect(got.ai_draft).toBe('We are on it.');
    expect(got.status).toBe('open'); // draft only — not sent, no status change
    expect(await getThread(e, t.id)).toHaveLength(1); // no ai/staff message appended
  });

  it('tolerates code-fenced output and bad priority', async () => {
    streamTurnMock.mockReturnValue(deltas('```json\n{"category":"question","priority":"???","draft":"Hi"}\n```'));
    const t = await createTicket(e, { workspaceId: 'wsp_1', channel: 'ui', subject: 'Q', body: 'how?' });
    const triage = await triageTicket(e, t.id);
    expect(triage).toMatchObject({ category: 'question', priority: 'normal', draft: 'Hi' });
  });

  it('returns null on provider error without writing', async () => {
    streamTurnMock.mockReturnValue((async function* () { yield { type: 'error' as const, error: 'down' }; })());
    const t = await createTicket(e, { workspaceId: 'wsp_1', channel: 'ui', subject: 'Q', body: 'x' });
    expect(await triageTicket(e, t.id)).toBeNull();
    expect((await getTicket(e, t.id))!.ai_draft).toBeNull();
  });
});
