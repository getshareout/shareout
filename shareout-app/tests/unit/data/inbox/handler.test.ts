// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataContext } from '../../../../src/data/middleware';
import type { Env } from '../../../../src/types';

const verifyOwner = vi.hoisted(() => vi.fn());
const getInboxStatus = vi.hoisted(() => vi.fn());
const enableInbound = vi.hoisted(() => vi.fn());
const disableInbound = vi.hoisted(() => vi.fn());
const setInboundAllowlist = vi.hoisted(() => vi.fn());
const listInboxMessages = vi.hoisted(() => vi.fn());
const getInboxMessage = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/data/middleware', async (orig) => {
  const actual = await orig<typeof import('../../../../src/data/middleware')>();
  return { ...actual, verifyOwner };
});

vi.mock('../../../../src/email/inbox-store', () => ({
  getInboxStatus, enableInbound, disableInbound, setInboundAllowlist, listInboxMessages, getInboxMessage,
}));

import { handleInbox } from '../../../../src/data/inbox/handler';

const ARTIFACT_ID = 'art_inbox';

function makeCtx(): DataContext {
  return {
    artifactId: ARTIFACT_ID,
    workspaceId: 'ws_1',
    artifact: { id: ARTIFACT_ID, name: 'Inbox', visibility: 'private', auth_method: null, workspace_id: 'ws_1' },
    db: {} as DataContext['db'],
    env: {} as Env,
    origin: null,
  };
}

function req(method: string, body?: unknown): Request {
  return new Request(`https://x/v1/data/${ARTIFACT_ID}/inbox`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => vi.clearAllMocks());

describe('handleInbox', () => {
  it('returns status without auth', async () => {
    getInboxStatus.mockResolvedValue({ enabled: true, address: 'expensas@inbox.shareout.site', allowlist: null, receivedToday: 2 });
    const res = await handleInbox(req('GET'), makeCtx(), '/status');
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { enabled: boolean; address: string } };
    expect(json.data.enabled).toBe(true);
    expect(json.data.address).toBe('expensas@inbox.shareout.site');
  });

  it('enables inbound for an owner', async () => {
    verifyOwner.mockResolvedValue(true);
    getInboxStatus.mockResolvedValue({ enabled: true, address: 'q@inbox.shareout.site', allowlist: null, receivedToday: 0 });
    const res = await handleInbox(req('POST', { allowlist: ['@trusted.com'] }), makeCtx(), '/enable');
    expect(res.status).toBe(200);
    expect(enableInbound).toHaveBeenCalledWith(expect.anything(), ARTIFACT_ID);
    expect(setInboundAllowlist).toHaveBeenCalledWith(expect.anything(), ARTIFACT_ID, ['@trusted.com']);
  });

  it('forbids enable for non-owner', async () => {
    verifyOwner.mockResolvedValue(false);
    const res = await handleInbox(req('POST'), makeCtx(), '/enable');
    expect(res.status).toBe(403);
    expect(enableInbound).not.toHaveBeenCalled();
  });

  it('disables inbound for an owner', async () => {
    verifyOwner.mockResolvedValue(true);
    const res = await handleInbox(req('POST'), makeCtx(), '/disable');
    expect(res.status).toBe(200);
    expect(disableInbound).toHaveBeenCalledWith(expect.anything(), ARTIFACT_ID);
  });

  it('lists messages with previews (no full body)', async () => {
    listInboxMessages.mockResolvedValue([
      {
        id: 'inb_1', message_id: 'm1', from_addr: 'a@b.com', to_addr: 'expensas@inbox.shareout.site',
        tag: 'enero', subject: 'Hi', text_body: 'long body here', html_body: '<p>hi</p>',
        spf: 'pass', dkim: 'pass', dmarc: 'pass', attachments_json: '[]', size_bytes: 10, received_at: 100,
      },
    ]);
    const res = await handleInbox(req('GET'), makeCtx(), '/messages');
    const json = await res.json() as { data: { messages: { textPreview?: string; text?: string }[] } };
    expect(json.data.messages).toHaveLength(1);
    expect(json.data.messages[0].textPreview).toBe('long body here');
    expect(json.data.messages[0].text).toBeUndefined();
  });

  it('returns full body on get', async () => {
    getInboxMessage.mockResolvedValue({
      id: 'inb_1', message_id: 'm1', from_addr: 'a@b.com', to_addr: 'expensas@inbox.shareout.site',
      tag: null, subject: 'Hi', text_body: 'full body', html_body: '<p>hi</p>',
      spf: 'pass', dkim: 'pass', dmarc: 'pass',
      attachments_json: JSON.stringify([{ filename: 'f.pdf', contentType: 'application/pdf', size: 5, r2Key: 'k' }]),
      size_bytes: 10, received_at: 100,
    });
    const res = await handleInbox(req('GET'), makeCtx(), '/messages/inb_1');
    const json = await res.json() as { data: { text: string; attachments: { filename: string; index: number }[] } };
    expect(json.data.text).toBe('full body');
    expect(json.data.attachments[0]).toMatchObject({ filename: 'f.pdf', index: 0 });
  });

  it('404s an unknown message', async () => {
    getInboxMessage.mockResolvedValue(null);
    const res = await handleInbox(req('GET'), makeCtx(), '/messages/nope');
    expect(res.status).toBe(404);
  });
});
