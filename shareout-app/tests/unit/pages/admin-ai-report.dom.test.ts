// Admin → Billing → AI report (admin-ai-report.ts) runs in the browser; evaluate it with the billing fragment (it shares
// bt() and BILL_COPY) and stubs, and check what a workspace admin and the operator each see.
import { describe, expect, it } from 'vitest';
import { workspace_client_home_views_adminBilling_JS as BILLING } from '../../../src/pages/home/render-workspace/client-script/home-views/admin-billing';
import { workspace_client_home_views_adminAiReport_JS as REPORT } from '../../../src/pages/home/render-workspace/client-script/home-views/admin-ai-report';
import { ADMIN_COPY } from '../../../src/pages/home/home-i18n/copy/admin';

const copy = (ADMIN_COPY as unknown as Record<string, Record<string, string>>);
const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mount(lang: 'en' | 'es', body: unknown) {
  const mountEl = { innerHTML: '' };
  const t = (k: string) => copy[lang]?.[k] ?? k;
  const urls: string[] = [];
  const run = new Function('document', 'fetch', 'window', 'esc', 't', 'tOr', 'needWs', 'wsUrl', 'swr', 'i18nEmpty', 'adCompact', 'showToast', 'adM', 'adBusy', 'adIdle', 'adDataCache',
    `${BILLING}${REPORT}; return adAiReport;`);
  const painted: Promise<unknown>[] = [];
  const swr = (_k: string, paint: (d: unknown) => void, fetcher: () => Promise<unknown>) => { painted.push(fetcher().then(paint)); };
  const adAiReport = run(
    { documentElement: { lang }, getElementById: () => null },
    (url: string) => { urls.push(url); return Promise.resolve({ ok: body != null, json: () => Promise.resolve(body) }); },
    {}, esc, t, (k: string, d: string) => (t(k) === k ? d : t(k)), () => false,
    (p: string) => `/v1/workspaces/w${p}`, swr, (k: string) => `<empty>${t(k)}</empty>`,
    (n: number) => String(n), () => {}, () => mountEl, () => {}, () => {}, {});
  return { run: () => { adAiReport(); return Promise.all(painted); }, mountEl, urls };
}

const row = (key: string, price: number, extra: Record<string, unknown> = {}) => ({ key, calls: 3, input_tokens: 1200, output_tokens: 80, tokens: 1280, price_micro_usd: price, ...extra });
const report = (operator: boolean) => {
  const c = (cost: number) => (operator ? { cost_micro_usd: cost } : {});
  return {
    month: '2026-10', operator, ...(operator ? { markup_bps: 15_000 } : {}),
    totals: { ...row('total', 32_234_700), calls: 21, ...c(21_489_800) },
    by_category: [row('automations', 9_000_000, c(6_000_000)), row('questions', 6_000_000, c(4_000_000))],
    by_model: [row('anthropic/claude-sonnet-5.5', 20_000_000, c(13_333_333))],
    by_automation: [row('crew_x', 9_000_000, { label: 'Resumen diario', runs: 44, ...c(6_000_000) }), row('', 100, { label: null, runs: 1, ...c(67) })],
    by_page: [row('art_1', 3_000_000, { label: 'Tablero <SGI>', ...c(2_000_000) })],
    by_member: [row('usr_a', 4_000_000, { label: 'ana@acme.test', ...c(2_666_667) }), row('', 2_000_000, { label: null, ...c(1_333_333) })],
    by_kind: [row('crew_run', 9_000_000, c(6_000_000))],
    by_day: [row('2026-10-03', 1_000_000, c(666_667))],
  };
};

describe('Admin Billing → AI report', () => {
  it('shows a workspace admin the month at their price, every breakdown, and no cost', async () => {
    const m = mount('es', report(false));
    await m.run();
    const html = m.mountEl.innerHTML;
    expect(m.urls[0]).toMatch(/^\/v1\/workspaces\/w\/ai-report\?month=\d{4}-\d{2}$/);
    expect(html).toContain('Reporte de IA');
    expect(html).toContain('$32.23');
    expect(html).toContain('1200 de entrada · 80 de salida');
    for (const k of ['category', 'model', 'automation', 'page', 'member', 'kind', 'day']) expect(html).toContain(`data-air="${k}"`);
    expect(html).toContain('Automatizaciones');
    expect(html).toContain('Preguntas al asistente');
    expect(html).toContain('anthropic/claude-sonnet-5.5');
    expect(html).toContain('Tokens de entrada');
    expect(html).toContain('Resumen diario');
    expect(html).toContain('Automatización borrada');
    expect(html).toContain('Tablero &lt;SGI&gt;');
    expect(html).toContain('Automatizaciones / sin miembro');
    expect(html).toContain('Automatizaciones (crews)');
    expect(html).toContain('format=csv');
    expect(html).not.toContain('data-op-note');
    expect(html).not.toContain('data-op-cost');
    expect(html).not.toContain('data-op-badge');
    expect(html).not.toMatch(/markup|Nuestro costo|Margen/i);
  });

  it('adds cost and margin for the operator, marked super admins only', async () => {
    const m = mount('en', report(true));
    await m.run();
    const html = m.mountEl.innerHTML;
    expect(html).toMatch(/data-op-note><span class="wsx-opbadge" data-op-badge>Super admins only<\/span> Cost \$21\.49 · markup 1\.5× · margin \$10\.74/);
    expect(html).toContain('data-op-cost');
    expect(html).toContain('Our cost');
  });

  it('says so when the month had no AI, and when it could not load', async () => {
    const empty = mount('en', { month: '2026-10', operator: false, totals: row('total', 0, { calls: 0 }), by_category: [], by_model: [], by_automation: [], by_page: [], by_member: [], by_kind: [], by_day: [] });
    await empty.run();
    expect(empty.mountEl.innerHTML).toMatch(/No AI use in /);
    const failed = mount('en', null);
    await failed.run();
    expect(failed.mountEl.innerHTML).toContain('common.couldNotLoad');
  });
});
