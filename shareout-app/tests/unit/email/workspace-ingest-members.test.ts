// Workspace inbox sender lookup against the real schema: only enabled internal members
// of the addressed workspace get their attachments ingested.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ingestBlobDirect = vi.hoisted(() => vi.fn());
const getOrCreateAssetBucket = vi.hoisted(() => vi.fn());
vi.mock('../../../src/data/blobs/handler', () => ({ ingestBlobDirect }));
vi.mock('../../../src/assets/bucket', () => ({ getOrCreateAssetBucket }));
vi.mock('../../../src/telegram/linking', () => ({ getLinkedChatId: vi.fn(async () => null) }));
vi.mock('../../../src/telegram/client', () => ({ sendMessage: vi.fn() }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { handleWorkspaceInbound } from '../../../src/email/workspace-ingest';

const WS = { id: 'wsp_inbox_a', slug: 'inbox-a', name: 'A' };

function message(from: string, id: string) {
  const b = '----b';
  const raw =
    `From: ${from}\r\nTo: inbox-a@inbox.shareout.test\r\nSubject: s\r\nMessage-ID: <${id}@x>\r\n` +
    `Content-Type: multipart/mixed; boundary="${b}"\r\n\r\n--${b}\r\nContent-Type: text/plain\r\n\r\nhi\r\n` +
    `--${b}\r\nContent-Type: text/csv; name="a.csv"\r\nContent-Disposition: attachment; filename="a.csv"\r\n\r\na,b\r\n--${b}--\r\n`;
  return {
    from, rawSize: raw.length, raw: new Response(raw).body!,
    headers: new Headers({ 'authentication-results': 'spf=pass dkim=pass dmarc=pass' }),
    setReject: vi.fn(),
  };
}

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare(`INSERT INTO users (id, email, name, disabled) VALUES
      ('usr_inbox_in','in@a.test','i',0),('usr_inbox_ext','ext@c.test','x',0),('usr_inbox_off','off@a.test','o',1),('usr_inbox_b','b@b.test','b',0)`),
    e.DB.prepare(`INSERT INTO workspaces (id, name, slug, owner_id) VALUES ('wsp_inbox_a','A','inbox-a','usr_inbox_in'),('wsp_inbox_b','B','inbox-b','usr_inbox_b')`),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_ib1','wsp_inbox_a','usr_inbox_in','owner','internal'),
      ('wm_ib2','wsp_inbox_a','usr_inbox_ext','member','external'),
      ('wm_ib3','wsp_inbox_a','usr_inbox_off','member','internal'),
      ('wm_ib4','wsp_inbox_b','usr_inbox_b','owner','internal')`),
  ]);
});

beforeEach(() => {
  vi.clearAllMocks();
  getOrCreateAssetBucket.mockResolvedValue({ id: 'art_inbox_bucket' });
  ingestBlobDirect.mockResolvedValue({ ok: false });
});

describe('workspace inbox sender', () => {
  it('ingests for an enabled internal member', async () => {
    await handleWorkspaceInbound(message('in@a.test', 'm1') as never, e, WS);
    expect(getOrCreateAssetBucket).toHaveBeenCalledWith(expect.anything(), 'usr_inbox_in', WS.id);
  });

  it.each([
    ['an external member', 'ext@c.test', 'm2'],
    ['a disabled member', 'off@a.test', 'm3'],
    ['a member of another workspace', 'b@b.test', 'm4'],
  ])('drops mail from %s', async (_label, from, id) => {
    await handleWorkspaceInbound(message(from, id) as never, e, WS);
    expect(getOrCreateAssetBucket).not.toHaveBeenCalled();
    expect(ingestBlobDirect).not.toHaveBeenCalled();
  });
});
