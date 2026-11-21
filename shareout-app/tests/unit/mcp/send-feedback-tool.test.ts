// send_feedback over MCP: an idea, feedback or question for the team becomes a ticket
// in the instance admins' queue, tagged with its kind, low severity, and capped per hour.
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/support/triage', () => ({ triageTicket: async () => null }));
const limitMock = vi.fn(async () => ({ allowed: true }));
vi.mock('../../../src/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/rate-limit')>()),
  checkSendFeedbackLimit: (...a: unknown[]) => limitMock(...a),
}));

import { callTool, listTools, SERVER_INSTRUCTIONS } from '../../../src/mcp/tools';
import { getThread, getTicket } from '../../../src/support/store';
import { createSchema, e, personalToken, resetData } from './setup';
import type { Env } from '../../../src/types';

const base = env as unknown as Env;

beforeAll(async () => {
  await createSchema();
  await base.DB.exec(`CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, workspace_id TEXT, requester_user_id TEXT, requester_email TEXT, channel TEXT NOT NULL, channel_ref TEXT, subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', priority TEXT, category TEXT, assignee_user_id TEXT, ai_draft TEXT, ai_meta_json TEXT, sla_due INTEGER, severity TEXT, request_id TEXT, page_url TEXT, artifact_id TEXT, user_agent TEXT, client TEXT, idempotency_key TEXT, locale TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_msg_at TEXT NOT NULL)`);
  await base.DB.exec(`CREATE TABLE IF NOT EXISTS ticket_messages (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)`);
});

let ctx: { env: Env; user: { id: string; email: string; username: null }; origin: string; authorization: string };

beforeEach(async () => {
  limitMock.mockReset();
  limitMock.mockResolvedValue({ allowed: true });
  await resetData();
  await base.DB.exec('DELETE FROM ticket_messages');
  await base.DB.exec('DELETE FROM tickets');
  ctx = { env: e, user: { id: 'usr_1', email: 'ana@example.com', username: null }, origin: 'https://shareout.test', authorization: `Bearer ${await personalToken()}` };
});

describe('send_feedback', () => {
  it('is listed, and the server instructions invite it near the top', () => {
    expect(listTools().map((t) => t.name)).toContain('send_feedback');
    const at = SERVER_INSTRUCTIONS.indexOf('send_feedback');
    expect(at).toBeGreaterThan(-1);
    // Before any publishing guidance, so a client that truncates the instructions still shows it.
    expect(at).toBeLessThan(SERVER_INSTRUCTIONS.indexOf('publish_artifact'));
    expect(SERVER_INSTRUCTIONS).toMatch(/No need to ask first/);
    expect(SERVER_INSTRUCTIONS).toMatch(/no personal or customer data/);
  });

  it('get_help tells the person they can send ideas and feedback', async () => {
    const r = (await callTool(ctx, 'get_help', {}))!;
    expect(r.content[0].text).toMatch(/idea or feedback for ShareOut/);
  });

  it('files a feature request in the queue with its kind, the app it came from and the page', async () => {
    const r = (await callTool(ctx, 'send_feedback', {
      kind: 'feature_request', summary: 'Export a page to PDF', details: 'The person sends reports to a client by email.',
      artifact_id: 'art_1', language: 'es',
    }))!;
    expect(r.isError).toBeFalsy();
    const id = (r.structuredContent as { ticket_id: string }).ticket_id;
    expect(r.content[0].text).toContain(id);
    expect(await getTicket(e, id)).toMatchObject({
      category: 'feature_request', severity: 'low', client: 'mcp', channel: 'skill', channel_ref: 'mcp:Claude',
      requester_user_id: 'usr_1', requester_email: 'ana@example.com', artifact_id: 'art_1', locale: 'es',
      subject: 'Export a page to PDF', status: 'open', workspace_id: null,
    });
    const body = (await getThread(e, id))[0].body;
    expect(body).toContain('sends reports to a client');
    expect(body).toContain('Page: art_1');
    expect(body).toContain('Sent from: Claude (MCP connector)');
  });

  it('takes feedback and questions too, and refuses anything else', async () => {
    for (const kind of ['feedback', 'question']) {
      const r = (await callTool(ctx, 'send_feedback', { kind, summary: 'x' }))!;
      expect(r.isError).toBeFalsy();
    }
    const bad = (await callTool(ctx, 'send_feedback', { kind: 'bug', summary: 'x' }))!;
    expect(bad.isError).toBe(true);
    const empty = (await callTool(ctx, 'send_feedback', { kind: 'feedback', summary: '  ' }))!;
    expect(empty.isError).toBe(true);
    const n = await base.DB.prepare('SELECT COUNT(*) AS n FROM tickets').first<{ n: number }>();
    expect(n!.n).toBe(2);
  });

  it('stops at the hourly cap without opening a ticket', async () => {
    limitMock.mockResolvedValue({ allowed: false });
    const r = (await callTool(ctx, 'send_feedback', { kind: 'feedback', summary: 'again' }))!;
    expect(r.isError).toBe(true);
    expect(limitMock).toHaveBeenCalledWith(e, 'usr_1');
    const n = await base.DB.prepare('SELECT COUNT(*) AS n FROM tickets').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});
