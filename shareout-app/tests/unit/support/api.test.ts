import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';

let CURRENT_USER: { id: string; email: string | null } | null = { id: 'usr_req', email: 'req@example.com' };
vi.mock('../../../src/router/helpers/auth-guard', () => ({
  isAuthUser: (r: unknown) => !(r instanceof Response),
  getTokenOrSessionUser: async () => CURRENT_USER,
  requireTokenOrSession: async () => CURRENT_USER ?? new Response('no', { status: 401 }),
}));

let SUPERADMINS = new Set<string>();
vi.mock('../../../src/superadmin/recipients', async (orig) => {
  const actual = await orig<typeof import('../../../src/superadmin/recipients')>();
  return {
    ...actual,
    isSuperAdminEmail: (e: string | null) => !!e && SUPERADMINS.has(e),
    notifySuperadmins: vi.fn(async () => true),
  };
});

let WS_ROLE: string | null = null;
vi.mock('../../../src/workspaces/roles', () => ({ getWorkspaceRole: async () => WS_ROLE, getInternalWorkspaceRole: async () => WS_ROLE }));

const triageMock = vi.fn(async () => ({ category: 'bug', priority: 'high', draft: 'd' }));
vi.mock('../../../src/support/triage', () => ({ triageTicket: (...a: unknown[]) => triageMock(...a) }));

const deliverMock = vi.fn(async () => ({ delivered: true, via: 'ui' }));
vi.mock('../../../src/support/deliver', () => ({ deliverReply: (...a: unknown[]) => deliverMock(...a) }));

import { routeSupportApi } from '../../../src/router/api/support';
import { getTicket } from '../../../src/support/store';
import type { Env } from '../../../src/types';

const e = env as unknown as Env;

function ctx(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, envOverride?: Partial<Env>) {
  const req = new Request(`https://shareout.site${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const waited: Promise<unknown>[] = [];
  const url = new URL(req.url);
  return {
    request: req, env: { ...e, ...envOverride } as Env, url, path: url.pathname, hostname: 'shareout.site',
    addCORS: (r: Response) => r,
    executionCtx: { waitUntil: (p: Promise<unknown>) => { waited.push(p); }, passThroughOnException() {} },
  } as never;
}

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, workspace_id TEXT, requester_user_id TEXT, requester_email TEXT, channel TEXT NOT NULL, channel_ref TEXT, subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', priority TEXT, category TEXT, assignee_user_id TEXT, ai_draft TEXT, ai_meta_json TEXT, sla_due INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_msg_at INTEGER NOT NULL)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS ticket_messages (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)`);
});

beforeEach(async () => {
  CURRENT_USER = { id: 'usr_req', email: 'req@example.com' };
  SUPERADMINS = new Set();
  WS_ROLE = null;
  triageMock.mockClear();
  deliverMock.mockClear();
  await e.DB.exec('DELETE FROM ticket_messages');
  await e.DB.exec('DELETE FROM tickets');
});

async function createOne(extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await routeSupportApi(ctx('POST', '/v1/support/tickets', { subject: 'Help', body: 'broken', ...extra }, headers))!;
  return (await res!.json()) as { ticket: { id: string; channel: string } };
}

describe('create', () => {
  it('creates a ui ticket, schedules triage + alert', async () => {
    const res = await routeSupportApi(ctx('POST', '/v1/support/tickets', { subject: 'Help', body: 'broken' }))!;
    expect(res!.status).toBe(201);
    const { ticket } = await res!.json() as { ticket: { id: string; channel: string } };
    expect(ticket.channel).toBe('ui');
    expect(triageMock).toHaveBeenCalledWith(e, ticket.id);
  });

  it('token caller is tagged channel=skill', async () => {
    const { ticket } = await createOne({}, { authorization: 'Bearer sot_x' });
    expect(ticket.channel).toBe('skill');
  });

  it('rejects missing fields', async () => {
    const res = await routeSupportApi(ctx('POST', '/v1/support/tickets', { subject: 'x' }))!;
    expect(res!.status).toBe(400);
  });
});

describe('email-gateway ingest', () => {
  it('rejects without the shared secret', async () => {
    const res = await routeSupportApi(ctx('POST', '/v1/support/ingest/email', { from: 'x@y.com', subject: 's', body: 'b' }, {}, { SUPPORT_INGEST_KEY: 'sekret' }))!;
    expect(res!.status).toBe(403);
  });

  it('creates an email ticket with a valid secret (no session needed)', async () => {
    CURRENT_USER = null; // gateway is unauthenticated
    const res = await routeSupportApi(ctx('POST', '/v1/support/ingest/email', { from: 'x@y.com', subject: 's', body: 'b' }, { 'x-support-ingest-key': 'sekret' }, { SUPPORT_INGEST_KEY: 'sekret' }))!;
    expect(res!.status).toBe(200);
    const j = await res!.json() as { success: boolean; ticketId: string; threaded: boolean };
    expect(j.success).toBe(true);
    expect(j.threaded).toBe(false);
  });
});

describe('list scopes', () => {
  it('mine returns own; all is super-admin only', async () => {
    await createOne();
    const mine = await (await routeSupportApi(ctx('GET', '/v1/support/tickets?scope=mine'))!)!.json() as { tickets: unknown[] };
    expect(mine.tickets).toHaveLength(1);

    const denied = await routeSupportApi(ctx('GET', '/v1/support/tickets?scope=all'))!;
    expect(denied!.status).toBe(403);

    SUPERADMINS = new Set(['req@example.com']);
    const all = await routeSupportApi(ctx('GET', '/v1/support/tickets?scope=all'))!;
    expect(all!.status).toBe(200);
  });
});

describe('item access + staff actions', () => {
  it('requester sees own ticket; stranger forbidden', async () => {
    const { ticket } = await createOne();
    const ok = await routeSupportApi(ctx('GET', `/v1/support/tickets/${ticket.id}`))!;
    expect(ok!.status).toBe(200);

    CURRENT_USER = { id: 'usr_other', email: 'other@example.com' };
    const no = await routeSupportApi(ctx('GET', `/v1/support/tickets/${ticket.id}`))!;
    expect(no!.status).toBe(403);
  });

  it('non-staff cannot reply; super-admin reply delivers', async () => {
    const { ticket } = await createOne();
    const denied = await routeSupportApi(ctx('POST', `/v1/support/tickets/${ticket.id}/reply`, { body: 'hi' }))!;
    expect(denied!.status).toBe(403); // requester is not staff

    SUPERADMINS = new Set(['admin@shareout.site']);
    CURRENT_USER = { id: 'usr_admin', email: 'admin@shareout.site' };
    const ok = await routeSupportApi(ctx('POST', `/v1/support/tickets/${ticket.id}/reply`, { body: 'fixed it' }))!;
    expect(ok!.status).toBe(200);
    expect(deliverMock).toHaveBeenCalled();
  });

  it('workspace admin is staff for that workspace ticket; sets status', async () => {
    const { ticket } = await createOne({ workspaceId: 'wsp_1' });
    CURRENT_USER = { id: 'usr_admin', email: 'admin@co.com' };
    WS_ROLE = 'admin';
    const res = await routeSupportApi(ctx('POST', `/v1/support/tickets/${ticket.id}/status`, { status: 'resolved' }))!;
    expect(res!.status).toBe(200);
    expect((await getTicket(e, ticket.id))!.status).toBe('resolved');
  });

  it('requester message appends as customer and reopens', async () => {
    const { ticket } = await createOne();
    await routeSupportApi(ctx('POST', `/v1/support/tickets/${ticket.id}/message`, { body: 'still broken' }))!;
    const got = await (await routeSupportApi(ctx('GET', `/v1/support/tickets/${ticket.id}`))!)!.json() as { thread: unknown[] };
    expect(got.thread).toHaveLength(2);
  });
});
