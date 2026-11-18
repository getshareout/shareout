// @vitest-environment happy-dom
//
// Inspector → Automate → "Update by email": one question (who sends the file, the viewer's own
// address pre-filled), then the address with a copy button, who may send, the last update and the
// last email. Errors say what to do in the viewer's words.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace_client_home_views_modalsForms_JS as modalsJs } from '../../../src/pages/home/render-workspace/client-script/home-views/modals-forms';
import { workspace_client_home_views_emailSync_JS as emailSyncJs } from '../../../src/pages/home/render-workspace/client-script/home-views/email-sync';
import { LAZY_CHUNKS } from '../../../src/pages/home/render-workspace/client-script/lazy-chunks';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';

const copy = HOME_COPY.en as Record<string, string>;
const ADDRESS = 'ventas-x1@inbox.shareout.site';
let fetchMock: ReturnType<typeof vi.fn>;
let sent: Array<{ url: string; method: string; body: unknown }>;
let status: Record<string, unknown>;
const toast = vi.fn();
const writeText = vi.fn(async () => undefined);

function load(): { openEmailSync: (art: { id: string; name: string }, onDone?: () => void) => void } {
  const win = globalThis.window as unknown as Record<string, unknown>;
  const scope = new Proxy({}, {
    has: () => true,
    get: (target: Record<string | symbol, unknown>, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'window') return win;
      if (prop === 't') return (k: string) => copy[k] ?? k;
      if (prop === 'esc') return (s: unknown) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      if (prop === 'fetch') return (...a: unknown[]) => fetchMock(...a);
      if (prop === 'wsxToast') return toast;
      if (prop === 'locTag') return () => 'en-US';
      if (prop === 'i18nLoad') return () => '<p>Loading…</p>';
      if (prop === 'navigator') return { clipboard: { writeText } };
      if (prop in globalThis) return (globalThis as Record<string, unknown>)[prop];
      return () => '';
    },
  });
  return new Function('scope', `with (scope) {\n${modalsJs}\n${emailSyncJs}\n; return { openEmailSync }; }`)(scope);
}

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const modalText = () => document.querySelector('.wsx-modal')!.textContent || '';
const btn = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.wsx-modal button')].find((b) => b.textContent === label)!;

const NOT_SET = { address: null, senders: [], datasets: ['ventas'], reads: null, suggestedDataset: 'ventas', state: 'off', job: null, lastEmail: null, lastUpdate: null, lastRejected: null, you: 'leo@acme.com' };
const ON = (over: Record<string, unknown> = {}) => ({
  address: ADDRESS, senders: ['ana@acme.com'], datasets: ['ventas'], you: 'leo@acme.com',
  reads: ['ventas'], suggestedDataset: 'ventas', state: 'waiting_first_email', limits: { fileMb: 8, rows: 100000, mailMb: 25, perDay: 200 },
  job: { id: 'job_9', enabled: true, dataset: 'ventas', sheet: null, attachment: null, lastRunAt: null, lastStatus: null, lastError: null, datasetReadByPage: true },
  lastEmail: null, lastUpdate: null, lastRejected: null, ...over,
});

function routes(opts: { senders?: [unknown, number]; job?: [unknown, number] } = {}) {
  sent = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    sent.push({ url, method, body });
    if (url === '/v1/artifacts/art_1/email-sync' && method === 'GET') return json(status);
    if (url === '/v1/artifacts/art_1/email-sync/senders' && method === 'PUT') {
      if (opts.senders) return json(...opts.senders);
      status = { ...status, address: ADDRESS, senders: (body as { senders: string[] }).senders };
      return json({ address: ADDRESS, senders: (body as { senders: string[] }).senders });
    }
    if (url === '/v1/jobs' && method === 'POST') {
      if (opts.job) return json(...opts.job);
      status = ON({ senders: (status as { senders: string[] }).senders });
      return json({ job: { id: 'job_9' } }, 201);
    }
    if (url === '/v1/jobs/job_9' && method === 'DELETE') return json({ success: true });
    if (url === '/v1/jobs/job_9' && method === 'PATCH') { status = ON({ job: { ...(ON().job as object), ...(body as { config: object }).config, datasetReadByPage: true } }); return json({ job: { id: 'job_9' } }); }
    return json({ error: 'unexpected ' + url }, 404);
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  toast.mockReset(); writeText.mockClear();
  status = { ...NOT_SET };
  routes();
});

describe('Update by email', () => {
  it('is a lazy chunk', () => {
    expect(LAZY_CHUNKS.emailsync.exports).toEqual(['openEmailSync']);
  });

  it('asks one question with the viewer’s address already filled in; the rest is folded away', async () => {
    load().openEmailSync({ id: 'art_1', name: 'Ventas' }); await flush();
    expect($<HTMLInputElement>('#es_who').value).toBe('leo@acme.com');
    expect($<HTMLDetailsElement>('.wsx-adet__adv').open).toBe(false);
    expect($<HTMLInputElement>('#es_ds').value).toBe('ventas');
    // No jargon on screen.
    expect(modalText()).not.toMatch(/DMARC|DKIM|cron|job|OAuth|allowlist/i);
  });

  it('turns on: senders first, then the job; then shows the address ready to copy', async () => {
    const done = vi.fn();
    load().openEmailSync({ id: 'art_1', name: 'Ventas' }, done); await flush();
    $<HTMLInputElement>('#es_who').value = 'Ana@acme.com, leo@acme.com';
    btn(copy['esync.save']).click(); await flush();
    expect(sent.filter((s) => s.method !== 'GET').map((s) => [s.method, s.url, s.body])).toEqual([
      ['PUT', '/v1/artifacts/art_1/email-sync/senders', { senders: ['ana@acme.com', 'leo@acme.com'] }],
      ['POST', '/v1/jobs', { artifact_id: 'art_1', action: 'email_sheet_sync', trigger_type: 'event', event_type: 'email.received', config: { dataset: 'ventas' }, title: copy['esync.jobTitle'] }],
    ]);
    expect(done).toHaveBeenCalled();
    expect(modalText()).toContain(copy['esync.ready']);
    expect($('#es_addr').textContent).toBe(ADDRESS);
    btn(copy['esync.copy']).click(); await flush();
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    // The button itself says it worked.
    expect(document.querySelector('[data-es-copy]')!.textContent).toBe(copy['esync.copied']);
  });

  it('a typo in the address is caught before anything is saved, in one sentence', async () => {
    load().openEmailSync({ id: 'art_1', name: 'Ventas' }); await flush();
    $<HTMLInputElement>('#es_who').value = 'ana@acme';
    btn(copy['esync.save']).click(); await flush();
    expect($('#es_err').textContent).toBe(copy['esync.errEmail'].replace('{email}', 'ana@acme'));
    $<HTMLInputElement>('#es_who').value = '@gmail.com';
    btn(copy['esync.save']).click(); await flush();
    expect($('#es_err').textContent).toBe(copy['esync.errFreeMail'].replace('{email}', '@gmail.com'));
    expect($('#es_err').textContent).toContain('ana@gmail.com');
    expect(sent.some((s) => s.method !== 'GET')).toBe(false);
  });

  it('a name with a space is quoted whole, and the error goes away once the field changes', async () => {
    load().openEmailSync({ id: 'art_1', name: 'Ventas' }); await flush();
    const who = $<HTMLInputElement>('#es_who');
    who.value = 'juan perez';
    btn(copy['esync.save']).click(); await flush();
    expect($('#es_err').textContent).toBe(copy['esync.errEmail'].replace('{email}', 'juan perez'));
    who.value = 'juan@acme.com';
    who.dispatchEvent(new Event('input'));
    expect($('#es_err').textContent).toBe('');
    // Two addresses separated by a space still count as two.
    who.value = 'ana@acme.com bob@acme.com';
    btn(copy['esync.save']).click(); await flush();
    expect(sent.find((s) => s.method === 'PUT')!.body).toEqual({ senders: ['ana@acme.com', 'bob@acme.com'] });
  });

  it('a page that reads exactly one set of data: nothing asked, that one is used', async () => {
    status = { ...NOT_SET, reads: ['ventas_2026'], suggestedDataset: 'ventas_2026', datasets: ['otra'] };
    load().openEmailSync({ id: 'art_1', name: 'Ventas' }); await flush();
    expect(document.querySelector('#es_ds')).toBeNull();
    expect(modalText()).not.toContain(copy['esync.datasetAsk']);
    btn(copy['esync.save']).click(); await flush();
    expect(sent.find((s) => s.url === '/v1/jobs')!.body).toMatchObject({ config: { dataset: 'ventas_2026' } });
  });

  it('a page that reads several: asks which, in plain words, before turning on', async () => {
    status = { ...NOT_SET, reads: ['ventas', 'stock'], suggestedDataset: null };
    load().openEmailSync({ id: 'art_1', name: 'Ventas' }); await flush();
    const sel = $<HTMLSelectElement>('#es_ds');
    expect(sel.tagName).toBe('SELECT');
    expect([...sel.options].map((o) => o.value)).toEqual(['', 'ventas', 'stock']);
    expect(modalText()).toContain(copy['esync.datasetAsk']);
    btn(copy['esync.save']).click(); await flush();
    expect($('#es_err').textContent).toBe(copy['esync.errDataset']);
    expect(sent.some((s) => s.method !== 'GET')).toBe(false);
    sel.value = 'stock'; sel.dispatchEvent(new Event('change'));
    expect($('#es_err').textContent).toBe('');
    btn(copy['esync.save']).click(); await flush();
    expect(sent.find((s) => s.url === '/v1/jobs')!.body).toMatchObject({ config: { dataset: 'stock' } });
  });

  it('the file-name field means “starts with”: the * is added for you; sheet is “Excel sheet”', async () => {
    load().openEmailSync({ id: 'art_1', name: 'Ventas' }); await flush();
    expect(modalText()).toContain(copy['esync.sheet']);
    expect(modalText()).not.toMatch(/\*/);
    $<HTMLInputElement>('#es_att').value = 'ventas';
    $<HTMLInputElement>('#es_tab').value = 'Hoja1';
    btn(copy['esync.save']).click(); await flush();
    expect(sent.find((s) => s.url === '/v1/jobs')!.body).toMatchObject({ config: { dataset: 'ventas', sheet: 'Hoja1', attachment: 'ventas*' } });
  });

  it('already on for that data (409): shows the address instead of an error', async () => {
    routes({ job: [{ error: 'Already on', code: 'DUPLICATE_JOB', job_id: 'job_9' }, 409] });
    load().openEmailSync({ id: 'art_1', name: 'Ventas' }); await flush();
    status = ON();
    btn(copy['esync.save']).click(); await flush();
    expect($('#es_err')?.textContent || '').toBe('');
    expect($('#es_addr').textContent).toBe(ADDRESS);
  });

  it('ready screen: three steps, open my email, waiting for the first email, and an address that never breaks mid-name', async () => {
    status = ON();
    load().openEmailSync({ id: 'art_1', name: 'Ventas' }); await flush();
    const steps = [...document.querySelectorAll('.wsx-esync__steps li')].map((li) => li.textContent);
    expect(steps).toEqual([copy['esync.step1'], copy['esync.step2'].replace('{who}', 'ana@acme.com'), copy['esync.step3']]);
    expect($<HTMLAnchorElement>('[data-es-mailto]').getAttribute('href')).toBe('mailto:' + ADDRESS);
    expect($('#es_status').textContent).toContain(copy['esync.waiting']);
    expect(modalText()).toContain('Up to 8 MB and 100,000 rows');
    // Only one break opportunity, right after the @; each half is kept whole.
    expect($('#es_addr').querySelectorAll('wbr').length).toBe(1);
    expect([...$('#es_addr').querySelectorAll('.wsx-esync__nb')].map((n) => n.textContent)).toEqual(['ventas-x1', '@inbox.shareout.site']);
    // Turn on / Close stay in view: the footer is the sticky one.
    expect(document.querySelector('.wsx-esync__foot [data-es-close]')).not.toBeNull();
  });

  it('a page that does not show the chosen data says so, with a one-click fix', async () => {
    status = ON({ reads: ['ventas'], job: { ...(ON().job as object), dataset: 'data', datasetReadByPage: false } });
    load().openEmailSync({ id: 'art_1', name: 'Ventas' }); await flush();
    expect($('[data-es-dswarn]').textContent).toContain('doesn’t show “data”');
    btn(copy['esync.fixDs'].replace('{name}', 'ventas')).click(); await flush();
    expect(sent.find((s) => s.method === 'PATCH')).toEqual({ url: '/v1/jobs/job_9', method: 'PATCH', body: { config: { dataset: 'ventas' } } });
    expect(toast).toHaveBeenCalledWith(copy['esync.fixedDs'].replace('{name}', 'ventas'));
    expect(document.querySelector('[data-es-dswarn]')).toBeNull();
  });

  it('address switched off: says so and turns it back on with the same senders', async () => {
    status = ON({ address: null, state: 'inbox_off' });
    load().openEmailSync({ id: 'art_1', name: 'Ventas' }); await flush();
    expect($('[data-es-off]').textContent).toContain(copy['esync.inboxOff']);
    expect(document.querySelector('[data-es-copy]')).toBeNull();
    routes();
    status = ON({ address: null, state: 'inbox_off' });
    btn(copy['esync.turnBackOn']).click(); await flush();
    expect(sent.find((s) => s.method === 'PUT')!.body).toEqual({ senders: ['ana@acme.com'] });
    expect(toast).toHaveBeenCalledWith(copy['esync.backOn']);
  });

  it('a mail that was turned away shows who sent it and why', async () => {
    status = ON({ lastRejected: { from: 'eve@other.com', reason: 'not_allowed', at: new Date().toISOString(), message: 'eve@other.com isn’t on the list.' } });
    load().openEmailSync({ id: 'art_1', name: 'Ventas' }); await flush();
    expect($('[data-es-rejected]').textContent).toContain('An email from eve@other.com arrived but was not used: eve@other.com isn’t on the list.');
  });

  it('when on: shows the last update with its rows and the last email', async () => {
    const now = Math.floor(Date.now() / 1000);
    status = ON({
      job: { ...ON().job as object, lastRunAt: now, lastStatus: 'success' },
      lastUpdate: { rowCount: 365, file: 'ventas.xlsx', sheet: 'Ventas', at: new Date(now * 1000).toISOString() },
      lastEmail: { from: 'ana@acme.com', subject: 'Ventas', receivedAt: now, files: ['ventas.xlsx'] },
    });
    load().openEmailSync({ id: 'art_1', name: 'Ventas' }); await flush();
    expect(modalText()).toContain(copy['esync.sendTo']);
    expect($('#es_status').textContent).toMatch(/We got your file: 365 rows updated · today \d\d:\d\d/);
    expect($('#es_last').textContent).toMatch(/From ana@acme\.com · today \d\d?:\d\d( [AP]M)? · ventas\.xlsx/);
  });

  it('a failed file says why and that the page kept its data', async () => {
    status = ON({ job: { ...ON().job as object, lastRunAt: Math.floor(Date.now() / 1000), lastStatus: 'failed', lastError: 'The email had no file attached. Attach the Excel or CSV file and send it again.' } });
    load().openEmailSync({ id: 'art_1', name: 'Ventas' }); await flush();
    expect($('#es_status').textContent).toContain(copy['esync.failLine']);
    expect($('#es_status').textContent).toContain('Attach the Excel or CSV file and send it again.');
  });

  it('changing who may send saves the new list', async () => {
    status = ON();
    load().openEmailSync({ id: 'art_1', name: 'Ventas' }); await flush();
    btn(copy['esync.change']).click();
    $<HTMLInputElement>('#es_who2').value = 'ana@acme.com bob@acme.com';
    btn(copy['esync.saveSenders']).click(); await flush();
    expect(sent.find((s) => s.method === 'PUT')!.body).toEqual({ senders: ['ana@acme.com', 'bob@acme.com'] });
    expect(toast).toHaveBeenCalledWith(copy['esync.sendersSaved']);
  });

  it('stopping asks once more, then removes the job', async () => {
    status = ON();
    const done = vi.fn();
    load().openEmailSync({ id: 'art_1', name: 'Ventas' }, done); await flush();
    btn(copy['esync.stop']).click(); await flush();
    expect($('#es_err').textContent).toBe(copy['esync.stopConfirm']);
    expect(sent.some((s) => s.method === 'DELETE')).toBe(false);
    btn(copy['esync.stopSure']).click(); await flush();
    expect(sent.some((s) => s.method === 'DELETE' && s.url === '/v1/jobs/job_9')).toBe(true);
    expect(done).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(copy['esync.stopped']);
  });

  it('every esync key exists in English and Spanish', () => {
    const en = Object.keys(HOME_COPY.en).filter((k) => k.startsWith('esync.'));
    const es = Object.keys(HOME_COPY.es).filter((k) => k.startsWith('esync.'));
    expect(es.sort()).toEqual(en.sort());
    for (const k of emailSyncJs.match(/t\('(esync\.[^']+)'\)/g)!.map((m) => m.slice(3, -2))) expect(HOME_COPY.es[k], k).toBeTruthy();
  });
});
