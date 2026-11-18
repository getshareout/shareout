// A short inbox address ("ventas.k7m4p2@inbox…") next to the long slug one. Real D1 (migrated
// schema) and the real inbound handler; only the session lookup and outbound mail are stubbed.
// Hard rules: every long address keeps working; a short one is unique, unguessable, never handed to
// a second page; the sender rules of the long address apply to it exactly.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

const getSessionUser = vi.hoisted(() => vi.fn());
const dispatchLifecycleEmail = vi.hoisted(() => vi.fn(async () => ({ sent: true })));
vi.mock('../../../src/auth/session', async (orig) => ({ ...(await orig<object>()), getSessionUser }));
vi.mock('../../../src/email/gateway', async (orig) => ({ ...(await orig<object>()), dispatchLifecycleEmail }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { SENDER_NOT_PERMITTED_BOUNCE, handleInboundEmail } from '../../../src/email/inbound';
import { ensureShortPrefix, getInboxStatus, resolveArtifactByPrefix } from '../../../src/email/inbox-store';
import { SHORT_INBOX_PREFIX, inboxAddress, newShortPrefix, shortInboxWord } from '../../../src/scheduling/email';
import { createJob } from '../../../src/scheduling/jobs/crud';
import { routeEmailSyncApi } from '../../../src/router/api/email-sync';
import { createFetchContext } from '../../../src/router/context';

const OWNER = 'usr_sia_owner';
const OTHER = 'usr_sia_other';
const WS = 'wsp_sia';
const WS2 = 'wsp_sia_other';
const ART = 'art_sia';
const OLD = 'art_sia_old';
const GONE = 'art_sia_gone';
const SENDER = 'ana@acme.test';
const CF_PASS = 'mx.cloudflare.net; dkim=pass header.d=acme.test; dmarc=pass header.from=acme.test';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let seq = 0;

function book(rows: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Hoja');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/.{76}/g, '$&\r\n');

function mail(to: string, opts: { from?: string; auth?: string; rows?: unknown[][] } = {}) {
  const from = opts.from ?? SENDER;
  const id = `sia${++seq}@acme.test`;
  const bytes = book(opts.rows ?? [['Producto', 'Unidades'], ['Café', 10]]);
  const raw = `From: Ana <${from}>\r\nTo: ${to}\r\nSubject: x\r\nMessage-ID: <${id}>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nva\r\n--b\r\nContent-Type: ${XLSX_MIME}; name="v.xlsx"\r\nContent-Disposition: attachment; filename="v.xlsx"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(bytes)}\r\n--b--\r\n`;
  return {
    to, from, rawSize: raw.length, raw: new Response(raw).body!, setReject: vi.fn(),
    headers: new Headers({ 'authentication-results': opts.auth ?? CF_PASS, 'message-id': `<${id}>` }),
  };
}
const send = async (m: ReturnType<typeof mail>) => { await handleInboundEmail(m as never, e, {} as ExecutionContext); return m; };
const rowsOf = async (artifactId: string) => {
  const row = await e.DB.prepare("SELECT r2_key FROM datasets WHERE artifact_id = ? AND name = 'ventas'").bind(artifactId).first<{ r2_key: string }>();
  return row ? JSON.parse(await (await e.ARTIFACTS.get(row.r2_key))!.text()) : null;
};
const longPrefix = async (artifactId: string) =>
  (await e.DB.prepare('SELECT email_prefix FROM artifact_emails WHERE artifact_id = ?').bind(artifactId).first<{ email_prefix: string }>())!.email_prefix;
const api = (artifactId: string, method = 'GET', body?: unknown, sub = '') => routeEmailSyncApi(createFetchContext(new Request(`https://shareout.test/v1/artifacts/${artifactId}/email-sync${sub}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}), e));

let short = '';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    ...[OWNER, OTHER].map((u) => e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(u, `${u}@sia.test`, u)),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'SIA', 'sia-ws', OWNER),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS2, 'Other', 'sia-other', OTHER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_sia', ?, ?, 'owner')").bind(WS, OWNER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_sia2', ?, ?, 'owner')").bind(WS2, OTHER),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'Ventas', 'ventas-del-mes-noviembre-2026', ?, ?, 'private')").bind(ART, OWNER, WS),
    // An inbox turned on before short addresses existed: a long prefix and nothing else.
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'Old', 'sia-old-page', ?, ?, 'private')").bind(OLD, OWNER, WS),
    e.DB.prepare("INSERT INTO artifact_emails (artifact_id, email_prefix, owner_id, inbound_enabled, inbound_allowlist) VALUES (?, 'sia-old-page', ?, 1, ?)").bind(OLD, OWNER, JSON.stringify([SENDER])),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'Gone', 'sia-gone', ?, ?, 'private')").bind(GONE, OTHER, WS2),
  ]);
  getSessionUser.mockResolvedValue({ id: OWNER, email: `${OWNER}@sia.test` });
  const res = await api(ART, 'PUT', { senders: [SENDER] }, '/senders');
  expect(res?.status).toBe(200);
  const { address } = (await res!.json()) as { address: string };
  short = address.slice(0, address.indexOf('@'));
  const { error } = await createJob(e, OWNER, {
    artifact_id: ART, action: 'email_sheet_sync', trigger_type: 'event', event_type: 'email.received', config: { dataset: 'ventas' }, title: 'x',
  });
  expect(error).toBeUndefined();
});

describe('the short address', () => {
  it('is what turning the inbox on hands out: the slug’s first word, a dot, six unambiguous characters', async () => {
    expect(short).toMatch(/^ventas\.[2-9a-hjkmnp-z]{6}$/);
    expect(short).toMatch(SHORT_INBOX_PREFIX);
    // The status, the panel and the MCP tools all read getInboxStatus.
    expect((await getInboxStatus(e, ART)).address).toBe(inboxAddress(short, e));
    const st = (await (await api(ART))!.json()) as { address: string; message: string };
    expect(st.address).toBe(inboxAddress(short, e));
    expect(st.message).toContain(inboxAddress(short, e));
    expect(st.message).not.toContain('ventas-del-mes');
  });

  it('stays the same: asked again, or the inbox turned on again, it does not change', async () => {
    expect(await ensureShortPrefix(e, ART)).toBe(short);
    await api(ART, 'PUT', { senders: [SENDER] }, '/senders');
    expect((await getInboxStatus(e, ART)).address).toBe(inboxAddress(short, e));
  });

  it('a file emailed to it updates the page, like the long address', async () => {
    const m = await send(mail(inboxAddress(short, e)));
    expect(m.setReject).not.toHaveBeenCalled();
    expect(await rowsOf(ART)).toEqual([{ Producto: 'Café', Unidades: 10 }]);
  });

  it('the sender rules apply to it exactly: not on the list, or not verified → the same plain bounce', async () => {
    const notListed = await send(mail(inboxAddress(short, e), { from: 'eve@acme.test' }));
    expect(notListed.setReject).toHaveBeenCalledWith(SENDER_NOT_PERMITTED_BOUNCE);
    const forged = await send(mail(inboxAddress(short, e), { auth: 'mx.cloudflare.net; dkim=pass header.d=evil.test; dmarc=none' }));
    expect(forged.setReject).toHaveBeenCalledWith(SENDER_NOT_PERMITTED_BOUNCE);
  });
});

describe('the long address keeps working', () => {
  it('mail to the slug address still reaches the page', async () => {
    const m = await send(mail(inboxAddress(await longPrefix(ART), e), { rows: [['Producto', 'Unidades'], ['Mate', 3]] }));
    expect(m.setReject).not.toHaveBeenCalled();
    expect(await rowsOf(ART)).toEqual([{ Producto: 'Mate', Unidades: 3 }]);
    expect((await resolveArtifactByPrefix(e, await longPrefix(ART)))?.artifactId).toBe(ART);
  });

  it('an inbox from before short addresses gets one the next time anyone looks, and its old one still resolves', async () => {
    expect((await resolveArtifactByPrefix(e, 'sia-old-page'))?.artifactId).toBe(OLD);
    const { address } = await getInboxStatus(e, OLD);
    expect(address).toMatch(/^sia\.[2-9a-hjkmnp-z]{6}@/);
    expect((await resolveArtifactByPrefix(e, address!.slice(0, address!.indexOf('@'))))?.artifactId).toBe(OLD);
    expect((await resolveArtifactByPrefix(e, 'sia-old-page'))?.artifactId).toBe(OLD);
  });
});

describe('a short address can never reach another page', () => {
  it('a made-up or malformed short address bounces as unknown', async () => {
    for (const to of ['ventas.zzzzzz', 'ventas.k7m4p2', `${short}x`, 'ventas.0o1l11', 'a.b.c']) {
      expect(await resolveArtifactByPrefix(e, to)).toBeNull();
    }
    const m = await send(mail(inboxAddress('ventas.zzzzzz', e)));
    expect(m.setReject).toHaveBeenCalledWith('Mailbox not found');
  });

  it('a dotted address never falls through to a workspace inbox', async () => {
    const m = await send(mail(inboxAddress('sia.ws2345', e)));
    expect(m.setReject).toHaveBeenCalledWith('Mailbox not found');
  });

  it('a code already taken is never handed to a second page, and a page keeps one code even when asked twice at once', async () => {
    await e.DB.prepare('INSERT INTO email_inbox_short_addresses (short_prefix, artifact_id) VALUES (?, ?)').bind('sia.taken2', GONE).run();
    const dup = await e.DB.prepare('INSERT OR IGNORE INTO email_inbox_short_addresses (short_prefix, artifact_id) VALUES (?, ?)').bind('sia.taken2', OLD).run();
    expect(dup.meta.changes).toBe(0);
    expect(await ensureShortPrefix(e, GONE)).toBe('sia.taken2');
    await e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES ('art_sia_race', 'Race', 'race-page', ?, ?, 'private')").bind(OWNER, WS).run();
    const [a, b] = await Promise.all([ensureShortPrefix(e, 'art_sia_race'), ensureShortPrefix(e, 'art_sia_race')]);
    expect(a).toMatch(/^race\./);
    expect(b).toBe(a);
    const { n } = (await e.DB.prepare("SELECT COUNT(*) AS n FROM email_inbox_short_addresses WHERE artifact_id = 'art_sia_race'").first<{ n: number }>())!;
    expect(n).toBe(1);
  });

  it('when its page is purged the address bounces for good and stays taken', async () => {
    await e.DB.prepare('INSERT INTO artifact_emails (artifact_id, email_prefix, owner_id, inbound_enabled) VALUES (?, ?, ?, 1)').bind(GONE, 'sia-gone', OTHER).run();
    expect((await resolveArtifactByPrefix(e, 'sia.taken2'))?.artifactId).toBe(GONE);
    await e.DB.prepare('DELETE FROM artifacts WHERE id = ?').bind(GONE).run();
    const row = await e.DB.prepare('SELECT artifact_id FROM email_inbox_short_addresses WHERE short_prefix = ?').bind('sia.taken2').first<{ artifact_id: string | null }>();
    expect(row).toEqual({ artifact_id: null });
    expect(await resolveArtifactByPrefix(e, 'sia.taken2')).toBeNull();
    const reuse = await e.DB.prepare('INSERT OR IGNORE INTO email_inbox_short_addresses (short_prefix, artifact_id) VALUES (?, ?)').bind('sia.taken2', ART).run();
    expect(reuse.meta.changes).toBe(0);
  });
});

describe('newShortPrefix', () => {
  it('takes the slug’s first word with a letter, cut to 12, and six characters with no look-alikes', () => {
    expect(shortInboxWord('ventas-del-mes-noviembre-2026')).toBe('ventas');
    expect(shortInboxWord('2026-presupuestoanualcompleto')).toBe('presupuestoa');
    expect(shortInboxWord('2026-11')).toBe('inbox');
    expect(shortInboxWord(null)).toBe('inbox');
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const p = newShortPrefix('ventas');
      expect(p).toMatch(SHORT_INBOX_PREFIX);
      expect(p.slice(7)).not.toMatch(/[01ilo]/);
      seen.add(p);
    }
    expect(seen.size).toBeGreaterThan(495);
  });
});
