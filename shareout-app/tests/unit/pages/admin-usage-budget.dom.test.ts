// Admin → Usage: the monthly AI budget card, spend by kind and today's caps (admin-usage.ts) run in the
// browser; evaluate the fragment with stubs and check the markup and the save call.
import { describe, expect, it } from 'vitest';
import { workspace_client_home_views_adminUsage_JS as USAGE } from '../../../src/pages/home/render-workspace/client-script/home-views/admin-usage';
import { ADMIN_COPY } from '../../../src/pages/home/home-i18n/copy/admin';

const copy = (ADMIN_COPY as unknown as Record<string, Record<string, string>>);
const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mount(lang: 'en' | 'es', responses: Record<string, unknown>) {
  const els: Record<string, { innerHTML?: string; value?: string; listeners: Record<string, () => void>; querySelectorAll: () => never[]; addEventListener: (e: string, f: () => void) => void }> = {};
  const el = (id: string) => (els[id] ??= { value: '', listeners: {}, querySelectorAll: () => [], addEventListener(e, f) { this.listeners[e] = f; } });
  el('wsxAdminMount');
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const toasts: string[] = [];
  const fetchStub = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(responses).find((k) => url.includes(k));
    return Promise.resolve({ ok: !!key, json: () => Promise.resolve(key ? responses[key] : null) });
  };
  const t = (k: string) => copy[lang]?.[k] ?? k;
  const run = new Function('document', 'fetch', 'esc', 't', 'tOr', 'needWs', 'wsUrl', 'swr', 'i18nEmpty', 'adCompact', 'showToast', 'adM',
    `${USAGE}; return adUsage;`);
  const painted: Promise<unknown>[] = [];
  const swr = (_k: string, paint: (d: unknown) => void, fetcher: () => Promise<unknown>) => { painted.push(fetcher().then(paint)); };
  const adUsage = run(
    { getElementById: (id: string) => (id === 'wsxAdminMount' || els[id] ? el(id) : (el(id) as unknown)) },
    fetchStub, esc, t, (k: string, d: string) => (t(k) === k ? d : t(k)), () => false,
    (p: string) => `/v1/workspaces/w/${p.replace(/^\//, '')}`, swr, (k: string) => `<empty>${t(k)}</empty>`,
    (n: number) => String(n), (m: string) => toasts.push(m), () => el('wsxAdminMount'));
  return { adUsage, el, els, calls, toasts, done: () => Promise.all(painted) };
}

const limits = {
  month_spend_usd: 82.5, budget_usd: 100, pct: 82, budget_state: 'near', budget_resets_at: '2026-11-01T00:00:00.000Z',
  member_daily_cap: 300000, resets_at: '2026-10-26T00:00:00.000Z',
  me: { tokens_today: 1200 }, automation: { tokens_today: 5000, daily_cap: 1000000 },
};
const adminLimits = {
  ...limits,
  spend_by_kind: [{ kind: 'crew_run', usd: 60 }, { kind: 'mystery_kind', usd: 22.5 }],
  members: [{ user_id: 'u1', email: 'ana@x.com', tokens_today: 900 }, { user_id: 'u2', email: 'bo@x.com', tokens_today: 0 }],
};

describe('Admin Usage: AI budget', () => {
  it('shows the card with an 80% marker, state, spend by kind and every member for an admin', async () => {
    const m = mount('en', { '/spend': { totalMicroUsd: 0, days: [] }, '/ai-limits': adminLimits });
    m.adUsage();
    await m.done();
    const html = m.els.wsxAdminMount.innerHTML!;
    expect(html).toContain('$82.50 of $100.00');
    expect(html).toContain('wsx-admin__budgetmark');
    expect(html).toContain('aria-valuenow="82"');
    expect(html).toContain('is-near');
    expect(html).toContain('Near the limit');
    expect(html).toContain('id="wsxBudgetSave"');
    expect(html).toContain('Automations (crews)');
    expect(html).toContain('mystery_kind');
    expect(html).toContain('ana@x.com');
    expect(html).toContain('bo@x.com');
    expect(html).toContain('Automations (API and agent tokens)');
  });

  it('shows a member only their own row, no edit control and no per-kind table', async () => {
    const m = mount('es', { '/spend': { days: [] }, '/ai-limits': limits });
    m.adUsage();
    await m.done();
    const html = m.els.wsxAdminMount.innerHTML!;
    expect(html).toContain('Vos');
    expect(html).not.toContain('ana@x.com');
    expect(html).not.toContain('wsxBudgetSave');
    expect(html).not.toContain('IA por tipo');
    expect(html).toContain('Cerca del límite');
  });

  it('states the pause when reached and when no budget is set', async () => {
    const reached = mount('en', { '/spend': { days: [] }, '/ai-limits': { ...adminLimits, month_spend_usd: 100, pct: 100, budget_state: 'reached' } });
    reached.adUsage(); await reached.done();
    expect(reached.els.wsxAdminMount.innerHTML).toContain('Limit reached: new AI work is paused until Nov 1');
    expect(reached.els.wsxAdminMount.innerHTML).toContain('is-reached');
    const none = mount('en', { '/spend': { days: [] }, '/ai-limits': { ...adminLimits, budget_usd: null, pct: null, budget_state: 'none' } });
    none.adUsage(); await none.done();
    expect(none.els.wsxAdminMount.innerHTML).toContain('No budget set');
    expect(none.els.wsxAdminMount.innerHTML).not.toContain('wsx-admin__budgetbar');
  });

  it('saves a valid amount with PUT /llm/budget and refuses an invalid one without calling', async () => {
    const m = mount('en', { '/spend': { days: [] }, '/ai-limits': adminLimits, '/llm/budget': { ok: true } });
    m.adUsage();
    await m.done();
    m.el('wsxBudgetUsd').value = '0';
    m.el('wsxBudgetSave').listeners.click();
    expect(m.toasts).toEqual(['Enter an amount above 0 and up to 100,000']);
    m.el('wsxBudgetUsd').value = '250';
    m.el('wsxBudgetSave').listeners.click();
    const put = m.calls.find((c) => c.init?.method === 'PUT')!;
    expect(put.url).toContain('/llm/budget');
    expect(JSON.parse(put.init!.body as string)).toEqual({ monthlyBudgetUsd: 250 });
  });
});
