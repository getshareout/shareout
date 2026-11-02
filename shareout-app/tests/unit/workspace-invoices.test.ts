// Workspace invoices on real D1 + R2: the operator bills a workspace (fixed lines + a closed month's AI
// usage with its breakdown), the workspace's admins see it once issued and attach transfer proof, the
// operator marks it paid. Members, other workspaces and externals never see it.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import initSql from '../../migrations/0000_init.sql?raw';
import tokensSql from '../../migrations/0024_ai_usage_tokens.sql?raw';
import invoicesSql from '../../migrations/0034_workspace_invoices.sql?raw';
import {
  handleCreateInvoice, handleDeleteInvoice, handleDownloadInvoiceFile, handleListInvoices, handlePreviewUsage,
  handleUpdateInvoice, handleUploadInvoiceFile,
} from '../../src/router/api/workspace-invoices';
import { fileProblem, parseCreateInvoice, safeFileName, InvoiceInputError } from '../../src/workspaces/invoices';
import type { AuthUser } from '../../src/api-auth';
import type { Env } from '../../src/types';

const e = { ...(env as unknown as Env), INSTANCE_ADMIN_EMAILS: 'op@example.com' } as Env;
const WS = 'wsp_inv_acme', OTHER = 'wsp_inv_other';
const as = (id: string, email: string): AuthUser => ({ id, email, username: null });
const OP = as('usr_inv_op', 'op@example.com');
const ADMIN = as('usr_inv_admin', 'admin@acme.test');
const MEMBER = as('usr_inv_member', 'member@acme.test');
const EXTERNAL = as('usr_inv_ext', 'ext@partner.test');
const STRANGER = as('usr_inv_stranger', 'boss@other.test');

const now = new Date();
const ym = (d: Date) => d.toISOString().slice(0, 7);
const LAST = ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)));
const THIS = ym(now);
const PDF = new TextEncoder().encode('%PDF-1.4\n%fake but well-formed enough\n');

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://shareout.test/v1/workspaces/${WS}/invoices${path}`, {
    method,
    headers: body instanceof Uint8Array ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body == null ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
  });
const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as any });

async function usage(ws: string, user: string | null, kind: string, model: string, at: string, cost: number, tin: number, tout: number) {
  await e.DB.prepare(
    `INSERT INTO ai_usage_events (id, workspace_id, user_id, kind, model, units, unit_kind, base_cost_micro_usd, input_tokens, output_tokens, cost_source, created_at)
     VALUES (?, ?, ?, ?, ?, 0, 'tokens', ?, ?, ?, 'reconciled', ?)`,
  ).bind(crypto.randomUUID(), ws, user, kind, model, cost, tin, tout, at).run();
}

beforeAll(async () => {
  for (const sql of [initSql, tokensSql, invoicesSql]) {
    const stmts = sql.replace(/--[^\n]*/g, '').split(/;\s*\n/).map((x) => x.trim()).filter(Boolean);
    for (let i = 0; i < stmts.length; i += 50) await e.DB.batch(stmts.slice(i, i + 50).map((x) => e.DB.prepare(x)));
  }
  for (const u of [OP, ADMIN, MEMBER, EXTERNAL, STRANGER]) {
    await e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(u.id, u.email).run();
  }
  await e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Acme', 'acme-inv', ?), (?, 'Other', 'other-inv', ?)")
    .bind(WS, ADMIN.id, OTHER, STRANGER.id).run();
  const member = (id: string, ws: string, user: string, role: string, cls = 'internal') =>
    e.DB.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES (?, ?, ?, ?, ?)').bind(id, ws, user, role, cls).run();
  await member('wm_inv_1', WS, ADMIN.id, 'admin');
  await member('wm_inv_2', WS, MEMBER.id, 'member');
  await member('wm_inv_3', WS, EXTERNAL.id, 'admin', 'external');
  await member('wm_inv_4', OTHER, STRANGER.id, 'owner');

  // Last month: $12.00 chat by the admin, $3.50 automations with no user, $0.25 chat by the member.
  await usage(WS, ADMIN.id, 'assistant_chat', 'anthropic/claude-sonnet-5', `${LAST}-03T10:00:00.000Z`, 12_000_000, 400_000, 50_000);
  await usage(WS, null, 'crew_run', 'openai/gpt-4o', `${LAST}-20T10:00:00.000Z`, 3_500_000, 100_000, 20_000);
  await usage(WS, MEMBER.id, 'assistant_chat', 'anthropic/claude-sonnet-5', `${LAST}-28T23:59:59.000Z`, 250_000, 9_000, 1_000);
  // Not billed: this month, and another workspace's usage last month.
  await usage(WS, ADMIN.id, 'assistant_chat', 'anthropic/claude-sonnet-5', `${THIS}-01T00:00:00.000Z`, 99_000_000, 1, 1);
  await usage(OTHER, STRANGER.id, 'assistant_chat', 'anthropic/claude-sonnet-5', `${LAST}-10T10:00:00.000Z`, 77_000_000, 1, 1);
});

const contract = {
  lines: [
    { description: 'Platform setup', unit_cents: 30_000 },
    { description: 'Platform fee', unit_cents: 5_000 },
  ],
  usage_month: LAST,
  due_at: '2030-01-10',
  notes: 'Transfer to Bank X, CBU 000123',
};

describe('workspace invoices', () => {
  let invoiceId = '';

  it('lets only the operator create, and bills fixed lines plus last month\'s usage with its breakdown', async () => {
    for (const u of [ADMIN, MEMBER, STRANGER]) {
      expect((await handleCreateInvoice(req('POST', '', contract), e, u, WS)).status).toBe(403);
    }
    const { status, body } = await read(await handleCreateInvoice(req('POST', '', contract), e, OP, WS));
    expect(status).toBe(201);
    const inv = body.invoice;
    invoiceId = inv.id;
    expect(inv.status).toBe('draft');
    expect(inv.number).toMatch(/^INV-\d{4}-0001$/);
    expect(inv.period_month).toBe(LAST);
    expect(inv.lines.map((l: any) => l.amount_cents)).toEqual([30_000, 5_000, 1_575]);
    expect(inv.total_cents).toBe(36_575);
    const u = inv.lines[2].usage;
    expect(u.total_micro_usd).toBe(15_750_000);
    expect(u.calls).toBe(3);
    expect(u.by_kind.map((r: any) => [r.key, r.cost_micro_usd])).toEqual([['assistant_chat', 12_250_000], ['crew_run', 3_500_000]]);
    expect(u.by_model[0]).toMatchObject({ key: 'anthropic/claude-sonnet-5', calls: 2, input_tokens: 409_000, output_tokens: 51_000 });
    expect(u.by_member.map((r: any) => r.key)).toEqual(['admin@acme.test', '', 'member@acme.test']);
  });

  it('refuses a month that has not closed, and billing the same month twice', async () => {
    const open = await read(await handleCreateInvoice(req('POST', '', { ...contract, usage_month: THIS }), e, OP, WS));
    expect(open).toMatchObject({ status: 400 });
    expect(JSON.stringify(open.body)).toContain('USAGE_MONTH_OPEN');
    const twice = await read(await handleCreateInvoice(req('POST', '', contract), e, OP, WS));
    expect(twice.status).toBe(409);
    expect(JSON.stringify(twice.body)).toContain('USAGE_ALREADY_BILLED');
    const preview = await read(await handlePreviewUsage(req('GET', `/usage?month=${LAST}`), e, OP, WS));
    expect(preview.body.already_billed_in).toMatch(/^INV-/);
    expect(preview.body.usage.total_micro_usd).toBe(15_750_000);
    expect((await handlePreviewUsage(req('GET', `/usage?month=${LAST}`), e, ADMIN, WS)).status).toBe(403);
  });

  it('keeps drafts from the workspace, shows issued invoices to its admins only', async () => {
    expect((await read(await handleListInvoices(e, ADMIN, WS))).body).toEqual({ invoices: [], can_manage: false });
    expect((await read(await handleListInvoices(e, OP, WS))).body.invoices).toHaveLength(1);

    const issued = await read(await handleUpdateInvoice(req('PATCH', `/${invoiceId}`, { status: 'open' }), e, OP, WS, invoiceId));
    expect(issued.body.invoice.status).toBe('open');
    expect(issued.body.invoice.issued_at).toBeTruthy();

    const list = await read(await handleListInvoices(e, ADMIN, WS));
    expect(list.body.invoices.map((i: any) => i.id)).toEqual([invoiceId]);
    expect(JSON.stringify(list.body)).not.toContain('r2_key');
    for (const u of [MEMBER, EXTERNAL, STRANGER]) expect((await handleListInvoices(e, u, WS)).status).toBe(403);
    expect((await read(await handleListInvoices(e, STRANGER, OTHER))).body.invoices).toEqual([]);
  });

  it('takes the operator\'s receipt and the admin\'s transfer proof, checking the bytes', async () => {
    const pdf = { 'Content-Type': 'application/pdf' };
    expect((await handleUploadInvoiceFile(req('PUT', `/${invoiceId}/receipt`, PDF, pdf), e, ADMIN, WS, invoiceId, 'receipt')).status).toBe(403);
    expect((await handleUploadInvoiceFile(req('PUT', `/${invoiceId}/receipt?name=Factura%20A-0001.pdf`, PDF, pdf), e, OP, WS, invoiceId, 'receipt')).status).toBe(200);

    const fake = new TextEncoder().encode('<html><script>alert(1)</script>');
    expect((await handleUploadInvoiceFile(req('PUT', `/${invoiceId}/proof`, fake, pdf), e, ADMIN, WS, invoiceId, 'proof')).status).toBe(400);
    expect((await handleUploadInvoiceFile(req('PUT', `/${invoiceId}/proof`, PDF, { 'Content-Type': 'image/svg+xml' }), e, ADMIN, WS, invoiceId, 'proof')).status).toBe(400);
    expect((await handleUploadInvoiceFile(req('PUT', `/${invoiceId}/proof`, PDF, pdf), e, MEMBER, WS, invoiceId, 'proof')).status).toBe(403);
    const up = await read(await handleUploadInvoiceFile(req('PUT', `/${invoiceId}/proof?name=transfer.pdf`, PDF, pdf), e, ADMIN, WS, invoiceId, 'proof'));
    expect(up.status).toBe(200);
    expect(up.body.invoice.proof).toMatchObject({ name: 'transfer.pdf', uploaded_by: 'admin@acme.test' });
    expect(up.body.invoice.receipt).toMatchObject({ name: 'Factura A-0001.pdf', type: 'application/pdf' });

    const dl = await handleDownloadInvoiceFile(e, ADMIN, WS, invoiceId, 'receipt');
    expect(dl.status).toBe(200);
    expect(dl.headers.get('Content-Disposition')).toContain('attachment');
    expect(dl.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(PDF);
    expect((await handleDownloadInvoiceFile(e, MEMBER, WS, invoiceId, 'receipt')).status).toBe(403);
    expect((await handleDownloadInvoiceFile(e, STRANGER, WS, invoiceId, 'proof')).status).toBe(403);
  });

  it('lets the operator mark it paid (and undo), and refuses impossible transitions', async () => {
    expect((await handleUpdateInvoice(req('PATCH', `/${invoiceId}`, { status: 'paid' }), e, ADMIN, WS, invoiceId)).status).toBe(403);
    const paid = await read(await handleUpdateInvoice(req('PATCH', `/${invoiceId}`, { status: 'paid', payment_reference: 'TRX-991' }), e, OP, WS, invoiceId));
    expect(paid.body.invoice).toMatchObject({ status: 'paid', payment_reference: 'TRX-991' });
    expect(paid.body.invoice.paid_at).toBeTruthy();
    expect((await handleUploadInvoiceFile(req('PUT', `/${invoiceId}/proof`, PDF, { 'Content-Type': 'application/pdf' }), e, ADMIN, WS, invoiceId, 'proof')).status).toBe(409);
    expect((await handleUpdateInvoice(req('PATCH', `/${invoiceId}`, { status: 'void' }), e, OP, WS, invoiceId)).status).toBe(409);
    expect((await handleDeleteInvoice(e, OP, WS, invoiceId)).status).toBe(409);
    const undone = await read(await handleUpdateInvoice(req('PATCH', `/${invoiceId}`, { status: 'open' }), e, OP, WS, invoiceId));
    expect(undone.body.invoice).toMatchObject({ status: 'open', paid_at: null });

    const audit = await e.DB.prepare("SELECT action FROM audit_log WHERE workspace_id = ? AND target_id = ? ORDER BY created_at").bind(WS, invoiceId).all<{ action: string }>();
    expect(audit.results.map((r) => r.action)).toEqual(
      expect.arrayContaining(['invoice.create', 'invoice.issue', 'invoice.receipt', 'invoice.proof', 'invoice.paid', 'invoice.unpaid']));
  });

  it('numbers invoices in sequence, rejects a taken custom number and deletes only drafts', async () => {
    const second = await read(await handleCreateInvoice(req('POST', '', { lines: [{ description: 'Platform fee', unit_cents: 5_000 }] }), e, OP, WS));
    expect(second.body.invoice.number).toMatch(/^INV-\d{4}-0002$/);
    const custom = { number: 'A-0001-00000042', lines: [{ description: 'Fee', unit_cents: 1 }] };
    expect((await handleCreateInvoice(req('POST', '', custom), e, OP, WS)).status).toBe(201);
    expect((await handleCreateInvoice(req('POST', '', custom), e, OP, WS)).status).toBe(409);
    expect((await handleDeleteInvoice(e, OP, WS, second.body.invoice.id)).status).toBe(200);
    expect((await handleDeleteInvoice(e, OP, OTHER, invoiceId)).status).toBe(404);
  });
});

describe('invoice input', () => {
  const bad = (body: unknown) => { try { parseCreateInvoice(body); return null; } catch (err) { return err instanceof InvoiceInputError ? err.message : String(err); } };

  it('validates lines, money and months', () => {
    expect(bad({ lines: [] })).toContain('at least one line');
    expect(bad({ lines: [{ description: 'x', unit_cents: 10.5 }] })).toContain('unit_cents');
    expect(bad({ lines: [{ unit_cents: 100 }] })).toContain('description');
    expect(bad({ usage_month: '2026-13' })).toContain('YYYY-MM');
    expect(bad({ usage_month: '2026-10', currency: 'ARS' })).toContain('USD');
    expect(bad({ lines: [{ description: 'x', unit_cents: 1 }], number: '../etc' })).toContain('number');
    expect(bad({ lines: [{ description: 'x', unit_cents: 1 }], status: 'paid' })).toContain('status');
    expect(parseCreateInvoice({ lines: [{ description: ' Fee ', unit_cents: 5000, quantity: 2 }], currency: 'ars' }))
      .toMatchObject({ currency: 'ARS', status: 'draft', lines: [{ description: 'Fee', amount_cents: 10_000 }] });
  });

  it('accepts only real documents and keeps file names harmless', () => {
    expect(fileProblem('application/pdf', PDF)).toBeNull();
    expect(fileProblem('image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBeNull();
    expect(fileProblem('text/html', PDF)?.code).toBe('INVALID_CONTENT_TYPE');
    expect(fileProblem('image/jpeg', PDF)?.code).toBe('INVALID_FILE');
    expect(fileProblem('application/pdf', new Uint8Array())?.code).toBe('EMPTY_FILE');
    expect(safeFileName('../../etc/"passwd"\n.pdf', 'x')).toBe('passwd.pdf');
    expect(safeFileName(null, 'receipt-INV-1')).toBe('receipt-INV-1');
  });
});
