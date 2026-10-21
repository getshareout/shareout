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

describe('f40 allowlist trusts the envelope sender (NEEDS DECISION)', () => {
  it('reproduces: envelope sender in allowlist is accepted although SPF failed and DKIM signed for another domain', async () => {
    const raw = 'From: attacker@attacker.test\r\nSubject: x\r\nMessage-ID: <m@a>\r\nContent-Type: text/plain\r\n\r\nhi\r\n';
    const headers = new Headers({ 'authentication-results': 'mx.example; spf=fail; dkim=pass header.d=attacker.test; dmarc=pass' });
    const msg = { to: 'a@inbox.example.test', from: 'boss@example.test', headers, rawSize: raw.length, raw: new Response(raw).body!, setReject: vi.fn() };
    await handleInboundEmail(msg as never, env, {} as ExecutionContext);
    expect(msg.setReject).not.toHaveBeenCalled();
    expect(emitJobEvent).toHaveBeenCalledTimes(1);
  });
});
