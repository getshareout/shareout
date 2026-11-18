// Admin → Summary (admin-summary.ts) and Billing → Billing details (admin-billing-profile.ts) run in the browser:
// evaluate each fragment in a real DOM with the shell helpers stubbed, then check what people see and send.
import { beforeEach, describe, expect, it } from 'vitest';
import { workspace_client_home_views_adminSummary_JS as SUMMARY } from '../../../src/pages/home/render-workspace/client-script/home-views/admin-summary';
import { workspace_client_home_views_adminBillingProfile_JS as PROFILE } from '../../../src/pages/home/render-workspace/client-script/home-views/admin-billing-profile';
import { BILLING_COPY } from '../../../src/pages/home/render-workspace/client-script/home-views/admin-billing-copy';

const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const flush = () => new Promise((r) => setTimeout(r, 0));
type Call = { url: string; init?: RequestInit };

function shell(responses: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  document.body.innerHTML = '<div id="root"><div data-ad-gate="summary" hidden></div><button data-ad-gate="summary" hidden></button><div id="wsxAdSec_summary"></div><div id="wsxAdSec_billprofile"></div></div>';
  const calls: Call[] = [], toasts: string[] = [], opened: string[] = [];
  const fetchStub = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses(url, init);
    return Promise.resolve({ ok: r.status < 400, status: r.status, json: () => Promise.resolve(r.body) });
  };
  const helpers: Record<string, unknown> = {
    document, fetch: fetchStub, window: { WSX_WS: 'w' }, ws: document.getElementById('root'), esc, t: (k: string) => k,
    wsUrl: (p: string) => `/v1/workspaces/w${p}`, needWs: () => false, adM: (k: string) => document.getElementById('wsxAdSec_' + k),
    swr: (_k: string, paint: (d: unknown) => void, fetcher: () => Promise<unknown>) => { fetcher().then(paint); },
    i18nEmpty: (k: string) => `<div class="wsx-empty">${k}</div>`, i18nSpin: () => '<span>…</span>',
    adCard: (l: string, v: string, s: string) => `<div class="wsx-admin__card"><div class="lbl">${esc(l)}</div><div class="val">${v}</div><div class="sub">${s || ''}</div></div>`,
    adRelDate: (iso: string) => (iso ? 'ago' : '—'), spark: (d: unknown[]) => `<div class="wsx-spark" data-n="${d.length}"></div>`, locTag: () => 'en-US',
    sortCmp: (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))),
    adOpen: (k: string) => opened.push(k), showToast: (m: string) => toasts.push(m), adBusy: () => {}, adIdle: () => {},
    adReq: (url: string, init: RequestInit) => fetchStub(url, init).then((r) => (r.ok ? r.json() : Promise.reject(new Error('x')))),
    adDataCache: {}, adCacheWs: 'w', bt: (k: string) => BILLING_COPY.en[k] ?? k, BILL_COPY: BILLING_COPY,
  };
  const names = Object.keys(helpers);
  const run = new Function(...names, `${SUMMARY}\n${PROFILE}\nreturn { adSummary, adSummaryGate, adBillProfile };`);
  return { ...(run(...names.map((n) => helpers[n])) as { adSummary: () => void; adSummaryGate: () => void; adBillProfile: () => void }), calls, toasts, opened };
}

const report = {
  month: '2026-10', months: ['2026-11', '2026-10', '2026-09'], can_manage: true,
  totals: { month: '2026-10', active_people: 3, views: 7, readers: 4, publishes: 4, pages_created: 2, ai_questions: 3, ai_spend_usd: 5.25 },
  previous: { month: '2026-09', active_people: 2, views: 1, readers: 1, publishes: 1, pages_created: 1, ai_questions: 0, ai_spend_usd: 1.5 },
  people: { members: 4, active: 3, new_members: 2, outside_readers: 1 },
  visits: { views: 7, readers: 4, all_views: 10, daily: [{ day: '2026-10-03', views: 2 }], top_pages: [{ id: 'a1', name: 'Obra <Norte>', deleted: false, owner_email: 'o@x', owner_name: 'Owner', views: 6, readers: 3, last_viewed_at: '2026-10-09T00:00:00Z' }] },
  pages: { live: 2, created: 2, deleted: 1, publishes: 4, pages_updated: 3 },
  knowledge: { notes: { total: 3, added: 1, updated: 1 }, catalog: { total: 1, added: 1, updated: 0 }, files: { live: 2, added: 2 }, lookups: 1 },
  ai: { questions: 3, conversations: 2, spend_usd: 5.25, people: 2 },
  automations: { job_runs: 2, job_failed: 1, crew_runs: 0, crew_failed: 0, emails_sent: 0 },
  members: [
    { user_id: 'u1', name: 'Ana', email: 'ana@x', role: 'admin', views: 3, pages_created: 1, publishes: 2, ai_questions: 2, knowledge_lookups: 0, ai_spend_usd: 3, files: 0, comments: 0, last_active_at: '2026-10-07T00:00:00Z' },
    { user_id: 'u2', name: 'Beto', email: 'beto@x', role: 'member', views: 9, pages_created: 0, publishes: 0, ai_questions: 0, knowledge_lookups: 0, ai_spend_usd: 0, files: 2, comments: 1, last_active_at: '2026-10-08T00:00:00Z' },
    { user_id: 'u3', name: 'Ciro', email: 'ciro@x', role: 'admin', views: 0, pages_created: 0, publishes: 0, ai_questions: 0, knowledge_lookups: 0, ai_spend_usd: 0, files: 0, comments: 0, last_active_at: null },
  ],
  outside: { people: 1, views: 2, top: [{ email: 'reader@partner', views: 2, last_at: '2026-10-09T00:00:00Z' }] },
};
const viewers = [
  { user_id: 'o', role: 'owner', email: 'o@x', name: 'Owner', can_view: true },
  { user_id: 'u1', role: 'admin', email: 'ana@x', name: 'Ana', can_view: false },
  { user_id: 'u3', role: 'admin', email: 'ciro@x', name: 'Ciro', can_view: true },
];

describe('Admin → Summary', () => {
  beforeEach(() => { document.documentElement.lang = 'en'; });

  it('shows the sidebar entry only when the API says this person may open it', async () => {
    for (const can of [true, false]) {
      const s = shell(() => ({ status: 200, body: { can_view: can, can_manage: false } }));
      s.adSummaryGate();
      await flush(); await flush();
      document.querySelectorAll('[data-ad-gate="summary"]').forEach((el) => expect((el as HTMLElement).hidden).toBe(!can));
    }
  });

  it('paints the month: KPIs with the change, reading, pages & knowledge, AI, members and outside readers', async () => {
    const s = shell((url) => ({ status: 200, body: url.includes('/viewers') ? { viewers } : report }));
    s.adSummary();
    await flush(); await flush();
    const box = document.getElementById('wsxAdSec_summary')!;
    const kpis = [...box.querySelectorAll('.wsx-admin__card .val')].map((v) => v.textContent);
    expect(kpis).toEqual(['3↑ 50%', '7↑ 600%', '4↑ 300%', '3']);
    expect(box.querySelector('#wsxSumMonth option[selected]')!.getAttribute('value')).toBe('2026-10');
    expect(box.innerHTML).toContain('Obra &lt;Norte&gt;');
    expect(box.querySelector('.wsx-spark')!.getAttribute('data-n')).toBe('31');
    expect(box.textContent).toContain('All views, anonymous included: 10');
    expect(box.textContent).toContain('$5.25');
    expect(box.textContent).toContain('Outside the team (1)');
    expect(box.textContent).toContain('reader@partner');
    const names = () => [...box.querySelectorAll('#wsxSumMemTbl tbody tr td:first-child .wsx-atbl__link')].map((x) => x.textContent);
    expect(names()).toEqual(['Beto', 'Ana', 'Ciro']); // last activity, newest first
    (box.querySelector('[data-ssort="views"]') as HTMLElement).click();
    expect(names()).toEqual(['Beto', 'Ana', 'Ciro']);
    (box.querySelector('[data-ssort="name"]') as HTMLElement).click();
    expect(names()).toEqual(['Ana', 'Beto', 'Ciro']);
    (box.querySelector('[data-sum-go="billing"]') as HTMLElement).click();
    expect(s.opened).toEqual(['billing']);
  });

  it('lets the owner pick which admins see it; the owner stays on', async () => {
    const s = shell((url, init) => ({
      status: 200,
      body: url.includes('/viewers') ? { viewers: init?.method === 'PUT' ? viewers.map((v) => ({ ...v, can_view: v.role === 'owner' || v.user_id === 'u1' || v.user_id === 'u3' })) : viewers } : report,
    }));
    s.adSummary();
    await flush(); await flush(); await flush();
    const boxes = [...document.querySelectorAll<HTMLInputElement>('[data-sum-who]')];
    expect(boxes.map((b) => [b.getAttribute('data-sum-who'), b.checked, b.disabled])).toEqual([['o', true, true], ['u1', false, false], ['u3', true, false]]);
    boxes[1]!.checked = true;
    boxes[1]!.dispatchEvent(new Event('change'));
    await flush(); await flush();
    const putCall = s.calls.find((c) => c.init?.method === 'PUT')!;
    expect(putCall.url).toBe('/v1/workspaces/w/summary/viewers');
    expect(JSON.parse(String(putCall.init!.body))).toEqual({ user_ids: ['u1', 'u3'] });
    expect(s.toasts).toEqual(['Saved']);
  });

  it('says who can see it instead of the report when the API refuses', async () => {
    const s = shell(() => ({ status: 403, body: { error: 'Forbidden' } }));
    s.adSummary();
    await flush(); await flush();
    expect(document.getElementById('wsxAdSec_summary')!.textContent).toBe('Only the workspace owner and the admins they choose can see this summary.');
  });
});

describe('Admin → Billing → Billing details', () => {
  const saved = {
    country: 'AR', legal_name: 'Acme S.A.', tax_id: '33693450239', tax_id_display: '33-69345023-9', tax_condition: 'responsable_inscripto',
    address: 'Av. Corrientes 1234', city: 'CABA', province: 'Buenos Aires', postal_code: 'C1043AAK', phone: '+54 11 4321-5678',
    billing_email: null, updated_at: '2026-11-04T10:00:00Z', updated_by_email: 'admin@acme',
  };
  const conds = ['responsable_inscripto', 'monotributo', 'exento', 'consumidor_final'];

  it('opens on the form when empty, and marks each field the API refuses', async () => {
    const s = shell((_url, init) => (init?.method === 'PUT'
      ? { status: 400, body: { success: false, code: 'VALIDATION_ERROR', fields: { tax_id: 'invalid', phone: 'required' } } }
      : { status: 200, body: { profile: null, can_edit: true, tax_conditions: conds } }));
    s.adBillProfile();
    await flush(); await flush();
    const form = document.getElementById('wsxBpForm') as HTMLFormElement;
    expect(form).toBeTruthy();
    expect((form.elements.namedItem('country') as HTMLSelectElement).value).toBe('AR');
    expect(form.querySelector('[data-bp-f="tax_condition"]')!.hasAttribute('hidden')).toBe(false);
    (form.elements.namedItem('tax_id') as HTMLInputElement).value = '33-69345023-8';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush(); await flush();
    const put = s.calls.find((c) => c.init?.method === 'PUT')!;
    expect(JSON.parse(String(put.init!.body))).toMatchObject({ country: 'AR', tax_id: '33-69345023-8' });
    expect(form.querySelector('[data-bp-f="tax_id"]')!.classList.contains('is-bad')).toBe(true);
    expect(form.querySelector('[data-bp-err="tax_id"]')!.textContent).toBe(BILLING_COPY.en['admin.bpErr_tax_id_AR']);
    expect(form.querySelector('[data-bp-err="phone"]')!.textContent).toBe('Required');
    (form.elements.namedItem('country') as HTMLSelectElement).value = 'US';
    form.elements.namedItem('country')!.dispatchEvent(new Event('change'));
    expect(form.querySelector('[data-bp-f="tax_condition"]')!.hasAttribute('hidden')).toBe(true);
    expect(form.querySelector('[data-bp-f="tax_id"] .wsx-field__lbl')!.textContent).toBe('Tax ID');
  });

  it('shows saved details read-only with the formatted CUIT, and edits them', async () => {
    const s = shell(() => ({ status: 200, body: { profile: saved, can_edit: true, tax_conditions: conds } }));
    s.adBillProfile();
    await flush(); await flush();
    const card = document.getElementById('wsxBillProfile')!;
    expect(card.textContent).toContain('33-69345023-9');
    expect(card.textContent).toContain('Responsable inscripto');
    expect(card.textContent).toContain('Av. Corrientes 1234, CABA, Buenos Aires, C1043AAK');
    expect(document.getElementById('wsxBpForm')).toBeNull();
    (document.getElementById('wsxBpEdit') as HTMLElement).click();
    const form = document.getElementById('wsxBpForm') as HTMLFormElement;
    expect((form.elements.namedItem('tax_id') as HTMLInputElement).value).toBe('33-69345023-9');
    expect((form.elements.namedItem('tax_condition') as HTMLSelectElement).value).toBe('responsable_inscripto');
  });
});
