// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/types';

const ingestBlobDirect = vi.hoisted(() => vi.fn());
const getOrCreateAssetBucket = vi.hoisted(() => vi.fn());
const getLinkedChatId = vi.hoisted(() => vi.fn());
const sendMessage = vi.hoisted(() => vi.fn());

vi.mock('../../../src/data/blobs/handler', () => ({ ingestBlobDirect }));
vi.mock('../../../src/assets/bucket', () => ({ getOrCreateAssetBucket }));
vi.mock('../../../src/telegram/linking', () => ({ getLinkedChatId }));
vi.mock('../../../src/telegram/client', () => ({ sendMessage }));
vi.mock('../../../src/crypto-utils', () => ({
  sha256: async () => 'deadbeef',
}));

import { handleWorkspaceInbound } from '../../../src/email/workspace-ingest';

const WS = { id: 'wsp_acme', slug: 'acme', name: 'Acme Co' };

function attachmentEmail(from: string, filename = 'ventas.xlsx') {
  const boundary = '----bound';
  return (
    `From: ${from}\r\n` +
    `To: acme@inbox.shareout.site\r\n` +
    `Subject: July sales\r\n` +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/plain\r\n\r\n` +
    `Here are the numbers\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="${filename}"\r\n` +
    `Content-Disposition: attachment; filename="${filename}"\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `UEsDBAoAAAAAAIdO4kgAAAAAAAAAAAAAAAAJAAAAeGwv\r\n` +
    `--${boundary}--\r\n`
  );
}

function fakeMessage(raw: string, from = 'Admin <admin@acme.com>') {
  return {
    from,
    rawSize: raw.length,
    raw: new Response(raw).body!,
    headers: new Headers({ 'authentication-results': 'spf=pass dkim=pass dmarc=pass' }),
    setReject: vi.fn(),
  };
}

function mkEnv(opts: {
  member?: { id: string } | null;
  dup?: boolean;
  priorArtifact?: string | null;
} = {}): Env {
  const runs: unknown[][] = [];
  const DB = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('workspace_members') && sql.includes('lower(u.email)')) {
            return opts.member === undefined ? { id: 'usr_admin' } : opts.member;
          }
          if (sql.includes('blob_origins') && sql.includes('email_message_id')) {
            return opts.dup ? { '1': 1 } : null;
          }
          if (sql.includes('blob_artifact_links')) {
            return opts.priorArtifact ? { name: opts.priorArtifact } : null;
          }
          return null;
        }),
        run: vi.fn(async () => { runs.push(args); return { success: true }; }),
        all: vi.fn(async () => ({ results: [{ id: 'usr_owner' }] })),
      })),
    })),
  };
  return { DB, EMAIL_INBOX_DOMAIN: 'inbox.shareout.site' } as unknown as Env;
}

beforeEach(() => {
  vi.clearAllMocks();
  getOrCreateAssetBucket.mockResolvedValue({ id: 'art_bucket' });
  ingestBlobDirect.mockResolvedValue({ ok: true, blobId: 'blob_new', mimeType: 'application/octet-stream', sizeBytes: 100 });
  getLinkedChatId.mockResolvedValue(null);
});

describe('handleWorkspaceInbound', () => {
  it('silently drops non-member senders', async () => {
    const msg = fakeMessage(attachmentEmail('stranger@evil.com'), 'Stranger <stranger@evil.com>');
    await handleWorkspaceInbound(msg as never, mkEnv({ member: null }), WS);
    expect(msg.setReject).not.toHaveBeenCalled();
    expect(ingestBlobDirect).not.toHaveBeenCalled();
  });

  it('ingests attachments and writes blob_origins for members', async () => {
    const msg = fakeMessage(attachmentEmail('admin@acme.com'));
    await handleWorkspaceInbound(msg as never, mkEnv(), WS);
    expect(ingestBlobDirect).toHaveBeenCalled();
    expect(getOrCreateAssetBucket).toHaveBeenCalledWith(expect.anything(), 'usr_admin', WS.id);
  });

  it('rejects mail that fails DMARC and DKIM', async () => {
    const raw = attachmentEmail('admin@acme.com');
    const msg = {
      ...fakeMessage(raw),
      headers: new Headers({ 'authentication-results': 'spf=pass dkim=fail dmarc=fail' }),
    };
    await handleWorkspaceInbound(msg as never, mkEnv(), WS);
    expect(msg.setReject).toHaveBeenCalledWith('Failed authentication');
    expect(ingestBlobDirect).not.toHaveBeenCalled();
  });

  it('skips duplicate message-id deliveries', async () => {
    const msg = fakeMessage(attachmentEmail('admin@acme.com'));
    await handleWorkspaceInbound(msg as never, mkEnv({ dup: true }), WS);
    expect(ingestBlobDirect).not.toHaveBeenCalled();
  });
});
