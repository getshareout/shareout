// What reaches a page's "Update by email" address when the mail did not come straight from the
// person on the list: automatic forwards, manual forwards, a group, a forwarding confirmation —
// and what a rejected sender and the page's editors see. Real D1/R2, the real inbound handler, the
// real status route and MCP tool; the Authentication-Results header is what Cloudflare Email
// Routing would stamp for each case (SPF fails on a forward; DKIM survives only if nothing changed).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

const getSessionUser = vi.hoisted(() => vi.fn());
const validateToken = vi.hoisted(() => vi.fn());
const dispatchLifecycleEmail = vi.hoisted(() => vi.fn(async () => ({ sent: true })));
const verifyOwner = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../../src/auth/session', async (orig) => ({ ...(await orig<object>()), getSessionUser }));
vi.mock('../../../src/api-auth', async (orig) => ({ ...(await orig<object>()), validateToken }));
vi.mock('../../../src/email/gateway', async (orig) => ({ ...(await orig<object>()), dispatchLifecycleEmail }));
vi.mock('../../../src/data/middleware', async (orig) => ({ ...(await orig<object>()), verifyOwner }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { handleInboundEmail } from '../../../src/email/inbound';
import { listInboxMessages } from '../../../src/email/inbox-store';
import { routeEmailSyncApi } from '../../../src/router/api/email-sync';
import { createFetchContext } from '../../../src/router/context';
import { handleCreateJob } from '../../../src/scheduling/handler';
import { callTool } from '../../../src/mcp/tools';
import type { AuthUser } from '../../../src/api-auth';

const OWNER = 'usr_fwd_owner';
const WS = 'wsp_fwd';
const owner: AuthUser = { id: OWNER, email: `${OWNER}@fwd.test`, username: null };
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const VENDOR = 'reports@vendor.test';   // the system that produces the report
const CUSTOMER = 'ana@acme.test';       // the person who receives it and forwards it
let seq = 0;

const as = (u: AuthUser) => { getSessionUser.mockReset().mockResolvedValue({ id: u.id, email: u.email }); validateToken.mockReset().mockResolvedValue(u); };
const api = (artifactId: string, method = 'GET', body?: unknown, sub = '') => routeEmailSyncApi(createFetchContext(new Request(`https://shareout.test/v1/artifacts/${artifactId}/email-sync${sub}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}), e)).then(async (r) => ({ status: r!.status, body: (await r!.json()) as Record<string, any> }));
const mcp = (name: string, args: Record<string, unknown>) => { as(owner); return callTool({ env: e, user: owner, origin: 'https://shareout.test', authorization: 'Bearer so_test' }, name, args).then((r) => r!); };
const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((c) => c.text ?? '').join(' ');

async function pageWithSync(id: string, senders: string[]) {
  const html = `<!doctype html><html><body><script src="/sdk/shareout.js"></script><script>(async () => { const sdk = await ShareOut.create(); await sdk.dataset('ventas').get(); })();</script></body></html>`;
  await e.ARTIFACTS.put(`a/${id}/index.html`, html);
  await e.DB.batch([
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, ?, ?, ?, ?, 'private')").bind(id, `Page ${id}`, `s-${id}`, OWNER, WS),
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, 'index.html', '{}')").bind(`ver_${id}`, id),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', ?)").bind(`dep_${id}`, id, `ver_${id}`, `s-${id}`),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, 'index.html', ?, 'text/html', ?, 'x')").bind(`ast_${id}`, `ver_${id}`, `a/${id}/index.html`, html.length),
  ]);
  as(owner);
  const s = await api(id, 'PUT', { senders }, '/senders');
  expect(s.status).toBe(200);
  const j = await handleCreateJob(new Request('https://shareout.test/v1/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artifact_id: id, action: 'email_sheet_sync', trigger_type: 'event', event_type: 'email.received', config: { dataset: 'ventas' }, title: 'Actualizar por email' }),
  }), e, { id: OWNER, email: owner.email } as never);
  expect(j.status).toBe(201);
  return String(s.body.address);
}

function book(): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Producto', 'Monto'], ['Café', 12.5], ['Té', 1.75]]), 'Ventas');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/.{76}/g, '$&\r\n');

/** A message as Email Routing hands it to the Worker. `envFrom` is message.from (the envelope MAIL FROM);
 *  `headerFrom` is the From: header; `auth` is what Cloudflare stamped; `attach` the one attachment. */
function mail(to: string, o: { envFrom: string; headerFrom: string; auth: string; attach?: 'xlsx' | 'eml' | 'none'; subject?: string }) {
  const id = `fwd${++seq}@x.test`;
  const kind = o.attach ?? 'xlsx';
  const part = kind === 'xlsx'
    ? `--b\r\nContent-Type: ${XLSX_MIME}; name="ventas.xlsx"\r\nContent-Disposition: attachment; filename="ventas.xlsx"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(book())}\r\n`
    : kind === 'eml'
      ? `--b\r\nContent-Type: message/rfc822\r\nContent-Disposition: attachment; filename="Reporte.eml"\r\n\r\nFrom: ${VENDOR}\r\nSubject: Reporte\r\n\r\n(original mail)\r\n`
      : '';
  const raw = `From: ${o.headerFrom}\r\nTo: ${to}\r\nSubject: ${o.subject ?? 'Reporte'}\r\nMessage-ID: <${id}>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nhola\r\n${part}--b--\r\n`;
  return { to, from: o.envFrom, rawSize: raw.length, raw: new Response(raw).body!, setReject: vi.fn(), headers: new Headers({ 'authentication-results': o.auth, 'message-id': `<${id}>` }) };
}
const send = async (m: ReturnType<typeof mail>) => { await handleInboundEmail(m as never, e, {} as ExecutionContext); return m; };

// What Cloudflare stamps. SPF is checked against the envelope sender, DKIM against the signature, DMARC against the header From.
const direct = (d: string, from: string) => `mx.cloudflare.net; dkim=pass header.d=${d}; dmarc=pass header.from=${d}; spf=pass smtp.mailfrom=${from}`;
const forwardedKeepingDkim = (d: string) => `mx.cloudflare.net; dkim=pass header.d=${d}; dmarc=pass header.from=${d}; spf=fail smtp.mailfrom=bounce@forwarder.test`;
const forwardedDkimBroken = (d: string) => `mx.cloudflare.net; dkim=fail header.d=${d}; dmarc=fail header.from=${d}; spf=fail smtp.mailfrom=bounce@forwarder.test`;

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(OWNER, owner.email, 'Owner'),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'FWD', 'fwd-ws', ?)").bind(WS, OWNER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_fwd', ?, ?, 'owner', 'internal')").bind(WS, OWNER),
  ]);
});
beforeEach(async () => { dispatchLifecycleEmail.mockClear(); await e.DB.prepare('DELETE FROM rate_limits').run(); });

const status = async (id: string) => { as(owner); return (await api(id)).body; };

describe('automatic forward that keeps the original From (Gmail filter, Outlook redirect rule)', () => {
  let address = '';
  it('accepted when the ORIGINAL sender is on the list: SPF fails on the forward, DKIM + DMARC still pass', async () => {
    address = await pageWithSync('art_fwd_auto', [VENDOR]);
    const m = await send(mail(address, { envFrom: 'bounces+srs0=h=tt=vendor.test=reports@forwarder.test', headerFrom: `Reportes <${VENDOR}>`, auth: forwardedKeepingDkim('vendor.test') }));
    expect(m.setReject).not.toHaveBeenCalled();
    expect(await status('art_fwd_auto')).toMatchObject({ state: 'ok', lastUpdate: { rowCount: 2 }, lastRejected: null });
  });
  it('bounced when only the customer (the forwarder) is on the list: the allowlist matches the header From, not who forwarded', async () => {
    const addr2 = await pageWithSync('art_fwd_auto2', [CUSTOMER]);
    const m2 = await send(mail(addr2, { envFrom: CUSTOMER, headerFrom: VENDOR, auth: forwardedKeepingDkim('vendor.test') }));
    expect(m2.setReject).toHaveBeenCalledWith('Sender not permitted');
    expect(await status('art_fwd_auto2')).toMatchObject({ lastRejected: { from: VENDOR, reason: 'not_allowed' } });
  });
  it('bounced as unverified when the forward changed the message (subject tag / footer) and DKIM + DMARC fail', async () => {
    const addr = await pageWithSync('art_fwd_broken', [VENDOR]);
    const m = await send(mail(addr, { envFrom: 'x@forwarder.test', headerFrom: VENDOR, auth: forwardedDkimBroken('vendor.test'), subject: '[Reportes] Reporte' }));
    expect(m.setReject).toHaveBeenCalledWith('Sender not permitted');
    const st = await status('art_fwd_broken');
    expect(st.lastRejected).toMatchObject({ from: VENDOR, reason: 'unverified' });
    expect(st.lastRejected.message).toMatch(/not through another account or a forwarding service/);
  });
});

describe('manual forward (Gmail Forward, Outlook Forward): the forwarder becomes the From', () => {
  it('accepted when the customer is on the list and the file is a real attachment of the forward', async () => {
    const addr = await pageWithSync('art_fwd_man', [CUSTOMER]);
    const m = await send(mail(addr, { envFrom: CUSTOMER, headerFrom: `Ana <${CUSTOMER}>`, auth: direct('acme.test', CUSTOMER), subject: 'Fwd: Reporte' }));
    expect(m.setReject).not.toHaveBeenCalled();
    expect(await status('art_fwd_man')).toMatchObject({ state: 'ok', lastUpdate: { rowCount: 2 } });
  });
  it('accepted from a free-mail forwarder when the exact address is listed (only a whole @gmail.com is refused)', async () => {
    const addr = await pageWithSync('art_fwd_free', ['ana.contable@gmail.com']);
    const m = await send(mail(addr, { envFrom: 'ana.contable@gmail.com', headerFrom: 'ana.contable@gmail.com', auth: direct('gmail.com', 'ana.contable@gmail.com') }));
    expect(m.setReject).not.toHaveBeenCalled();
    expect((await status('art_fwd_free')).state).toBe('ok');
  });
  it('"Forward as attachment" / Outlook attach-original: mail is accepted but the file is an .eml, so the page keeps its data and says so', async () => {
    const addr = await pageWithSync('art_fwd_eml', [CUSTOMER]);
    const m = await send(mail(addr, { envFrom: CUSTOMER, headerFrom: CUSTOMER, auth: direct('acme.test', CUSTOMER), attach: 'eml' }));
    expect(m.setReject).not.toHaveBeenCalled();
    const st = await status('art_fwd_eml');
    expect(st.state).toBe('failed');
    expect(st.message).toMatch(/no Excel \(\.xlsx\) or CSV file \(it had: Reporte\.eml\)\. Attach the spreadsheet/);
  });
});

describe('a Google Group / alias that rewrites the From', () => {
  it('bounced when the list holds the vendor: the From is now the group address', async () => {
    const addr = await pageWithSync('art_fwd_grp', [VENDOR]);
    const m = await send(mail(addr, { envFrom: 'bounce@acme.test', headerFrom: `Reportes via Grupo <reportes-grupo@acme.test>`, auth: direct('acme.test', 'reportes-grupo@acme.test') }));
    expect(m.setReject).toHaveBeenCalledWith('Sender not permitted');
    expect(await status('art_fwd_grp')).toMatchObject({ lastRejected: { from: 'reportes-grupo@acme.test', reason: 'not_allowed' } });
  });
  it('accepted once the group address itself is on the list (its domain signs the mail)', async () => {
    const addr = await pageWithSync('art_fwd_grp2', ['reportes-grupo@acme.test']);
    const m = await send(mail(addr, { envFrom: 'bounce@acme.test', headerFrom: `Reportes via Grupo <reportes-grupo@acme.test>`, auth: direct('acme.test', 'reportes-grupo@acme.test') }));
    expect(m.setReject).not.toHaveBeenCalled();
    expect((await status('art_fwd_grp2')).state).toBe('ok');
  });
});

describe('Gmail forwarding confirmation mail sent to the page address', () => {
  const GOOGLE = 'forwarding-noreply@google.com'; // address assumed; not confirmed by Google docs
  it('bounced (not on the list) and shown as the last rejection — the customer never sees the confirmation link', async () => {
    const addr = await pageWithSync('art_fwd_conf', [VENDOR]);
    const m = await send(mail(addr, { envFrom: GOOGLE, headerFrom: GOOGLE, auth: direct('google.com', GOOGLE), attach: 'none', subject: 'Gmail Forwarding Confirmation' }));
    expect(m.setReject).toHaveBeenCalledWith('Sender not permitted');
    expect(await status('art_fwd_conf')).toMatchObject({ lastRejected: { from: GOOGLE, reason: 'not_allowed' } });
  });
  it('if that sender is listed for a moment, the mail is stored (readable in the inbox) and the sync fails harmlessly: no file attached, data kept', async () => {
    const addr = await pageWithSync('art_fwd_conf2', [VENDOR, GOOGLE]);
    const m = await send(mail(addr, { envFrom: GOOGLE, headerFrom: GOOGLE, auth: direct('google.com', GOOGLE), attach: 'none', subject: 'Gmail Forwarding Confirmation' }));
    expect(m.setReject).not.toHaveBeenCalled();
    const stored = await listInboxMessages(e, 'art_fwd_conf2', WS, { limit: 10 });
    expect(stored.map((r) => r.subject)).toContain('Gmail Forwarding Confirmation');
    expect(await status('art_fwd_conf2')).toMatchObject({ state: 'failed', lastUpdate: null });
  });
});

describe('what a rejected sender and the page editors see', () => {
  it('the sender gets one SMTP line, identical for "not on the list" and "not verified"; the editors get the reason in plain words (panel + check_email_sync, en)', async () => {
    const addr = await pageWithSync('art_fwd_rej', [CUSTOMER]);
    const a = await send(mail(addr, { envFrom: 'x@y.test', headerFrom: 'jefe@acme.test', auth: direct('acme.test', 'jefe@acme.test') }));
    const b = await send(mail(addr, { envFrom: CUSTOMER, headerFrom: CUSTOMER, auth: forwardedDkimBroken('acme.test') }));
    expect(a.setReject.mock.calls).toEqual([['Sender not permitted']]);
    expect(b.setReject.mock.calls).toEqual([['Sender not permitted']]);
    const st = await status('art_fwd_rej');
    expect(st).toMatchObject({ state: 'waiting_first_email', lastRejected: { from: CUSTOMER, reason: 'unverified' } });
    expect(st.message).toBe(st.lastRejected.message);          // only the LAST one is kept
    expect(text(await mcp('check_email_sync', { artifact_id: 'art_fwd_rej' }))).toMatch(new RegExp(`${CUSTOMER}.*forwarding service`));
  });
  it('a bounce does not surface in the headline once the sync is in state "failed" (the record is still in lastRejected)', async () => {
    const addr = await pageWithSync('art_fwd_rej2', [CUSTOMER]);
    await send(mail(addr, { envFrom: CUSTOMER, headerFrom: CUSTOMER, auth: direct('acme.test', CUSTOMER), attach: 'none' }));
    await send(mail(addr, { envFrom: 'x@y.test', headerFrom: 'jefe@acme.test', auth: direct('acme.test', 'jefe@acme.test') }));
    const st = await status('art_fwd_rej2');
    expect(st.state).toBe('failed');
    expect(st.lastRejected).toMatchObject({ from: 'jefe@acme.test', reason: 'not_allowed' });
    expect(st.message).not.toMatch(/jefe@acme\.test/);
  });
});
