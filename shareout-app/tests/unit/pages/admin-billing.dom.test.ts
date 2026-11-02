// Admin → Overview → Billing (admin-billing.ts) runs in the browser; evaluate the fragment with stubs and
// check what a workspace admin and the operator each see. Its strings ship in the lazy chunk (admin-billing-copy.ts)
// and follow the page language; anything else falls back to the shell's copy.
import { describe, expect, it } from 'vitest';
import { workspace_client_home_views_adminBilling_JS as BILLING } from '../../../src/pages/home/render-workspace/client-script/home-views/admin-billing';
import { ADMIN_COPY } from '../../../src/pages/home/home-i18n/copy/admin';

const copy = (ADMIN_COPY as unknown as Record<string, Record<string, string>>);
const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mount(lang: 'en' | 'es', list: unknown) {
  const mountEl = { innerHTML: '', querySelectorAll: () => [] as never[] };
  const wrap = { hidden: false };
  const t = (k: string) => copy[lang]?.[k] ?? k;
  const run = new Function('document', 'fetch', 'window', 'esc', 't', 'tOr', 'needWs', 'wsUrl', 'swr', 'i18nEmpty', 'adCompact', 'showToast', 'adM', 'adBusy', 'adIdle', 'adDataCache',
    `${BILLING}; return adBilling;`);
  const painted: Promise<unknown>[] = [];
  const swr = (_k: string, paint: (d: unknown) => void, fetcher: () => Promise<unknown>) => { painted.push(fetcher().then(paint)); };
  const adBilling = run(
    { documentElement: { lang }, getElementById: (id: string) => (id === 'wsxAdSecWrap_billing' ? wrap : null) },
    () => Promise.resolve({ ok: list != null, json: () => Promise.resolve(list) }),
    {}, esc, t, (k: string, d: string) => (t(k) === k ? d : t(k)), () => false,
    (p: string) => `/v1/workspaces/w${p}`, swr, (k: string) => `<empty>${t(k)}</empty>`,
    (n: number) => String(n), () => {}, () => mountEl, () => {}, () => {}, {});
  return { run: () => { adBilling(); return Promise.all(painted); }, mountEl, wrap };
}

const invoice = {
  id: 'inv_1', number: 'INV-2026-0001', status: 'open', currency: 'USD', total_cents: 36_575, period_month: '2026-10',
  lines: [
    { kind: 'item', description: 'Platform setup', quantity: 1, unit_cents: 30_000, amount_cents: 30_000 },
    { kind: 'item', description: 'Platform fee', quantity: 1, unit_cents: 5_000, amount_cents: 5_000 },
    { kind: 'usage', description: 'AI usage — October 2026', quantity: 1, unit_cents: 1_575, amount_cents: 1_575, usage: {
      month: '2026-10', total_micro_usd: 15_750_000, calls: 3, input_tokens: 509_000, output_tokens: 71_000,
      by_kind: [{ key: 'assistant_chat', calls: 2, input_tokens: 409_000, output_tokens: 51_000, cost_micro_usd: 12_250_000 }],
      by_model: [{ key: 'anthropic/claude-sonnet-5', calls: 2, input_tokens: 409_000, output_tokens: 51_000, cost_micro_usd: 12_250_000 }],
      by_member: [{ key: '', calls: 1, input_tokens: 100_000, output_tokens: 20_000, cost_micro_usd: 3_500_000 }],
    } },
  ],
  notes: 'Bank X <b>CBU</b> 000123', due_at: '2026-11-10T00:00:00.000Z', issued_at: '2026-11-02T12:00:00.000Z',
  receipt: { name: 'Factura A-0001.pdf', type: 'application/pdf' }, proof: null, paid_at: null, payment_reference: null,
  created_at: '2026-11-02T12:00:00.000Z',
};

describe('Admin Billing section', () => {
  it('stays hidden for a workspace admin with no invoices', async () => {
    const m = mount('en', { invoices: [], can_manage: false });
    await m.run();
    expect(m.wrap.hidden).toBe(true);
    expect(m.mountEl.innerHTML).toBe('');
  });

  it('stays hidden when the list is refused (a member)', async () => {
    const m = mount('en', null);
    await m.run();
    expect(m.wrap.hidden).toBe(true);
  });

  it('shows a workspace admin the bill, the usage breakdown, the receipt and the proof upload — no operator actions', async () => {
    const m = mount('en', { invoices: [invoice], can_manage: false });
    await m.run();
    const html = m.mountEl.innerHTML;
    expect(m.wrap.hidden).toBe(false);
    expect(html).toContain('INV-2026-0001');
    expect(html).toContain('Platform setup');
    expect(html).toContain('$365.75');
    expect(html).toContain('data-inv-status="open"');
    expect(html).toContain('Assistant chat');
    expect(html).toContain('anthropic/claude-sonnet-5');
    expect(html).toContain('Automations / no member');
    expect(html).toContain('href="/v1/workspaces/w/invoices/inv_1/receipt"');
    expect(html).toContain('data-inv-up="proof"');
    expect(html).toContain('Bank X &lt;b&gt;CBU&lt;/b&gt; 000123');
    expect(html).not.toContain('data-inv-act=');
    expect(html).not.toContain('wsxBillForm');
  });

  it('gives the operator the form and the paid/void actions', async () => {
    const m = mount('en', { invoices: [invoice], can_manage: true });
    await m.run();
    const html = m.mountEl.innerHTML;
    expect(html).toContain('id="wsxBillNewBtn"');
    expect(html).toContain('id="wsxBillForm"');
    expect(html).toContain('data-inv-act="paid"');
    expect(html).toContain('data-inv-act="void"');
    expect(html).toContain('data-inv-up="receipt"');
  });

  it('speaks Spanish', async () => {
    const m = mount('es', { invoices: [invoice], can_manage: false });
    await m.run();
    expect(m.mountEl.innerHTML).toContain('Sin pagar');
    expect(m.mountEl.innerHTML).toContain('Adjuntar comprobante de transferencia');
  });
});
