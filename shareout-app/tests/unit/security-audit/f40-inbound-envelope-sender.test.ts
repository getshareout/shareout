import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const emitJobEvent = vi.hoisted(() => vi.fn());
const resolveArtifactByPrefix = vi.hoisted(() => vi.fn());
const storeInboundMessage = vi.hoisted(() => vi.fn());
const incrementInboundCount = vi.hoisted(() => vi.fn());

vi.mock('../../../src/scheduling/events', () => ({ emitJobEvent }));
vi.mock('../../../src/crypto-utils', () => ({ generateId: (p: string) => `${p}_t`, sha256: async () => 'x' }));
vi.mock('../../../src/email/workspace-ingest', () => ({ handleWorkspaceInbound: vi.fn() }));
vi.mock('../../../src/email/inbox-store', async (orig) => {
  const actual = await orig<typeof import('../../../src/email/inbox-store')>();
  return { ...actual, resolveArtifactByPrefix, storeInboundMessage, incrementInboundCount };
});

import { handleInboundEmail } from '../../../src/email/inbound';

const env = { EMAIL_INBOX_DOMAIN: 'inbox.example.test' } as unknown as Env;

beforeEach(() => {
  vi.clearAllMocks();
  storeInboundMessage.mockResolvedValue({ isNew: true });
  resolveArtifactByPrefix.mockResolvedValue({
    artifactId: 'art_1', workspaceId: 'ws_1', inboundEnabled: true,
    allowlist: ['boss@example.test'], receivedToday: 0, lastResetDate: '2026-01-01',
  });
});

const mail = (envFrom: string, headerFrom: string, auth: string) => {
  const raw = `From: ${headerFrom}\r\nSubject: x\r\nMessage-ID: <m@a>\r\nContent-Type: text/plain\r\n\r\nhi\r\n`;
  return { to: 'a@inbox.example.test', from: envFrom, headers: new Headers({ 'authentication-results': auth }), rawSize: raw.length, raw: new Response(raw).body!, setReject: vi.fn() };
};

describe('f40 allowlist authenticates the header From', () => {
  it('blocks: allowlisted envelope sender, attacker header From with dmarc=pass', async () => {
    const msg = mail('boss@example.test', 'attacker@attacker.test', 'mx; spf=fail; dkim=pass header.d=attacker.test; dmarc=pass');
    await handleInboundEmail(msg as never, env, {} as ExecutionContext);
    expect(msg.setReject).toHaveBeenCalledWith('Sender not permitted');
    expect(emitJobEvent).not.toHaveBeenCalled();
  });

  it('blocks: allowlisted header From without dmarc=pass', async () => {
    const msg = mail('boss@example.test', 'boss@example.test', 'mx; spf=pass; dkim=pass; dmarc=none');
    await handleInboundEmail(msg as never, env, {} as ExecutionContext);
    expect(msg.setReject).toHaveBeenCalledWith('Sender not permitted');
    expect(emitJobEvent).not.toHaveBeenCalled();
  });

  it('allows: ESP-style envelope with allowlisted header From and dmarc=pass', async () => {
    const msg = mail('bounce-123@sendgrid.test', 'Boss <boss@example.test>', 'mx; spf=pass; dkim=pass; dmarc=pass');
    await handleInboundEmail(msg as never, env, {} as ExecutionContext);
    expect(msg.setReject).not.toHaveBeenCalled();
    expect(emitJobEvent).toHaveBeenCalledTimes(1);
  });
});
