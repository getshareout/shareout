// email_sheet_sync: an Excel/CSV file emailed to the page's own address → the page's dataset.
// Real D1/R2/MiniDB, the real inbound handler and the real event dispatch; only the session lookup
// and the outbound owner email are stubbed.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

const getSessionUser = vi.hoisted(() => vi.fn());
const dispatchLifecycleEmail = vi.hoisted(() => vi.fn(async () => ({ sent: true })));
const verifyOwner = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../../src/auth/session', async (orig) => ({ ...(await orig<object>()), getSessionUser }));
vi.mock('../../../src/email/gateway', async (orig) => ({ ...(await orig<object>()), dispatchLifecycleEmail }));
vi.mock('../../../src/data/middleware', async (orig) => ({ ...(await orig<object>()), verifyOwner }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { SENDER_NOT_PERMITTED_BOUNCE, handleInboundEmail } from '../../../src/email/inbound';
import { getInboxStatus, setInboundAllowlist, storeInboundMessage } from '../../../src/email/inbox-store';
import { emailSheetSyncDestination, attachmentMatches, pickAttachment } from '../../../src/delivery/destinations/email-sheet-sync';
import { createJob } from '../../../src/scheduling/jobs/crud';
import { routeEmailSyncApi } from '../../../src/router/api/email-sync';
import { handleInbox } from '../../../src/data/inbox/handler';
import { createFetchContext } from '../../../src/router/context';
import type { DataContext } from '../../../src/data/middleware';
import type { EmailReceivedPayload } from '../../../src/types';

const OWNER = 'usr_ess_owner';
const EDITOR = 'usr_ess_editor';
const VIEWER = 'usr_ess_viewer';
const WS = 'wsp_ess';
const ART = 'art_ess';
const BARE = 'art_ess_bare';
const SENDER = 'ana@acme.test';
const CF_PASS = 'mx.cloudflare.net; dkim=pass header.d=acme.test; dmarc=pass header.from=acme.test; spf=pass smtp.mailfrom=ana@acme.test';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let address = '';
let seq = 0;

function book(tabs: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(tabs)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/.{76}/g, '$&\r\n');

/** A real MIME message as Email Routing hands it to the Worker. */
function mail(files: { name: string; type: string; bytes: Uint8Array }[], opts: { from?: string; auth?: string } = {}) {
  const from = opts.from ?? SENDER;
  const id = `m${++seq}@acme.test`;
  const parts = files.map((f) => `--b\r\nContent-Type: ${f.type}; name="${f.name}"\r\nContent-Disposition: attachment; filename="${f.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(f.bytes)}\r\n`).join('');
  const raw = `From: Ana <${from}>\r\nTo: ${address}\r\nSubject: Ventas\r\nMessage-ID: <${id}>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nva el archivo\r\n${parts}--b--\r\n`;
  return {
    to: address, from, rawSize: raw.length, raw: new Response(raw).body!, setReject: vi.fn(),
    headers: new Headers({ 'authentication-results': opts.auth ?? CF_PASS, 'message-id': `<${id}>` }),
  };
}
const send = async (m: ReturnType<typeof mail>) => { await handleInboundEmail(m as never, e, {} as ExecutionContext); return m; };

async function dataset(name = 'ventas') {
  const row = await e.DB.prepare('SELECT r2_key, version, metadata FROM datasets WHERE artifact_id = ? AND name = ?')
    .bind(ART, name).first<{ r2_key: string; version: number; metadata: string }>();
  if (!row) return null;
  const obj = await e.ARTIFACTS.get(row.r2_key);
  return { version: row.version, meta: JSON.parse(row.metadata), rows: JSON.parse(await obj!.text()) as Record<string, unknown>[] };
}
const lastRun = () => e.DB.prepare("SELECT last_status, last_error FROM scheduled_jobs WHERE artifact_id = ? AND action = 'email_sheet_sync'")
  .bind(ART).first<{ last_status: string; last_error: string | null }>();

const as = (id: string) => getSessionUser.mockReset().mockResolvedValue({ id, email: `${id}@ess.test` });
const api = (artifactId: string, method = 'GET', body?: unknown, sub = '') => routeEmailSyncApi(createFetchContext(new Request(`https://shareout.test/v1/artifacts/${artifactId}/email-sync${sub}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}), e));

const VENTAS = () => book({ Ventas: [['Producto', 'Unidades'], ['Café', 10], ['Té', 4]], Notas: [['x'], [1]] });

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    ...[OWNER, EDITOR, VIEWER].map((u) => e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(u, `${u}@ess.test`, u)),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'ESS', 'ess-ws', OWNER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_ess', ?, ?, 'owner')").bind(WS, OWNER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_ess_e', ?, ?, 'member')").bind(WS, EDITOR),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_ess_v', ?, ?, 'member')").bind(WS, VIEWER),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'Ventas', 'ess-ventas', ?, ?, 'private')").bind(ART, OWNER, WS),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'Bare', 'ess-bare', ?, ?, 'private')").bind(BARE, OWNER, WS),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_ess_e', ?, ?, 'editor')").bind(ART, `${EDITOR}@ess.test`),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_ess_v', ?, ?, 'viewer')").bind(ART, `${VIEWER}@ess.test`),
  ]);
  // The panel's one question: who sends the file. This turns the inbox on.
  as(OWNER);
  const res = await api(ART, 'PUT', { senders: [SENDER, ' Ana@ACME.test '] }, '/senders');
  expect(res?.status).toBe(200);
  const body = (await res!.json()) as { address: string; senders: string[] };
  expect(body.senders).toEqual([SENDER]);
  address = body.address;
  const { job, error } = await createJob(e, OWNER, {
    artifact_id: ART, action: 'email_sheet_sync', trigger_type: 'event', event_type: 'email.received', config: { dataset: 'ventas' }, title: 'Actualizar por email',
  });
  expect(error).toBeUndefined();
  expect(job).toBeTruthy();
});

beforeEach(async () => {
  dispatchLifecycleEmail.mockClear();
  await e.DB.prepare('DELETE FROM datasets WHERE artifact_id = ?').bind(ART).run();
  await e.DB.prepare("UPDATE users SET locale = NULL WHERE id = ?").bind(OWNER).run();
  await e.DB.prepare("UPDATE scheduled_jobs SET config = ? WHERE artifact_id = ? AND action = 'email_sheet_sync'").bind(JSON.stringify({ dataset: 'ventas' }), ART).run();
});

describe('email_sheet_sync — the whole path', () => {
  it('an allowed, verified sender emails an Excel file → its first tab becomes the dataset', async () => {
    const m = await send(mail([{ name: 'ventas noviembre.xlsx', type: XLSX_MIME, bytes: VENTAS() }]));
    expect(m.setReject).not.toHaveBeenCalled();
    const ds = await dataset();
    expect(ds!.rows).toEqual([{ Producto: 'Café', Unidades: 10 }, { Producto: 'Té', Unidades: 4 }]);
    expect(ds!.meta).toMatchObject({ rowCount: 2, source: { provider: 'email', file: 'ventas noviembre.xlsx', sheet: 'Ventas' } });
    // Dataset metadata is readable by the page's viewers: never the sender's address.
    expect(JSON.stringify(ds!.meta)).not.toContain('acme');
    expect(await lastRun()).toMatchObject({ last_status: 'success', last_error: null });
    expect(dispatchLifecycleEmail).not.toHaveBeenCalled();

    // The panel shows the result.
    as(OWNER);
    const st = (await (await api(ART))!.json()) as Record<string, any>;
    expect(st).toMatchObject({ address, senders: [SENDER], datasets: ['ventas'], you: `${OWNER}@ess.test`,
      job: { dataset: 'ventas', lastStatus: 'success' }, lastUpdate: { rowCount: 2, file: 'ventas noviembre.xlsx', sheet: 'Ventas' },
      lastEmail: { from: SENDER, files: ['ventas noviembre.xlsx'] } });
    expect(typeof st.job.lastRunAt).toBe('number');
  });

  it('the same rows again leave the dataset alone; new rows replace it', async () => {
    await send(mail([{ name: 'a.xlsx', type: XLSX_MIME, bytes: VENTAS() }]));
    await send(mail([{ name: 'a.xlsx', type: XLSX_MIME, bytes: VENTAS() }]));
    expect((await dataset())!.version).toBe(1);
    await send(mail([{ name: 'a.xlsx', type: XLSX_MIME, bytes: book({ Ventas: [['Producto', 'Unidades'], ['Mate', 7]] }) }]));
    const ds = await dataset();
    expect(ds!.version).toBe(2);
    expect(ds!.rows).toEqual([{ Producto: 'Mate', Unidades: 7 }]);
  });

  it('a UTF-8 CSV keeps its accents', async () => {
    await send(mail([{ name: 'ventas.csv', type: 'text/csv', bytes: new TextEncoder().encode('producto,ciudad\nCafé,Córdoba\nÑandú,São Paulo\n') }]));
    expect((await dataset())!.rows).toEqual([{ producto: 'Café', ciudad: 'Córdoba' }, { producto: 'Ñandú', ciudad: 'São Paulo' }]);
  });

  it('picks the attachment by name and the tab the settings name', async () => {
    await e.DB.prepare("UPDATE scheduled_jobs SET config = ? WHERE artifact_id = ? AND action = 'email_sheet_sync'")
      .bind(JSON.stringify({ dataset: 'ventas', attachment: 'ventas*.xlsx', sheet: 'notas' }), ART).run();
    await send(mail([
      { name: 'otro.xlsx', type: XLSX_MIME, bytes: book({ Hoja: [['nope'], [0]] }) },
      { name: 'Ventas 2026.xlsx', type: XLSX_MIME, bytes: VENTAS() },
    ]));
    expect((await dataset())!.rows).toEqual([{ x: 1 }]);
  });

  it('a sender who is not on the list is bounced at the door and nothing changes', async () => {
    const m = await send(mail([{ name: 'a.xlsx', type: XLSX_MIME, bytes: VENTAS() }], { from: 'eve@acme.test', auth: 'mx.cloudflare.net; dkim=pass header.d=acme.test; dmarc=pass' }));
    expect(m.setReject).toHaveBeenCalledWith(SENDER_NOT_PERMITTED_BOUNCE);
    expect(await dataset()).toBeNull();
  });

  it('a forged From (no DMARC/DKIM for the sender’s domain) is bounced at the door', async () => {
    const m = await send(mail([{ name: 'a.xlsx', type: XLSX_MIME, bytes: VENTAS() }], { auth: 'mx.cloudflare.net; dkim=pass header.d=evil.test; dmarc=none' }));
    expect(m.setReject).toHaveBeenCalledWith(SENDER_NOT_PERMITTED_BOUNCE);
    expect(await dataset()).toBeNull();
  });
});

describe('email_sheet_sync — a file that cannot be used keeps the last good data and tells the owner why', () => {
  const failsWith = async (files: Parameters<typeof mail>[0], re: RegExp) => {
    await send(mail([{ name: 'ok.xlsx', type: XLSX_MIME, bytes: VENTAS() }]));
    dispatchLifecycleEmail.mockClear();
    await send(mail(files));
    const run = await lastRun();
    expect(run!.last_status).toBe('failed');
    expect(run!.last_error).toMatch(re);
    expect((await dataset())!.rows).toHaveLength(2);
    expect(dispatchLifecycleEmail).toHaveBeenCalledWith(e, expect.objectContaining({
      type: 'job_failed', toUserId: OWNER, data: expect.objectContaining({ jobName: 'Actualizar por email', via: 'email', error: run!.last_error }),
    }));
  };

  it('no attachment', () => failsWith([], /no file attached\. Attach the Excel or CSV file and send it again/));
  it('the wrong kind of file', () => failsWith([{ name: 'factura.pdf', type: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) }], /no Excel \(\.xlsx\) or CSV file \(it had: factura\.pdf\)/));
  it('a file named .xlsx that is not one', () => failsWith([{ name: 'virus.xlsx', type: XLSX_MIME, bytes: new TextEncoder().encode('<script>alert(1)</script>') }], /isn’t a real Excel file/));
  it('a .csv that is really markup', () => failsWith([{ name: 'x.csv', type: 'text/csv', bytes: new TextEncoder().encode('<html><table><tr><td>1</td></tr></table></html>') }], /isn’t a real CSV file/));
  it('a header-only Excel', () => failsWith([{ name: 'vacio.xlsx', type: XLSX_MIME, bytes: book({ Ventas: [['Producto', 'Unidades']] }) }], /“vacio\.xlsx” has no rows under the headers \(tab “Ventas”\), so the page kept its data/));
  it('a header-only CSV', () => failsWith([{ name: 'vacio.csv', type: 'text/csv', bytes: new TextEncoder().encode('producto,unidades\n') }], /“vacio\.csv” has no rows under the headers/));
  it('a tab that is not there', async () => {
    await e.DB.prepare("UPDATE scheduled_jobs SET config = ? WHERE artifact_id = ? AND action = 'email_sheet_sync'")
      .bind(JSON.stringify({ dataset: 'ventas', sheet: 'Resumen' }), ART).run();
    await send(mail([{ name: 'a.xlsx', type: XLSX_MIME, bytes: VENTAS() }]));
    expect((await lastRun())!.last_error).toBe('“a.xlsx” has no tab named “Resumen” (tabs: Ventas, Notas). Rename the tab or change it in the settings.');
  });
  it('a file name that does not match', async () => {
    await e.DB.prepare("UPDATE scheduled_jobs SET config = ? WHERE artifact_id = ? AND action = 'email_sheet_sync'")
      .bind(JSON.stringify({ dataset: 'ventas', attachment: 'stock*.xlsx' }), ART).run();
    await send(mail([{ name: 'ventas.xlsx', type: XLSX_MIME, bytes: VENTAS() }]));
    expect((await lastRun())!.last_error).toMatch(/No attached file is named like “stock\*\.xlsx” \(it had: ventas\.xlsx\)/);
  });

  it('speaks the owner’s language', async () => {
    await e.DB.prepare("UPDATE users SET locale = 'es' WHERE id = ?").bind(OWNER).run();
    await send(mail([]));
    expect((await lastRun())!.last_error).toBe('El email no tenía ningún archivo adjunto. Adjuntá el Excel o CSV y mandalo de nuevo.');
  });
});

describe('email_sheet_sync — the action re-checks everything itself', () => {
  const payload = (over: Partial<EmailReceivedPayload> = {}): EmailReceivedPayload => ({
    messageId: 'inb_x', rfcMessageId: null, from: SENDER, sender: SENDER, senderVerified: true, to: address, prefix: 'p', tag: null,
    subject: null, textPreview: '', hasHtml: false, attachments: [], auth: { spf: null, dkim: null, dmarc: null }, receivedAt: 0, ...over,
  });
  const run = (over: Partial<EmailReceivedPayload> = {}, createdBy = OWNER, triggeredVia: 'event' | 'manual' = 'event') =>
    emailSheetSyncDestination.deliver(e, { artifactId: ART, createdBy, triggeredVia, eventPayload: triggeredVia === 'event' ? payload(over) : undefined }, { dataset: 'ventas' });

  it('Run now has no email to read and says where to send the file', async () => {
    expect((await run({}, OWNER, 'manual')).error).toMatch(/emails the file to the page’s address/);
  });
  it('an unverified sender or one taken off the list writes nothing', async () => {
    expect((await run({ senderVerified: false })).error).toMatch(/couldn’t confirm the email really came from ana@acme\.test/);
    expect((await run({ sender: 'bob@acme.test' })).error).toMatch(/bob@acme\.test isn’t on the list/);
    expect(await dataset()).toBeNull();
  });
  it('a creator who can no longer edit the page writes nothing', async () => {
    expect((await run({}, VIEWER)).error).toMatch(/can no longer edit the page/);
  });
  it('an attachment over the size cap is refused before it is read', async () => {
    const ws = (await e.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?').bind(ART).first<{ workspace_id: string }>())!.workspace_id;
    await storeInboundMessage(e, ART, ws, {
      id: 'inb_big', messageId: 'big@x', from: SENDER, to: address, tag: null, subject: null, textBody: null, htmlBody: null,
      spf: null, dkim: null, dmarc: null, sizeBytes: 1, receivedAt: 1,
      attachments: [{ filename: 'big.xlsx', contentType: XLSX_MIME, size: 9_000_000, r2Key: 'inbox/none' }],
    });
    expect((await run({ messageId: 'inb_big' })).error).toMatch(/“big\.xlsx” is too big \(the limit is 8 MB\)/);
  });
});

describe('email_sheet_sync — setting it up', () => {
  it('cannot be created while nobody is allowed to send, or with a whole free-mail domain', async () => {
    const make = (artifact_id: string) => createJob(e, OWNER, { artifact_id, action: 'email_sheet_sync', trigger_type: 'event', event_type: 'email.received', config: { dataset: 'd' } });
    const none = await make(BARE);
    expect(none).toMatchObject({ code: 'NO_SENDERS' });
    expect(none.error).toMatch(/Add who may send the file first: PUT \/v1\/artifacts\/art_ess_bare\/email-sync\/senders/);
    as(OWNER);
    expect((await api(BARE, 'PUT', { senders: ['ana@acme.test'] }, '/senders'))?.status).toBe(200);
    await setInboundAllowlist(e, BARE, ['ana@acme.test', 'gmail.com']);
    const free = await make(BARE);
    expect(free).toMatchObject({ code: 'FREE_MAIL_DOMAIN' });
    expect(free.error).toMatch(/“gmail\.com” would let anyone/);
  });

  it('runs only on email.received', async () => {
    const { error } = await createJob(e, OWNER, { artifact_id: ART, action: 'email_sheet_sync', schedule: '0 9 * * *', config: { dataset: 'ventas' } });
    expect(error).toMatch(/runs when an email arrives/);
  });

  it('the senders endpoint: plain errors, editors allowed, viewers not', async () => {
    as(OWNER);
    const bad = await api(ART, 'PUT', { senders: ['ana@'] }, '/senders');
    expect(bad?.status).toBe(400);
    expect(await bad!.json()).toMatchObject({ code: 'BAD_SENDER', param: 'ana@' });
    expect(await (await api(ART, 'PUT', { senders: ['@gmail.com'] }, '/senders'))!.json()).toMatchObject({ code: 'FREE_MAIL_DOMAIN' });
    expect(await (await api(ART, 'PUT', { senders: [' '] }, '/senders'))!.json()).toMatchObject({ code: 'NO_SENDERS' });
    as(EDITOR);
    expect((await api(ART, 'PUT', { senders: [SENDER, '@acme.test'] }, '/senders'))?.status).toBe(200);
    expect((await getInboxStatus(e, ART)).allowlist).toEqual([SENDER, '@acme.test']);
    as(VIEWER);
    expect((await api(ART))?.status).toBe(404);
    as(OWNER);
    await api(ART, 'PUT', { senders: [SENDER] }, '/senders');
  });

  it('the inbox API refuses to empty the list while the page updates by email', async () => {
    const ws = (await e.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?').bind(ART).first<{ workspace_id: string }>())!.workspace_id;
    const ctx = { env: e, artifactId: ART, workspaceId: ws, origin: null, artifact: { owner_id: OWNER } } as unknown as DataContext;
    const put = (allowlist: unknown) => handleInbox(new Request('https://x/inbox/allowlist', { method: 'PUT', body: JSON.stringify({ allowlist }) }), ctx, '/allowlist');
    expect((await put(null)).status).toBe(400);
    expect((await put([])).status).toBe(400);
    // A whole free-mail domain would let any Gmail sender past the door: refused, alone or mixed in.
    for (const list of [['@gmail.com'], [SENDER, '@gmail.com'], ['Outlook.com']]) {
      const res = await put(list);
      expect(res.status, JSON.stringify(list)).toBe(400);
      expect(JSON.stringify(await res.json())).toMatch(/would let anyone with such an address/);
    }
    const enable = await handleInbox(new Request('https://x/inbox/enable', { method: 'POST', body: JSON.stringify({ allowlist: ['@hotmail.com'] }) }), ctx, '/enable');
    expect(enable.status).toBe(400);
    expect((await getInboxStatus(e, ART)).allowlist).toEqual([SENDER]);
    // A company domain or another exact address is fine.
    expect((await put([SENDER, '@acme.test'])).status).toBe(200);
    expect((await put([SENDER])).status).toBe(200);
  });
});

describe('attachment choice', () => {
  const att = (filename: string) => ({ filename, contentType: '', size: 1, r2Key: '' });
  it('matches names with * as anything, ignoring case', () => {
    expect(attachmentMatches('ventas*.xlsx', 'Ventas Noviembre.XLSX')).toBe(true);
    expect(attachmentMatches('ventas*.xlsx', 'ventas.csv')).toBe(false);
    expect(attachmentMatches('*2026*', 'stock 2026 final.xlsx')).toBe(true);
    expect(attachmentMatches('a*a', 'a')).toBe(false);
    expect(attachmentMatches('stock.csv', 'Stock.csv')).toBe(true);
  });
  it('takes the first spreadsheet; says why when there is none', () => {
    expect(pickAttachment([att('logo.png'), att('b.csv'), att('c.xlsx')]).att?.filename).toBe('b.csv');
    expect(pickAttachment([])).toEqual({ code: 'no_attachment' });
    expect(pickAttachment([att('a.xls'), att('b.pdf')])).toEqual({ code: 'wrong_type' });
    expect(pickAttachment([att('b.csv')], 'stock*')).toEqual({ code: 'no_match' });
  });
});
