import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../src/types';

const emitJobEvent = vi.hoisted(() => vi.fn());
const resolveArtifactByPrefix = vi.hoisted(() => vi.fn());
const storeInboundMessage = vi.hoisted(() => vi.fn());
const incrementInboundCount = vi.hoisted(() => vi.fn());
const handleWorkspaceInbound = vi.hoisted(() => vi.fn());

vi.mock('../../src/scheduling/events', () => ({ emitJobEvent }));
vi.mock('../../src/crypto-utils', () => ({
  generateId: (p: string) => `${p}_test123456`,
  sha256: async () => 'deadbeef',
}));
vi.mock('../../src/email/workspace-ingest', () => ({ handleWorkspaceInbound }));

// Keep the real senderAllowed/checkInboundRateLimit logic; mock only the IO bits.
vi.mock('../../src/email/inbox-store', async (orig) => {
  const actual = await orig<typeof import('../../src/email/inbox-store')>();
  return { ...actual, resolveArtifactByPrefix, storeInboundMessage, incrementInboundCount };
});

import { handleInboundEmail, parseInboundAddress } from '../../src/email/inbound';

const INBOX_DOMAIN = 'inbox.shareout.site';

function fakeEnv(extra: Record<string, unknown> = {}): Env {
  return {
    EMAIL_INBOX_DOMAIN: INBOX_DOMAIN,
    ARTIFACTS: { put: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
    DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => {
            if (sql.includes('FROM workspaces WHERE slug')) {
              return extra.workspace ?? null;
            }
            return null;
          }),
        })),
      })),
    },
    ...extra,
  } as unknown as Env;
}

function rawEmail(opts: { from: string; subject: string; body: string; messageId?: string }): string {
  const mid = opts.messageId ? `Message-ID: <${opts.messageId}>\r\n` : '';
  return (
    `From: ${opts.from}\r\n` +
    `To: expensas@${INBOX_DOMAIN}\r\n` +
    `Subject: ${opts.subject}\r\n` +
    mid +
    `Content-Type: text/plain\r\n\r\n` +
    `${opts.body}\r\n`
  );
}

function fakeMessage(opts: {
  to?: string;
  from?: string;
  subject?: string;
  body?: string;
  messageId?: string;
  auth?: string;
  rawSize?: number;
}) {
  const from = opts.from ?? 'biller@edificio.com';
  const subject = opts.subject ?? 'Expensas Enero';
  const body = opts.body ?? 'Total: $50.000';
  const raw = rawEmail({ from, subject, body, messageId: opts.messageId });
  const headers = new Headers();
  if (opts.auth) headers.set('authentication-results', opts.auth);
  if (opts.messageId) headers.set('message-id', `<${opts.messageId}>`);
  return {
    to: opts.to ?? `expensas@${INBOX_DOMAIN}`,
    from,
    headers,
    rawSize: opts.rawSize ?? raw.length,
    raw: new Response(raw).body!,
    setReject: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storeInboundMessage.mockResolvedValue({ isNew: true });
});

describe('parseInboundAddress', () => {
  it('extracts prefix and tag with plus-addressing', () => {
    expect(parseInboundAddress('expensas+enero@inbox.shareout.site', INBOX_DOMAIN)).toEqual({
      prefix: 'expensas',
      tag: 'enero',
    });
    expect(parseInboundAddress('expensas@inbox.shareout.site', INBOX_DOMAIN)).toEqual({
      prefix: 'expensas',
      tag: null,
    });
  });

  it('rejects addresses on other domains (apex isolation)', () => {
    expect(parseInboundAddress('ceo@shareout.site', INBOX_DOMAIN)).toBeNull();
    expect(parseInboundAddress('not-an-email', INBOX_DOMAIN)).toBeNull();
  });
});

describe('handleInboundEmail', () => {
  it('rejects unknown recipient domain without storing', async () => {
    const env = fakeEnv();
    const msg = fakeMessage({ to: 'someone@shareout.site' });
    await handleInboundEmail(msg as never, env, {} as ExecutionContext);
    expect(msg.setReject).toHaveBeenCalled();
    expect(storeInboundMessage).not.toHaveBeenCalled();
    expect(emitJobEvent).not.toHaveBeenCalled();
  });

  it('rejects when the prefix is unknown', async () => {
    resolveArtifactByPrefix.mockResolvedValue(null);
    const env = fakeEnv();
    const msg = fakeMessage({});
    await handleInboundEmail(msg as never, env, {} as ExecutionContext);
    expect(msg.setReject).toHaveBeenCalledWith('Mailbox not found');
    expect(emitJobEvent).not.toHaveBeenCalled();
  });

  it('rejects when inbound is disabled', async () => {
    resolveArtifactByPrefix.mockResolvedValue({
      artifactId: 'art_1', workspaceId: 'ws_1', inboundEnabled: false,
      allowlist: null, receivedToday: 0, lastResetDate: '2026-01-01',
    });
    const env = fakeEnv();
    const msg = fakeMessage({});
    await handleInboundEmail(msg as never, env, {} as ExecutionContext);
    expect(msg.setReject).toHaveBeenCalledWith('Mailbox not found');
    expect(emitJobEvent).not.toHaveBeenCalled();
  });

  it('stores the message and fires email.received when enabled', async () => {
    resolveArtifactByPrefix.mockResolvedValue({
      artifactId: 'art_1', workspaceId: 'ws_1', inboundEnabled: true,
      allowlist: null, receivedToday: 0, lastResetDate: '2026-01-01',
    });
    const env = fakeEnv();
    const msg = fakeMessage({ to: `expensas+enero@${INBOX_DOMAIN}`, messageId: 'abc@edificio.com' });
    await handleInboundEmail(msg as never, env, {} as ExecutionContext);

    expect(msg.setReject).not.toHaveBeenCalled();
    expect(storeInboundMessage).toHaveBeenCalledTimes(1);
    expect(incrementInboundCount).toHaveBeenCalledWith(env, 'art_1');
    expect(emitJobEvent).toHaveBeenCalledTimes(1);
    const [, artifactId, eventType, payload] = emitJobEvent.mock.calls[0];
    expect(artifactId).toBe('art_1');
    expect(eventType).toBe('email.received');
    expect(payload).toMatchObject({
      prefix: 'expensas',
      tag: 'enero',
      from: 'biller@edificio.com',
      subject: 'Expensas Enero',
      rfcMessageId: 'abc@edificio.com',
    });
    expect(payload.textPreview).toContain('Total');
  });

  it('rejects oversized messages before parsing', async () => {
    resolveArtifactByPrefix.mockResolvedValue({
      artifactId: 'art_1', workspaceId: 'ws_1', inboundEnabled: true,
      allowlist: null, receivedToday: 0, lastResetDate: '2026-01-01',
    });
    const env = fakeEnv();
    const msg = fakeMessage({ rawSize: 26 * 1024 * 1024 });
    await handleInboundEmail(msg as never, env, {} as ExecutionContext);
    expect(msg.setReject).toHaveBeenCalledWith('Message too large');
    expect(emitJobEvent).not.toHaveBeenCalled();
  });

  it('rejects a sender not on the allowlist', async () => {
    resolveArtifactByPrefix.mockResolvedValue({
      artifactId: 'art_1', workspaceId: 'ws_1', inboundEnabled: true,
      allowlist: ['@trusted.com'], receivedToday: 0, lastResetDate: '2026-01-01',
    });
    const env = fakeEnv();
    const msg = fakeMessage({ from: 'spam@evil.com' });
    await handleInboundEmail(msg as never, env, {} as ExecutionContext);
    expect(msg.setReject).toHaveBeenCalledWith('Sender not permitted');
    expect(emitJobEvent).not.toHaveBeenCalled();
  });

  it('does not re-fire the event on a duplicate delivery', async () => {
    resolveArtifactByPrefix.mockResolvedValue({
      artifactId: 'art_1', workspaceId: 'ws_1', inboundEnabled: true,
      allowlist: null, receivedToday: 0, lastResetDate: '2026-01-01',
    });
    storeInboundMessage.mockResolvedValue({ isNew: false });
    const env = fakeEnv();
    const msg = fakeMessage({ messageId: 'dup@edificio.com' });
    await handleInboundEmail(msg as never, env, {} as ExecutionContext);
    expect(storeInboundMessage).toHaveBeenCalledTimes(1);
    expect(emitJobEvent).not.toHaveBeenCalled();
    expect(incrementInboundCount).not.toHaveBeenCalled();
  });

  it('routes unknown artifact prefix to workspace ingest when slug matches', async () => {
    resolveArtifactByPrefix.mockResolvedValue(null);
    const ws = { id: 'wsp_acme', slug: 'acme', name: 'Acme' };
    const env = fakeEnv({ workspace: ws });
    const msg = fakeMessage({ to: `acme@${INBOX_DOMAIN}` });
    await handleInboundEmail(msg as never, env, {} as ExecutionContext);
    expect(handleWorkspaceInbound).toHaveBeenCalledWith(msg, env, ws);
    expect(msg.setReject).not.toHaveBeenCalled();
  });

  it('artifact prefix wins over a workspace with the same slug', async () => {
    resolveArtifactByPrefix.mockResolvedValue({
      artifactId: 'art_1', workspaceId: 'ws_1', inboundEnabled: true,
      allowlist: null, receivedToday: 0, lastResetDate: '2026-01-01',
    });
    const env = fakeEnv({ workspace: { id: 'wsp_acme', slug: 'acme', name: 'Acme' } });
    const msg = fakeMessage({ to: `acme@${INBOX_DOMAIN}` });
    await handleInboundEmail(msg as never, env, {} as ExecutionContext);
    expect(handleWorkspaceInbound).not.toHaveBeenCalled();
    expect(storeInboundMessage).toHaveBeenCalled();
  });
});
