import type { Env } from '../types';
import { priceCall } from '../data/agent/model-costs';
import { resell } from '../data/ai-markup';

// Invoices the instance operator issues to a workspace by hand (migrations/0034). ShareOut
// charges nothing and gates nothing on them: the workspace pays outside (a bank transfer), the
// operator attaches the receipt and marks the invoice paid. A usage line snapshots a CLOSED
// month of ai_usage_events — the same meter the monthly AI budget reads — with its breakdown,
// so the invoice never moves after it is created. It bills the workspace's price (cost × its
// AI markup, ai-markup.ts); cost and markup stay in the snapshot for the operator and are
// stripped from what the workspace sees (invoiceView).

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void';

export interface UsageRow {
  key: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  /** What the workspace pays. */
  price_micro_usd: number;
  /** Operator only. */
  cost_micro_usd?: number;
}

export interface UsageSnapshot {
  month: string;
  /** What the workspace pays: cost × markup. */
  price_micro_usd: number;
  /** Operator only. */
  cost_micro_usd?: number;
  /** Operator only. 15000 = 1.5×. */
  markup_bps?: number;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  by_kind: UsageRow[];
  by_model: UsageRow[];
  /** key = the member's email, or '' when the call had no user (automations) or the user is gone. */
  by_member: UsageRow[];
}

export interface InvoiceLine {
  kind: 'item' | 'usage';
  description: string;
  quantity: number;
  unit_cents: number;
  amount_cents: number;
  usage?: UsageSnapshot;
}

export interface InvoiceRecord {
  id: string;
  workspace_id: string;
  number: string;
  status: InvoiceStatus;
  currency: string;
  total_cents: number;
  period_month: string | null;
  lines_json: string;
  notes: string | null;
  due_at: string | null;
  issued_at: string | null;
  receipt_r2_key: string | null;
  receipt_name: string | null;
  receipt_type: string | null;
  proof_r2_key: string | null;
  proof_name: string | null;
  proof_type: string | null;
  proof_uploaded_by: string | null;
  proof_uploaded_at: string | null;
  paid_at: string | null;
  paid_by: string | null;
  payment_reference: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateInvoiceInput {
  number: string | null;
  currency: string;
  period_month: string | null;
  due_at: string | null;
  notes: string | null;
  lines: InvoiceLine[];
  usage_month: string | null;
  status: 'draft' | 'open';
}

export class InvoiceInputError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/;
export const MAX_LINES = 50;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const isMonth = (s: unknown): s is string => typeof s === 'string' && MONTH_RE.test(s);

/** [start, end) of a UTC month as ISO strings, for comparing against created_at. */
export function monthWindow(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)).toISOString(), end: new Date(Date.UTC(y, m, 1)).toISOString() };
}

/** A month is closed once the UTC month after it has started. Usage is only billed for closed months. */
export const isClosedMonth = (month: string, now = new Date()): boolean => month < now.toISOString().slice(0, 7);

export const centsFromMicro = (micro: number): number => Math.round(micro / 10_000);

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** A closed month's metered AI usage for one workspace, by kind, model and member, at cost and at `markupBps`. */
export async function usageForMonth(env: Env, workspaceId: string, month: string, markupBps: number): Promise<UsageSnapshot> {
  const { start, end } = monthWindow(month);
  const rows = (await env.DB.prepare(
    `SELECT e.kind AS kind, e.model AS model, u.email AS email, e.cost_source AS cost_source,
            COUNT(*) AS calls, SUM(e.base_cost_micro_usd) AS cost, SUM(e.input_tokens) AS tin, SUM(e.output_tokens) AS tout
       FROM ai_usage_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.workspace_id = ? AND e.created_at >= ? AND e.created_at < ?
      GROUP BY e.kind, e.model, u.email, e.cost_source`,
  ).bind(workspaceId, start, end).all<{
    kind: string; model: string; email: string | null; cost_source: string | null;
    calls: number; cost: number | null; tin: number | null; tout: number | null;
  }>()).results ?? [];

  const groups = { kind: new Map<string, UsageRow>(), model: new Map<string, UsageRow>(), member: new Map<string, UsageRow>() };
  const snap: UsageSnapshot = {
    month, price_micro_usd: 0, cost_micro_usd: 0, markup_bps: markupBps, calls: 0, input_tokens: 0, output_tokens: 0, by_kind: [], by_model: [], by_member: [],
  };
  for (const r of rows) {
    let micro = r.cost ?? 0;
    // The hourly reconcile prices rows; one still pending gets the list price, as the AI budget does.
    if (r.cost_source === 'pending' && micro === 0) {
      micro = (await priceCall(env, r.model, r.tin ?? 0, r.tout ?? 0).catch(() => ({ microUsd: 0 }))).microUsd;
    }
    const add = (map: Map<string, UsageRow>, key: string) => {
      const g = map.get(key) ?? { key, calls: 0, input_tokens: 0, output_tokens: 0, price_micro_usd: 0, cost_micro_usd: 0 };
      g.calls += r.calls; g.input_tokens += r.tin ?? 0; g.output_tokens += r.tout ?? 0; g.cost_micro_usd! += micro;
      map.set(key, g);
    };
    add(groups.kind, r.kind);
    add(groups.model, r.model);
    add(groups.member, r.email ?? '');
    snap.cost_micro_usd! += micro; snap.calls += r.calls; snap.input_tokens += r.tin ?? 0; snap.output_tokens += r.tout ?? 0;
  }
  // Price each row and the total from cost; the total is priced once, so it is never off by row rounding.
  const sorted = (m: Map<string, UsageRow>) => [...m.values()]
    .map((g) => ({ ...g, price_micro_usd: resell(g.cost_micro_usd!, markupBps) }))
    .sort((a, b) => b.price_micro_usd - a.price_micro_usd || a.key.localeCompare(b.key));
  snap.price_micro_usd = resell(snap.cost_micro_usd!, markupBps);
  snap.by_kind = sorted(groups.kind);
  snap.by_model = sorted(groups.model);
  snap.by_member = sorted(groups.member);
  return snap;
}

export function usageLine(snap: UsageSnapshot): InvoiceLine {
  const cents = centsFromMicro(snap.price_micro_usd);
  return { kind: 'usage', description: `AI usage — ${monthLabel(snap.month)}`, quantity: 1, unit_cents: cents, amount_cents: cents, usage: snap };
}

const str = (v: unknown, max: number, field: string): string | null => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') throw new InvoiceInputError('VALIDATION_ERROR', `${field} must be a string`);
  const s = v.trim();
  if (s.length > max) throw new InvoiceInputError('VALIDATION_ERROR', `${field} is longer than ${max} characters`);
  return s || null;
};

/** Validate a create body. Usage is added by the caller (it needs the database). */
export function parseCreateInvoice(body: unknown): CreateInvoiceInput {
  if (!body || typeof body !== 'object') throw new InvoiceInputError('VALIDATION_ERROR', 'Body must be a JSON object');
  const b = body as Record<string, unknown>;

  const number = str(b.number, 40, 'number');
  if (number && !NUMBER_RE.test(number)) {
    throw new InvoiceInputError('VALIDATION_ERROR', 'number may use letters, digits and . _ / - (max 40)');
  }
  const currency = (str(b.currency, 3, 'currency') ?? 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new InvoiceInputError('VALIDATION_ERROR', 'currency must be a 3-letter code, e.g. USD');

  const usageMonth = str(b.usage_month, 7, 'usage_month');
  if (usageMonth && !isMonth(usageMonth)) throw new InvoiceInputError('INVALID_MONTH', 'usage_month must be YYYY-MM');
  if (usageMonth && currency !== 'USD') {
    throw new InvoiceInputError('VALIDATION_ERROR', 'AI usage is metered in USD; use currency USD to bill it');
  }
  const periodMonth = str(b.period_month, 7, 'period_month') ?? usageMonth;
  if (periodMonth && !isMonth(periodMonth)) throw new InvoiceInputError('INVALID_MONTH', 'period_month must be YYYY-MM');

  const due = str(b.due_at, 10, 'due_at');
  if (due && !DAY_RE.test(due)) throw new InvoiceInputError('VALIDATION_ERROR', 'due_at must be YYYY-MM-DD');

  const status = b.status == null ? 'draft' : b.status;
  if (status !== 'draft' && status !== 'open') throw new InvoiceInputError('VALIDATION_ERROR', "status must be 'draft' or 'open'");

  const rawLines = b.lines == null ? [] : b.lines;
  if (!Array.isArray(rawLines)) throw new InvoiceInputError('VALIDATION_ERROR', 'lines must be an array');
  if (rawLines.length + (usageMonth ? 1 : 0) > MAX_LINES) throw new InvoiceInputError('VALIDATION_ERROR', `At most ${MAX_LINES} lines`);
  const lines: InvoiceLine[] = rawLines.map((l, i) => {
    if (!l || typeof l !== 'object') throw new InvoiceInputError('VALIDATION_ERROR', `lines[${i}] must be an object`);
    const o = l as Record<string, unknown>;
    const description = str(o.description, 200, `lines[${i}].description`);
    if (!description) throw new InvoiceInputError('VALIDATION_ERROR', `lines[${i}].description is required`);
    const quantity = o.quantity == null ? 1 : o.quantity;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) {
      throw new InvoiceInputError('VALIDATION_ERROR', `lines[${i}].quantity must be a whole number from 1 to 10000`);
    }
    const unit = o.unit_cents;
    // Negative lines are credits/discounts; the invoice total still has to stay >= 0.
    if (typeof unit !== 'number' || !Number.isInteger(unit) || Math.abs(unit) > 100_000_000) {
      throw new InvoiceInputError('VALIDATION_ERROR', `lines[${i}].unit_cents must be a whole number of cents`);
    }
    return { kind: 'item', description, quantity, unit_cents: unit, amount_cents: unit * quantity };
  });
  if (!lines.length && !usageMonth) throw new InvoiceInputError('VALIDATION_ERROR', 'Add at least one line or a usage_month');

  return {
    number, currency, status, lines, usage_month: usageMonth, period_month: periodMonth,
    due_at: due ? `${due}T00:00:00.000Z` : null,
    notes: str(b.notes, 2000, 'notes'),
  };
}

export const totalCents = (lines: InvoiceLine[]): number => lines.reduce((n, l) => n + l.amount_cents, 0);

/** Next INV-YYYY-NNNN across the instance (numbers are unique instance-wide). */
export async function nextInvoiceNumber(env: Env, now = new Date()): Promise<string> {
  const prefix = `INV-${now.getUTCFullYear()}-`;
  const rows = (await env.DB.prepare('SELECT number FROM workspace_invoices WHERE number LIKE ?')
    .bind(`${prefix}%`).all<{ number: string }>()).results ?? [];
  const max = rows.reduce((n, r) => Math.max(n, Number(r.number.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** Non-void invoices of this workspace that already bill AI usage for `month`. */
export async function usageAlreadyBilled(env: Env, workspaceId: string, month: string): Promise<string | null> {
  const rows = (await env.DB.prepare(
    `SELECT number, lines_json FROM workspace_invoices WHERE workspace_id = ? AND status != 'void'`,
  ).bind(workspaceId).all<{ number: string; lines_json: string }>()).results ?? [];
  for (const r of rows) {
    const lines = parseLines(r.lines_json);
    if (lines.some((l) => l.kind === 'usage' && l.usage?.month === month)) return r.number;
  }
  return null;
}

export function parseLines(json: string | null): InvoiceLine[] {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function getInvoice(env: Env, workspaceId: string, id: string): Promise<InvoiceRecord | null> {
  return env.DB.prepare('SELECT * FROM workspace_invoices WHERE id = ? AND workspace_id = ?')
    .bind(id, workspaceId).first<InvoiceRecord>();
}

export async function listInvoices(env: Env, workspaceId: string, includeDrafts: boolean): Promise<InvoiceRecord[]> {
  const sql = `SELECT * FROM workspace_invoices WHERE workspace_id = ?${includeDrafts ? '' : " AND status != 'draft'"}
    ORDER BY created_at DESC LIMIT 200`;
  return (await env.DB.prepare(sql).bind(workspaceId).all<InvoiceRecord>()).results ?? [];
}

/** What the workspace may see of a usage snapshot: prices only — no cost, no markup. */
export function customerUsage(u: UsageSnapshot): UsageSnapshot {
  const row = ({ cost_micro_usd: _c, ...rest }: UsageRow): UsageRow => rest;
  const { cost_micro_usd: _cost, markup_bps: _bps, ...rest } = u;
  return { ...rest, by_kind: u.by_kind.map(row), by_model: u.by_model.map(row), by_member: u.by_member.map(row) };
}

/** The API shape: storage keys stay server-side; the workspace sees whether a file exists, and the
 *  operator (`operator: true`) also sees each usage line's cost and markup. */
export function invoiceView(r: InvoiceRecord, emails: Record<string, string> = {}, operator = false) {
  const lines = parseLines(r.lines_json).map((l) => (l.usage && !operator ? { ...l, usage: customerUsage(l.usage) } : l));
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    currency: r.currency,
    total_cents: r.total_cents,
    period_month: r.period_month,
    lines,
    notes: r.notes,
    due_at: r.due_at,
    issued_at: r.issued_at,
    receipt: r.receipt_r2_key ? { name: r.receipt_name, type: r.receipt_type } : null,
    proof: r.proof_r2_key
      ? { name: r.proof_name, type: r.proof_type, uploaded_at: r.proof_uploaded_at, uploaded_by: (r.proof_uploaded_by && emails[r.proof_uploaded_by]) || null }
      : null,
    paid_at: r.paid_at,
    payment_reference: r.payment_reference,
    created_at: r.created_at,
  };
}

// ---- Files: the operator's receipt and the workspace's transfer proof ---------------------

const FILE_TYPES: Record<string, (b: Uint8Array) => boolean> = {
  'application/pdf': (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46, // %PDF
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};

/** Null when the bytes are an accepted document, else the reason. Checks the bytes, not just the header. */
export function fileProblem(contentType: string, bytes: Uint8Array): { error: string; code: string } | null {
  const type = contentType.split(';')[0].trim().toLowerCase();
  const sniff = FILE_TYPES[type];
  if (!sniff) return { error: 'Upload a PDF, PNG, JPG or WEBP file', code: 'INVALID_CONTENT_TYPE' };
  if (!bytes.byteLength) return { error: 'The file is empty', code: 'EMPTY_FILE' };
  if (bytes.byteLength > MAX_FILE_BYTES) return { error: 'The file is larger than 10 MB', code: 'FILE_TOO_LARGE' };
  if (!sniff(bytes)) return { error: `The file is not a valid ${type}`, code: 'INVALID_FILE' };
  return null;
}

/** A display name safe for Content-Disposition: no path, no control characters, max 120 chars. */
export function safeFileName(raw: string | null, fallback: string): string {
  const base = (raw || '').split(/[\\/]/).pop() || '';
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 120);
  return clean || fallback;
}

export const invoiceFileKey = (workspaceId: string, invoiceId: string, which: 'receipt' | 'proof') =>
  `workspace-invoices/${workspaceId}/${invoiceId}/${which}`;
