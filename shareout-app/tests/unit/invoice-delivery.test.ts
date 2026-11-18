// Invoice delivery on real D1 + R2 (migrations/0041): the operator creates an invoice from the
// document their tax system issued; issuing emails it (billing email, else owners/admins; the
// suppression list wins; the "send email" checkbox can say no); a transfer proof — uploaded by a
// workspace admin or sent as a reply to the invoice email — marks it paid and tells the operator.
// A reply that is not clearly a payment from the workspace changes nothing.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e as baseEnv } from './helpers/migrated-db';
import {
  handleCreateInvoice, handleCreateInvoiceFromDocument, handleDownloadInvoiceFile, handleListInvoices, handleSendInvoice,
  handleUpdateInvoice, handleUploadInvoiceFile,
} from '../../src/router/api/workspace-invoices';
import { handleInboundEmail } from '../../src/email/inbound';
import { buildEmail } from '../../src/email/catalog-es';
import { addSuppression, removeSuppression } from '../../src/email/suppressions';
import { generateEmailPrefix } from '../../src/scheduling/email';
import type { AuthUser } from '../../src/api-auth';
import type { Env } from '../../src/types';

const sent: Array<Record<string, any>> = [];
const send = vi.fn(async (m: Record<string, any>) => { sent.push(m); return { messageId: `msg_${sent.length}` }; });
const e = { ...baseEnv, INSTANCE_ADMIN_EMAILS: 'op@example.com', EMAIL_INBOX_DOMAIN: 'inbox.example.com', EMAIL: { send } } as unknown as Env;

const ACME = 'wsp_dl_acme', GLOBEX = 'wsp_dl_globex';
const as = (id: string, email: string): AuthUser => ({ id, email, username: null });
const OP = as('usr_dl_op', 'op@example.com');
const OWNER = as('usr_dl_owner', 'owner@acme.example');
const ADMIN = as('usr_dl_admin', 'admin@acme.example');
const MEMBER = as('usr_dl_member', 'member@acme.example');
const G_OWNER = as('usr_dl_gowner', 'owner@globex.example');
const G_ADMIN = as('usr_dl_gadmin', 'admin@globex.example');
// An agent token presenting as the operator: the guard refuses it, and so does every handler.
const AGENT: AuthUser = { ...OP, service: { tokenId: 'sot_dl', workspaceId: ACME, scopes: ['artifacts:read'] } };

const PDF = new TextEncoder().encode('%PDF-1.7\n% invoice document\n');
const PROOF = new TextEncoder().encode('%PDF-1.4\n% transfer proof\n');
const LAST = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15)).toISOString().slice(0, 7);

const base = (ws: string) => `https://shareout.test/v1/workspaces/${ws}/invoices`;
const json = (method: string, url: string, body?: unknown) =>
  new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
const file = (method: string, url: string, bytes: Uint8Array, type = 'application/pdf') => new Request(url, { method, headers: { 'Content-Type': type }, body: bytes });
const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as any });

function fromDocument(ws: string, params: Record<string, string>, bytes = PDF, type = 'application/pdf') {
  return file('POST', `${base(ws)}/from-document?${new URLSearchParams(params)}`, bytes, type);
}
const doc = { number: 'A-0003-00000042', currency: 'ARS', total_cents: '150000000', description: 'Monthly service', period_month: LAST, notes: 'Bank X, account 000123', due_at: '2030-01-10', name: 'factura.pdf' };

async function createOpen(ws: string, number: string, extra: Record<string, string> = {}) {
  const { body } = await read(await handleCreateInvoiceFromDocument(fromDocument(ws, { ...doc, number, status: 'open', ...extra }), e, OP, ws));
  return body;
}
const invoiceRow = (id: string) => e.DB.prepare('SELECT * FROM workspace_invoices WHERE id = ?').bind(id).first<Record<string, any>>();
const auditFor = async (id: string) =>
  ((await e.DB.prepare('SELECT action, actor_email, detail FROM audit_log WHERE target_id = ? ORDER BY created_at, rowid').bind(id)
    .all<{ action: string; actor_email: string | null; detail: string }>()).results ?? []).map((r) => ({ ...r, detail: JSON.parse(r.detail || '{}') }));
const toOperator = () => sent.filter((m) => m.to === 'op@example.com');
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const bytesOf = (content: ArrayBuffer | Uint8Array) => new Uint8Array(content);

beforeAll(async () => {
  await applyMigrations();
  for (const u of [OP, OWNER, ADMIN, MEMBER, G_OWNER, G_ADMIN]) await e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(u.id, u.email).run();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, disabled) VALUES ('usr_dl_off', 'off@globex.example', 1), ('usr_dl_ext', 'ext@partner.example', 0)"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id, locale) VALUES (?, 'Acme', 'acme-dl', ?, 'en'), (?, 'Globex', 'globex-dl', ?, 'es')")
      .bind(ACME, OWNER.id, GLOBEX, G_OWNER.id),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_dl_1', '${ACME}', '${OWNER.id}', 'owner', 'internal'), ('wm_dl_2', '${ACME}', '${ADMIN.id}', 'admin', 'internal'),
      ('wm_dl_3', '${ACME}', '${MEMBER.id}', 'member', 'internal'), ('wm_dl_4', '${GLOBEX}', '${G_OWNER.id}', 'owner', 'internal'),
      ('wm_dl_5', '${GLOBEX}', '${G_ADMIN.id}', 'admin', 'internal'), ('wm_dl_6', '${GLOBEX}', 'usr_dl_off', 'admin', 'internal'),
      ('wm_dl_7', '${GLOBEX}', 'usr_dl_ext', 'admin', 'external')`),
    e.DB.prepare(`INSERT INTO workspace_billing_profiles (workspace_id, legal_name, billing_email) VALUES ('${ACME}', 'Acme SA', 'billing@acme.example')`),
  ]);
});

beforeEach(() => { sent.length = 0; });

describe('create from document', () => {
  it('makes a one-line invoice with the document attached, numbered as printed', async () => {
    const { status, body } = await read(await handleCreateInvoiceFromDocument(fromDocument(ACME, doc), e, OP, ACME));
    expect(status).toBe(201);
    expect(body.invoice).toMatchObject({
      number: 'A-0003-00000042', status: 'draft', currency: 'ARS', total_cents: 150_000_000, period_month: LAST,
      due_at: '2030-01-10T00:00:00.000Z', notes: 'Bank X, account 000123', receipt: { name: 'factura.pdf', type: 'application/pdf' },
      emailed_at: null, emailed_to: [], paid_source: null,
    });
    expect(body.invoice.lines).toEqual([{ kind: 'item', description: 'Monthly service', quantity: 1, unit_cents: 150_000_000, amount_cents: 150_000_000 }]);
    expect(body.email).toBeUndefined();
    const dl = await handleDownloadInvoiceFile(e, OP, ACME, body.invoice.id, 'receipt');
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(PDF);
    expect(sent).toHaveLength(0);
  });

  it('takes a free-text number, refuses a taken one and leaves no orphan file behind', async () => {
    const spaced = await read(await handleCreateInvoiceFromDocument(fromDocument(ACME, { ...doc, number: 'FC B  0003-00000043' }), e, OP, ACME));
    expect(spaced.status).toBe(201);
    expect(spaced.body.invoice.number).toBe('FC B 0003-00000043');
    const before = (await e.ARTIFACTS.list({ prefix: `workspace-invoices/${ACME}/` })).objects.length;
    const taken = await read(await handleCreateInvoiceFromDocument(fromDocument(ACME, doc), e, OP, ACME));
    expect(taken.status).toBe(409);
    expect(JSON.stringify(taken.body)).toContain('NUMBER_TAKEN');
    expect((await e.ARTIFACTS.list({ prefix: `workspace-invoices/${ACME}/` })).objects.length).toBe(before);
  });

  it('validates the fields and the document', async () => {
    const bad = async (params: Record<string, string>, bytes = PDF, type = 'application/pdf') =>
      (await handleCreateInvoiceFromDocument(fromDocument(ACME, params, bytes, type), e, OP, ACME)).status;
    expect(await bad({ ...doc, number: '' })).toBe(400);
    expect(await bad({ ...doc, number: '../etc' })).toBe(400);
    expect(await bad({ ...doc, number: 'Z-1', total_cents: '12.50' })).toBe(400);
    expect(await bad({ ...doc, number: 'Z-1', total_cents: '0' })).toBe(400);
    expect(await bad({ ...doc, number: 'Z-1', description: '' })).toBe(400);
    expect(await bad({ ...doc, number: 'Z-1', period_month: '2026-13' })).toBe(400);
    expect(await bad({ ...doc, number: 'Z-1' }, new TextEncoder().encode('<html>'), 'text/html')).toBe(400);
    expect(await bad({ ...doc, number: 'Z-1' }, new TextEncoder().encode('not a pdf'))).toBe(400);
  });

  it('is the operator\'s alone', async () => {
    for (const u of [OWNER, ADMIN, MEMBER, G_OWNER, AGENT]) {
      expect((await handleCreateInvoiceFromDocument(fromDocument(ACME, { ...doc, number: 'Z-2' }), e, u, ACME)).status).toBe(403);
    }
  });
});

describe('issue → email', () => {
  it('emails the billing email with the document attached and a per-invoice reply address', async () => {
    const { invoice, email } = await createOpen(ACME, 'A-0003-00000050');
    expect(email).toEqual({ sent: true, to: ['billing@acme.example'], suppressed: [] });
    expect(sent).toHaveLength(1);
    const m = sent[0];
    expect(m.to).toBe('billing@acme.example');
    expect(m.subject).toBe('Invoice A-0003-00000050 for Acme');
    expect(m.replyTo).toMatch(/^invoice\+[a-f0-9]{24}@inbox\.example\.com$/);
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]).toMatchObject({ filename: 'factura.pdf', type: 'application/pdf', disposition: 'attachment' });
    expect(bytesOf(m.attachments[0].content)).toEqual(PDF);
    expect(m.html).toContain('1,500,000.00');
    expect(m.html).toContain('January 10, 2030');
    expect(m.html).toContain('Bank X, account 000123');
    expect(m.html).toContain('https://acme-dl.shareout.test/home?view=admin&amp;tab=billing');
    expect(m.text).toContain('reply to this email with the transfer receipt attached');

    expect(invoice.emailed_to).toEqual(['billing@acme.example']);
    expect(invoice.emailed_at).toBeTruthy();
    const row = await invoiceRow(invoice.id);
    expect(m.replyTo).toBe(`invoice+${row!.reply_token}@inbox.example.com`);
    expect(JSON.stringify(invoice)).not.toContain(row!.reply_token);

    const log = await e.DB.prepare('SELECT recipient, source_kind, status FROM email_sends WHERE source_id = ?').bind(invoice.id).all();
    expect(log.results).toEqual([{ recipient: 'billing@acme.example', source_kind: 'invoice', status: 'sent' }]);
    expect((await auditFor(invoice.id)).map((a) => a.action)).toEqual(['invoice.issue', 'invoice.email']);
  });

  it('falls back to the internal owners and admins, in the workspace\'s language', async () => {
    const list = await read(await handleListInvoices(e, OP, GLOBEX));
    expect(list.body.delivery).toEqual({ to: ['owner@globex.example', 'admin@globex.example'], source: 'admins', suppressed: [], email_enabled: true });
    expect((await read(await handleListInvoices(e, G_ADMIN, GLOBEX))).body.delivery).toBeUndefined();

    const created = await read(await handleCreateInvoice(json('POST', base(GLOBEX), {
      status: 'open', currency: 'USD', lines: [{ description: 'Platform fee', unit_cents: 50_000 }], due_at: '2030-02-01',
    }), e, OP, GLOBEX));
    expect(created.status).toBe(201);
    expect(created.body.email.to).toEqual(['owner@globex.example', 'admin@globex.example']);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['owner@globex.example', 'admin@globex.example']);
    expect(sent[0].subject).toMatch(/^Factura INV-\d{4}-\d{4} para Globex$/);
    expect(sent[0].html).toContain('1 de febrero de 2030');
    expect(sent[0].html).toContain('Te llega porque sos propietario o administrador del espacio');
    expect(sent[0].attachments).toBeUndefined();
  });

  it('sends nothing when the operator unticks "send email", and can resend later', async () => {
    const draft = await read(await handleCreateInvoice(json('POST', base(ACME), { lines: [{ description: 'Setup', unit_cents: 1_000 }] }), e, OP, ACME));
    const id = draft.body.invoice.id;
    const issued = await read(await handleUpdateInvoice(json('PATCH', `${base(ACME)}/${id}`, { status: 'open', send_email: false }), e, OP, ACME, id));
    expect(issued.body.invoice).toMatchObject({ status: 'open', emailed_at: null, emailed_to: [] });
    expect(issued.body.email).toBeUndefined();
    expect(sent).toHaveLength(0);

    const resent = await read(await handleSendInvoice(e, OP, ACME, id));
    expect(resent.status).toBe(200);
    expect(resent.body.email).toMatchObject({ sent: true, to: ['billing@acme.example'] });
    expect(resent.body.invoice.emailed_to).toEqual(['billing@acme.example']);
    expect(sent).toHaveLength(1);
    expect((await auditFor(id)).find((a) => a.action === 'invoice.email')?.detail).toMatchObject({ resend: true, to: ['billing@acme.example'] });
  });

  it('emails once when the same draft is issued twice at the same moment', async () => {
    const draft = await read(await handleCreateInvoice(json('POST', base(ACME), { lines: [{ description: 'Setup', unit_cents: 1_000 }] }), e, OP, ACME));
    const id = draft.body.invoice.id;
    const issue = () => handleUpdateInvoice(json('PATCH', `${base(ACME)}/${id}`, { status: 'open' }), e, OP, ACME, id).then(read);
    const results = await Promise.all([issue(), issue()]);
    expect(results.filter((r) => r.body.email?.sent)).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect((await auditFor(id)).filter((a) => a.action === 'invoice.issue')).toHaveLength(1);
    expect((await invoiceRow(id))?.status).toBe('open');
  });

  it('never mails a suppressed address', async () => {
    await addSuppression(e, { email: 'billing@acme.example', reason: 'bounce' });
    try {
      expect((await read(await handleListInvoices(e, OP, ACME))).body.delivery).toMatchObject({ to: [], suppressed: ['billing@acme.example'], source: 'billing_email' });
      const { invoice, email } = await createOpen(ACME, 'A-0003-00000051');
      expect(email).toMatchObject({ sent: false, to: [], suppressed: ['billing@acme.example'], code: 'NO_RECIPIENTS' });
      expect(invoice.status).toBe('open');
      expect((await handleSendInvoice(e, OP, ACME, invoice.id)).status).toBe(409);
      expect(sent).toHaveLength(0);
    } finally {
      await removeSuppression(e, 'billing@acme.example');
    }
    await addSuppression(e, { email: 'admin@globex.example', reason: 'unsubscribe' });
    try {
      const { email } = await createOpen(GLOBEX, 'G-0001');
      expect(email).toMatchObject({ sent: true, to: ['owner@globex.example'], suppressed: ['admin@globex.example'] });
      expect(sent.map((m) => m.to)).toEqual(['owner@globex.example']);
    } finally {
      await removeSuppression(e, 'admin@globex.example');
    }
  });

  it('is transactional: the lifecycle pause and the nurture flag do not stop it', async () => {
    const paused = { ...e, LIFECYCLE_EMAILS_DISABLED: '1', NURTURE_EMAILS_ENABLED: undefined } as unknown as Env;
    const { body } = await read(await handleCreateInvoiceFromDocument(fromDocument(ACME, { ...doc, number: 'A-0003-00000053', status: 'open' }), paused, OP, ACME));
    expect(body.email).toMatchObject({ sent: true, to: ['billing@acme.example'] });
    expect(sent).toHaveLength(1);
  });

  it('says why when the instance cannot send, without blocking the issue', async () => {
    const noEmail = { ...e, EMAIL: undefined } as unknown as Env;
    const { body } = await read(await handleCreateInvoiceFromDocument(fromDocument(ACME, { ...doc, number: 'A-0003-00000052', status: 'open' }), noEmail, OP, ACME));
    expect(body.invoice.status).toBe('open');
    expect(body.email).toMatchObject({ sent: false, code: 'EMAIL_UNAVAILABLE', to: ['billing@acme.example'] });
    expect((await handleSendInvoice(noEmail, OP, ACME, body.invoice.id)).status).toBe(503);
  });

  it('lets only the operator issue or send, and never an agent token', async () => {
    const draft = await read(await handleCreateInvoice(json('POST', base(ACME), { lines: [{ description: 'Setup', unit_cents: 1_000 }] }), e, OP, ACME));
    const id = draft.body.invoice.id;
    for (const u of [OWNER, ADMIN, MEMBER, AGENT]) {
      expect((await handleUpdateInvoice(json('PATCH', `${base(ACME)}/${id}`, { status: 'open' }), e, u, ACME, id)).status).toBe(403);
      expect((await handleSendInvoice(e, u, ACME, id)).status).toBe(403);
      expect((await handleCreateInvoice(json('POST', base(ACME), { status: 'open', lines: [{ description: 'x', unit_cents: 1 }] }), e, u, ACME)).status).toBe(403);
    }
    expect((await handleSendInvoice(e, OP, ACME, id)).status).toBe(409); // still a draft
    expect(sent).toHaveLength(0);
  });
});

describe('transfer proof → paid', () => {
  it('marks the invoice paid when a workspace admin attaches the proof, and tells the operator', async () => {
    const { invoice } = await createOpen(ACME, 'A-0003-00000060', { send_email: '0' });
    expect(sent).toHaveLength(0);
    const up = await read(await handleUploadInvoiceFile(file('PUT', `${base(ACME)}/${invoice.id}/proof?name=transfer.pdf`, PROOF), e, ADMIN, ACME, invoice.id, 'proof'));
    expect(up.status).toBe(200);
    expect(up.body.invoice).toMatchObject({ status: 'paid', paid_source: 'proof', proof: { name: 'transfer.pdf', uploaded_by: 'admin@acme.example' } });
    expect(up.body.invoice.paid_at).toBeTruthy();

    const notices = toOperator();
    expect(notices).toHaveLength(1);
    expect(notices[0].subject).toBe('Acme paid invoice A-0003-00000060');
    expect(notices[0].text).toContain('admin@acme.example attached a transfer proof');
    expect(notices[0].attachments[0]).toMatchObject({ filename: 'transfer.pdf', type: 'application/pdf' });
    expect(bytesOf(notices[0].attachments[0].content)).toEqual(PROOF);
    const audit = await auditFor(invoice.id);
    expect(audit.map((a) => a.action)).toEqual(['invoice.issue', 'invoice.proof', 'invoice.paid']);
    expect(audit[2].detail).toMatchObject({ source: 'proof' });

    // The operator can undo it, and mark it paid by hand.
    const undone = await read(await handleUpdateInvoice(json('PATCH', `${base(ACME)}/${invoice.id}`, { status: 'open' }), e, OP, ACME, invoice.id));
    expect(undone.body.invoice).toMatchObject({ status: 'open', paid_at: null, paid_source: null });
    const byHand = await read(await handleUpdateInvoice(json('PATCH', `${base(ACME)}/${invoice.id}`, { status: 'paid' }), e, OP, ACME, invoice.id));
    expect(byHand.body.invoice).toMatchObject({ status: 'paid', paid_source: 'operator' });
  });

  it('keeps members and agent tokens out, and does not auto-pay a proof the operator attaches', async () => {
    const { invoice } = await createOpen(ACME, 'A-0003-00000061', { send_email: 'false' });
    for (const u of [MEMBER, AGENT]) {
      expect((await handleUploadInvoiceFile(file('PUT', `${base(ACME)}/${invoice.id}/proof`, PROOF), e, u, ACME, invoice.id, 'proof')).status).toBe(403);
    }
    const byOp = await read(await handleUploadInvoiceFile(file('PUT', `${base(ACME)}/${invoice.id}/proof`, PROOF), e, OP, ACME, invoice.id, 'proof'));
    expect(byOp.body.invoice).toMatchObject({ status: 'open', paid_source: null });
    expect(toOperator()).toHaveLength(0);
  });
});

// ---- proof by email ------------------------------------------------------------------------

interface Part { name: string; type: string; bytes: Uint8Array; inline?: boolean }

function rawMail(o: { from: string; to: string; id: string; text?: string; parts?: Part[]; headers?: string }) {
  const b = 'dl-boundary';
  const parts = (o.parts ?? []).map((p) =>
    `--${b}\r\nContent-Type: ${p.type}; name="${p.name}"\r\nContent-Disposition: ${p.inline ? 'inline' : 'attachment'}; filename="${p.name}"\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n${b64(p.bytes)}\r\n`).join('');
  return `From: ${o.from}\r\nTo: ${o.to}\r\nSubject: Re: Invoice\r\nMessage-ID: <${o.id}@mail.example>\r\n${o.headers ?? ''}` +
    `Content-Type: multipart/mixed; boundary="${b}"\r\n\r\n--${b}\r\nContent-Type: text/plain\r\n\r\n${o.text ?? 'Paid, receipt attached.'}\r\n${parts}--${b}--\r\n`;
}

function message(o: { from: string; to: string; id: string; auth?: string; text?: string; parts?: Part[]; headers?: Record<string, string> }) {
  const extra = Object.entries(o.headers ?? {}).map(([k, v]) => `${k}: ${v}\r\n`).join('');
  const raw = rawMail({ ...o, headers: extra });
  return {
    from: o.from, to: o.to, rawSize: raw.length, raw: new Response(raw).body!, setReject: vi.fn(),
    headers: new Headers({ 'authentication-results': o.auth ?? 'mx.example; spf=pass; dkim=pass; dmarc=pass', 'message-id': `<${o.id}@mail.example>`, ...(o.headers ?? {}) }),
  };
}

const proofPart: Part = { name: 'comprobante.pdf', type: 'application/pdf', bytes: PROOF };
const deliver = async (m: ReturnType<typeof message>) => { await handleInboundEmail(m as never, e, {} as ExecutionContext); return m; };
const replyTo = async (id: string) => `invoice+${(await invoiceRow(id))!.reply_token}@inbox.example.com`;

describe('proof by email reply', () => {
  it('a reply with the proof from the billing email marks it paid and tells the operator', async () => {
    const { invoice } = await createOpen(ACME, 'A-0003-00000070');
    const to = await replyTo(invoice.id);
    sent.length = 0;
    const m = await deliver(message({ from: 'Acme Billing <billing@acme.example>', to, id: 'r1', parts: [proofPart] }));
    expect(m.setReject).not.toHaveBeenCalled();

    const row = await invoiceRow(invoice.id);
    expect(row).toMatchObject({ status: 'paid', paid_source: 'email', proof_name: 'comprobante.pdf', proof_type: 'application/pdf', paid_by: null });
    expect(new Uint8Array(await (await e.ARTIFACTS.get(row!.proof_r2_key))!.arrayBuffer())).toEqual(PROOF);
    const notices = toOperator();
    expect(notices).toHaveLength(1);
    expect(notices[0].text).toContain('billing@acme.example replied to the invoice email with a transfer proof');
    expect(bytesOf(notices[0].attachments[0].content)).toEqual(PROOF);
    const paid = (await auditFor(invoice.id)).find((a) => a.action === 'invoice.paid');
    expect(paid).toMatchObject({ actor_email: 'billing@acme.example', detail: { source: 'email' } });

    // Email Routing may deliver the same message again: nothing happens twice.
    sent.length = 0;
    await deliver(message({ from: 'billing@acme.example', to, id: 'r1', parts: [proofPart] }));
    expect(sent).toHaveLength(0);
  });

  it('accepts an internal owner or admin, and a PDF sent as octet-stream, over an inline logo', async () => {
    const { invoice } = await createOpen(ACME, 'A-0003-00000071');
    const logo: Part = { name: 'logo.png', type: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), inline: true };
    await deliver(message({ from: 'owner@acme.example', to: await replyTo(invoice.id), id: 'r2', parts: [logo, { ...proofPart, type: 'application/octet-stream' }] }));
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: 'paid', paid_source: 'email', proof_name: 'comprobante.pdf', paid_by: OWNER.id });
  });

  it.each([
    ['an unknown sender', { from: 'someone@globex.example' }, 'sender'],
    ['a member who is not an admin', { from: 'member@acme.example' }, 'sender'],
    ['a sender that does not pass DMARC', { from: 'billing@acme.example', auth: 'mx.example; spf=pass; dkim=none; dmarc=none' }, 'sender check'],
    ['a reply without an attachment', { from: 'billing@acme.example', parts: [] }, 'no attachment'],
    ['an attachment that is not a document', { from: 'billing@acme.example', parts: [{ name: 'x.html', type: 'text/html', bytes: new TextEncoder().encode('<b>hi</b>') }] }, 'PDF, PNG, JPG or WEBP'],
    // A "thanks, received" whose only images are the signature: inline, or attached under the
    // name Outlook gives embedded images. Neither is a transfer proof.
    ['a reply whose only images are a signature', {
      from: 'billing@acme.example',
      parts: [
        { name: 'image001.png', type: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), inline: true },
        { name: 'image002.png', type: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]) },
      ],
    }, 'PDF, PNG, JPG or WEBP'],
  ])('changes nothing for %s, and asks the operator to look', async (_label, o: Partial<Parameters<typeof message>[0]>, why) => {
    const { invoice } = await createOpen(ACME, `A-0004-${Math.random().toString(36).slice(2, 10)}`);
    sent.length = 0;
    const m = await deliver(message({ from: o.from!, to: await replyTo(invoice.id), id: `n-${invoice.id}`, auth: o.auth, parts: o.parts ?? [proofPart] }));
    expect(m.setReject).not.toHaveBeenCalled();
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: 'open', paid_source: null, proof_r2_key: null });
    const notices = toOperator();
    expect(notices).toHaveLength(1);
    expect(notices[0].subject).toContain('needs a look');
    expect(notices[0].text).toContain(why);
    expect(notices[0].attachments).toBeUndefined();
  });

  it('changes nothing on a void or already-paid invoice', async () => {
    const { invoice } = await createOpen(ACME, 'A-0003-00000072');
    await handleUpdateInvoice(json('PATCH', `${base(ACME)}/${invoice.id}`, { status: 'void' }), e, OP, ACME, invoice.id);
    sent.length = 0;
    await deliver(message({ from: 'billing@acme.example', to: await replyTo(invoice.id), id: 'r-void', parts: [proofPart] }));
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: 'void', proof_r2_key: null, paid_source: null });
    expect(toOperator()[0].text).toContain('the invoice is void');

    const { invoice: paid } = await createOpen(ACME, 'A-0003-00000075');
    await handleUpdateInvoice(json('PATCH', `${base(ACME)}/${paid.id}`, { status: 'paid', payment_reference: 'TRX-1' }), e, OP, ACME, paid.id);
    sent.length = 0;
    await deliver(message({ from: 'billing@acme.example', to: await replyTo(paid.id), id: 'r-paid', parts: [proofPart] }));
    expect(await invoiceRow(paid.id)).toMatchObject({ status: 'paid', paid_source: 'operator', proof_r2_key: null, payment_reference: 'TRX-1' });
    expect(toOperator()[0].text).toContain('the invoice is already paid');
  });

  it('bounces a forged message and an unknown token without touching anything', async () => {
    const { invoice } = await createOpen(ACME, 'A-0003-00000073');
    sent.length = 0;
    const forged = await deliver(message({ from: 'billing@acme.example', to: await replyTo(invoice.id), id: 'r-forged', auth: 'mx.example; spf=fail; dkim=fail; dmarc=fail', parts: [proofPart] }));
    expect(forged.setReject).toHaveBeenCalledWith('Failed authentication');
    for (const to of ['invoice+0123456789abcdef01234567@inbox.example.com', 'invoice@inbox.example.com', `invoice+${invoice.id}@inbox.example.com`]) {
      const m = await deliver(message({ from: 'billing@acme.example', to, id: `r-${to}`, parts: [proofPart] }));
      expect(m.setReject).toHaveBeenCalledWith('Mailbox not found');
    }
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: 'open', proof_r2_key: null });
    expect(sent).toHaveLength(0);
  });

  it('drops out-of-office replies silently', async () => {
    const { invoice } = await createOpen(ACME, 'A-0003-00000074');
    sent.length = 0;
    await deliver(message({ from: 'billing@acme.example', to: await replyTo(invoice.id), id: 'r-ooo', parts: [proofPart], headers: { 'Auto-Submitted': 'auto-replied' } }));
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: 'open' });
    expect(sent).toHaveLength(0);
  });
});

describe('invoice mail copy and addresses', () => {
  const ctx = { env: {} as never, baseUrl: 'https://shareout.test' };
  const issued = {
    workspaceName: 'Acme', number: 'A-0003-00000042', totalCents: 150_000_000, currency: 'ARS', dueAt: '2030-01-10T00:00:00.000Z',
    periodMonth: '2029-12', notes: 'CBU <0001>', billingUrl: 'https://acme.shareout.test/home?view=admin&tab=billing', hasDocument: true, audience: 'billing_email',
  };

  it('speaks rioplatense Spanish without tuteo, and escapes what the operator typed', () => {
    const es = buildEmail('invoice_issued', issued, { ...ctx, locale: 'es' })!;
    expect(es.subject).toBe('Factura A-0003-00000042 para Acme');
    expect(es.bodyHtml).toMatch(/\$\s1\.500\.000,00/); // es-AR puts a no-break space after the sign
    expect(es.bodyHtml).toContain('diciembre de 2029');
    expect(es.bodyHtml).toContain('CBU &lt;0001&gt;');
    expect(es.cta?.label).toBe('Abrir Facturación');
    const samples: Array<[string, Record<string, unknown>]> = [
      ['invoice_issued', issued],
      ['invoice_paid_notice', { workspaceName: 'Acme', number: 'A-1', totalCents: 100, currency: 'USD', source: 'email', from: 'a@b.example', billingUrl: 'u' }],
      ...(['unverified', 'sender', 'paid', 'void', 'draft', 'no_attachment', 'file'] as const).map((reason): [string, Record<string, unknown>] =>
        ['invoice_reply_review', { workspaceName: 'Acme', number: 'A-1', from: 'a@b.example', reason, subject: 's', excerpt: 'e', attachments: ['x.pdf'], billingUrl: 'u' }]),
    ];
    for (const [type, data] of samples) {
      const b = buildEmail(type as never, data, { ...ctx, locale: 'es' })!;
      const all = [b.subject, b.heading, b.bodyHtml, b.bodyText, b.footerNote, b.cta?.label].join(' ');
      expect(all, type).not.toMatch(/\b(tú|tienes|puedes|quieres|elige|haz|ingresa|abre)\b/i);
      expect(buildEmail(type as never, data, ctx)!.subject, type).toBeTruthy();
    }
  });

  it('never hands an artifact the reserved invoice address', async () => {
    expect(await generateEmailPrefix(e, 'invoice')).toBe('invoice-1');
    expect(await generateEmailPrefix(e, 'support')).toBe('support-1');
  });
});
