// What the end-to-end test of "Actualizar por email" found (2026-11-18): the silent failures and the
// places a person or an assistant got stuck. Real D1/R2/MiniDB, the real routes, the real inbound
// handler and the real MCP tools; only the session lookup and the owner email are stubbed.
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
import { disableInbound, getInboxStatus } from '../../../src/email/inbox-store';
import { routeEmailSyncApi } from '../../../src/router/api/email-sync';
import { handleInbox } from '../../../src/data/inbox/handler';
import { createFetchContext } from '../../../src/router/context';
import { handleCreateJob, handleDeleteJob, handleRunJob } from '../../../src/scheduling/handler';
import { writeDatasetRows } from '../../../src/data/datasets/handler';
import { callTool } from '../../../src/mcp/tools';
import { buildResult } from '../../../src/verify/report';
import { sheetRows } from '../../../src/data/files/sheet-rows';
import type { AuthUser } from '../../../src/api-auth';
import type { DataContext } from '../../../src/data/middleware';
import type { PageSignals } from '../../../src/verify/types';

const OWNER = 'usr_esf_owner';
const WS = 'wsp_esf';
const SENDER = 'ana@acme.test';
const CF_PASS = 'mx.cloudflare.net; dkim=pass header.d=acme.test; dmarc=pass header.from=acme.test; spf=pass smtp.mailfrom=ana@acme.test';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const owner: AuthUser = { id: OWNER, email: `${OWNER}@esf.test`, username: null };

let seq = 0;

/** A published page whose script reads the given datasets with sdk.dataset('…'). */
async function page(id: string, reads: string[]) {
  const html = `<!doctype html><html><body><table id="t"></table><script src="/sdk/shareout.js"></script><script>
(async () => { const sdk = await ShareOut.create();${reads.map((r) => ` const ${r.replace(/\W/g, '_')} = await sdk.dataset('${r}').get();`).join('')} })();
</script></body></html>`;
  const ver = `ver_${id}`;
  await e.ARTIFACTS.put(`a/${id}/index.html`, html);
  await e.DB.batch([
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, ?, ?, ?, ?, 'private')").bind(id, `Page ${id}`, `s-${id}`, OWNER, WS),
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, 'index.html', '{}')").bind(ver, id),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', ?)").bind(`dep_${id}`, id, ver, `s-${id}`),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, 'index.html', ?, 'text/html', ?, 'x')").bind(`ast_${id}`, ver, `a/${id}/index.html`, html.length),
  ]);
}

const as = (u: AuthUser) => { getSessionUser.mockReset().mockResolvedValue({ id: u.id, email: u.email }); validateToken.mockReset().mockResolvedValue(u); };
const api = (artifactId: string, method = 'GET', body?: unknown, sub = '') => routeEmailSyncApi(createFetchContext(new Request(`https://shareout.test/v1/artifacts/${artifactId}/email-sync${sub}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}), e)).then(async (r) => ({ status: r!.status, body: (await r!.json()) as Record<string, any> }));
const createJob = (artifactId: string, config: Record<string, unknown>) => handleCreateJob(new Request('https://shareout.test/v1/jobs', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ artifact_id: artifactId, action: 'email_sheet_sync', trigger_type: 'event', event_type: 'email.received', config, title: 'Actualizar por email' }),
}), e, { id: OWNER, email: owner.email } as never).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, any> }));
const inbox = (artifactId: string, sub: string, method = 'POST', body?: unknown) => handleInbox(
  new Request(`https://shareout.test/v1/data/${artifactId}/inbox${sub}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
  { env: e, artifactId, workspaceId: WS, origin: 'https://shareout.test' } as unknown as DataContext,
  sub,
);
const mcp = (name: string, args: Record<string, unknown>) => {
  as(owner);
  return callTool({ env: e, user: owner, origin: 'https://shareout.test', authorization: 'Bearer so_test' }, name, args).then((r) => r!);
};
const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((c) => c.text ?? '').join(' ');
const jobsOn = (artifactId: string) => e.DB.prepare("SELECT id, config, last_status, last_error, last_run_at FROM scheduled_jobs WHERE artifact_id = ? AND action = 'email_sheet_sync'")
  .bind(artifactId).all<{ id: string; config: string; last_status: string | null; last_error: string | null; last_run_at: number | null }>().then((r) => r.results);

/** Turn it on the way the panel does: senders, then the job. */
async function turnOn(artifactId: string, dataset: string) {
  as(owner);
  const s = await api(artifactId, 'PUT', { senders: [SENDER] }, '/senders');
  expect(s.status).toBe(200);
  const j = await createJob(artifactId, { dataset });
  expect(j.status).toBe(201);
  return { address: String(s.body.address), jobId: String(j.body.job.id) };
}

function book(tabs: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(tabs)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/.{76}/g, '$&\r\n');
function mail(to: string, opts: { from?: string; auth?: string } = {}) {
  const from = opts.from ?? SENDER;
  const id = `esf${++seq}@acme.test`;
  const bytes = book({ Ventas: [['Producto', 'Monto'], ['Café', 12.5], ['Té verde', 1.75]] });
  const raw = `From: Ana <${from}>\r\nTo: ${to}\r\nSubject: x\r\nMessage-ID: <${id}>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nhola\r\n--b\r\nContent-Type: ${XLSX_MIME}; name="v.xlsx"\r\nContent-Disposition: attachment; filename="v.xlsx"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(bytes)}\r\n--b--\r\n`;
  return {
    to, from, rawSize: raw.length, raw: new Response(raw).body!, setReject: vi.fn(),
    headers: new Headers({ 'authentication-results': opts.auth ?? CF_PASS, 'message-id': `<${id}>` }),
  };
}
const send = async (m: ReturnType<typeof mail>) => { await handleInboundEmail(m as never, e, {} as ExecutionContext); return m; };

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(OWNER, owner.email, 'Owner'),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'ESF', 'esf-ws', ?)").bind(WS, OWNER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_esf', ?, ?, 'owner', 'internal')").bind(WS, OWNER),
  ]);
});

// Five new schedules per person per day: these tests make more than that.
beforeEach(async () => { dispatchLifecycleEmail.mockClear(); await e.DB.prepare('DELETE FROM rate_limits').run(); });

describe('P0-1 — the data the page actually reads', () => {
  it('status names what the page reads and suggests it, not the most recently written dataset', async () => {
    await page('art_esf_one', ['ventas_mes']);
    await writeDatasetRows(e, 'art_esf_one', 'otro', 'json', [{ a: 1 }]);
    as(owner);
    const st = await api('art_esf_one');
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ reads: ['ventas_mes'], suggestedDataset: 'ventas_mes', state: 'off' });
  });

  it('a page that reads several asks which; a page with no published version cannot tell', async () => {
    await page('art_esf_two', ['ventas', 'stock']);
    as(owner);
    expect((await api('art_esf_two')).body).toMatchObject({ reads: ['ventas', 'stock'], suggestedDataset: null });
    await e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES ('art_esf_draft', 'Draft', 's-draft', ?, ?, 'private')").bind(OWNER, WS).run();
    expect((await api('art_esf_draft')).body).toMatchObject({ reads: null, suggestedDataset: 'data' });
  });

  it('a job on a dataset the page does not read is created with a warning, and status flags it', async () => {
    await page('art_esf_mis', ['ventas_mes']);
    as(owner);
    await api('art_esf_mis', 'PUT', { senders: [SENDER] }, '/senders');
    const j = await createJob('art_esf_mis', { dataset: 'data' });
    expect(j.status).toBe(201);
    expect(j.body.warning).toMatch(/does not read “data”.*ventas_mes/);
    expect(j.body).toMatchObject({ senders: [SENDER] });
    expect(String(j.body.address)).toMatch(/@inbox\./);
    const st = await api('art_esf_mis');
    expect(st.body.job).toMatchObject({ dataset: 'data', datasetReadByPage: false });
  });

  it('MCP uses the one dataset the page reads, asks when there are several, and warns on a mismatch', async () => {
    await page('art_esf_mcp1', ['ventas_mes']);
    await writeDatasetRows(e, 'art_esf_mcp1', 'otro', 'json', [{ a: 1 }]);
    const on = await mcp('set_email_sync', { artifact_id: 'art_esf_mcp1', senders: [SENDER] });
    expect(on.isError).toBeFalsy();
    expect(on.structuredContent).toMatchObject({ dataset: 'ventas_mes' });

    await page('art_esf_mcp2', ['ventas', 'stock']);
    const ask = await mcp('set_email_sync', { artifact_id: 'art_esf_mcp2', senders: [SENDER] });
    expect(ask.isError).toBe(true);
    expect(ask.structuredContent).toMatchObject({ code: 'NEEDS_DATASET', options: ['ventas', 'stock'] });
    expect(await jobsOn('art_esf_mcp2')).toHaveLength(0);

    await page('art_esf_mcp3', ['ventas']);
    const warn = await mcp('set_email_sync', { artifact_id: 'art_esf_mcp3', senders: [SENDER], dataset: 'otra_cosa' });
    expect(warn.isError).toBeFalsy();
    expect(text(warn)).toMatch(/does not read “otra_cosa”/);
  });
});

describe('P0-2 — the address cannot be switched off under a running sync', () => {
  it('inbox/disable is refused while the page updates by email; the address stays on', async () => {
    await page('art_esf_off', ['ventas']);
    const { address } = await turnOn('art_esf_off', 'ventas');
    const res = await inbox('art_esf_off', '/disable');
    expect(res.status).toBe(409);
    const body = JSON.stringify(await res.json());
    expect(body).toContain('EMAIL_SYNC_ACTIVE');
    expect(body).toMatch(/updates its data by email, so its address has to stay on/);
    expect((await getInboxStatus(e, 'art_esf_off')).address).toBe(address);
  });

  it('an address that is off anyway (older data) shows as inbox_off with what to do; saving senders turns it back on', async () => {
    await disableInbound(e, 'art_esf_off');
    as(owner);
    const st = await api('art_esf_off');
    expect(st.body).toMatchObject({ state: 'inbox_off', address: null });
    expect(st.body.message).toMatch(/turn it back on/i);
    await api('art_esf_off', 'PUT', { senders: [SENDER] }, '/senders');
    expect((await api('art_esf_off')).body.state).toBe('waiting_first_email');
  });
});

describe('P0-3 — one email sync per page and dataset', () => {
  it('a second identical POST /v1/jobs is a 409 naming the existing job', async () => {
    await page('art_esf_dup', ['ventas']);
    const { jobId } = await turnOn('art_esf_dup', 'ventas');
    const again = await createJob('art_esf_dup', { dataset: 'ventas' });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'DUPLICATE_JOB', job_id: jobId });
    expect(await jobsOn('art_esf_dup')).toHaveLength(1);
  });
});

describe('P0-4 — verify does not fail a page that waits for its first file', () => {
  const signals = (url: string): PageSignals => ({
    viewport: 'desktop', entrypoint: 'index.html', loadMs: 100, pageErrors: [], console: [],
    requests: [{ url, method: 'GET', type: 'fetch', status: 404, code: 'DATASET_NOT_FOUND', count: 1 }],
    blocked: [], dialogs: [], storage: [], popups: 0, layout: null, design: null, axe: null,
    metrics: { lcpMs: null, cls: null, bytes: null, requests: 1 }, screenshot: null,
  });
  const base = { id: 'vfy', artifactId: 'art_x', versionNo: 1, versionId: 'ver_x', live: true, sourceIssues: [], screenshots: {}, thumbnailRefreshed: false, isPublic: false, lockCsp: false, startedAt: Date.now() };

  it('a dataset a sync fills that has no file yet is a note', () => {
    const r = buildResult({ ...base, signals: [signals('/v1/data/art_x/datasets/ventas/download-url')], awaitedDatasets: ['ventas'] });
    expect(r.status).toBe('pass');
    expect(r.issues[0]).toMatchObject({ severity: 'info', rule: 'dataset_waiting' });
    expect(r.issues[0].message).toMatch(/waiting for its first file/);
  });

  it('a dataset nothing fills is still an error (a wrong name)', () => {
    const r = buildResult({ ...base, signals: [signals('/v1/data/art_x/datasets/vemtas/download-url')], awaitedDatasets: ['ventas'] });
    expect(r.status).toBe('fail');
  });
});

describe('P0-5 — Run now does not mark the sync failed', () => {
  it('a manual run answers 409 NOT_RUNNABLE with the address and changes nothing', async () => {
    await page('art_esf_run', ['ventas']);
    const { jobId, address } = await turnOn('art_esf_run', 'ventas');
    const res = await handleRunJob(e, { id: OWNER, email: owner.email } as never, jobId);
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, any>;
    expect(body).toMatchObject({ code: 'NOT_RUNNABLE', address });
    const [job] = await jobsOn('art_esf_run');
    expect(job).toMatchObject({ last_status: null, last_error: null, last_run_at: null });
    expect(await e.DB.prepare('SELECT COUNT(*) AS n FROM job_runs WHERE job_id = ?').bind(jobId).first<{ n: number }>()).toMatchObject({ n: 0 });
  });
});

describe('P1-14 — set_email_sync does not replace data the page has without asking', () => {
  it('refuses DATASET_EXISTS until replace_existing is sent, and says it replaces', async () => {
    await page('art_esf_rep', ['ventas']);
    await writeDatasetRows(e, 'art_esf_rep', 'ventas', 'json', [{ a: 1 }, { a: 2 }]);
    const r = await mcp('set_email_sync', { artifact_id: 'art_esf_rep', senders: [SENDER] });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ code: 'DATASET_EXISTS', row_count: 2 });
    expect(await jobsOn('art_esf_rep')).toHaveLength(0);
    const ok = await mcp('set_email_sync', { artifact_id: 'art_esf_rep', senders: [SENDER], replace_existing: true });
    expect(ok.isError).toBeFalsy();
    expect(text(ok)).toMatch(/replaces the page’s data/);
  });
});

describe('P1-15 — a rejected email leaves a trace', () => {
  it('a sender not on the list is bounced and shows as lastRejected (panel + check_email_sync)', async () => {
    await page('art_esf_rej', ['ventas']);
    const { address } = await turnOn('art_esf_rej', 'ventas');
    const m = await send(mail(address, { from: 'otro@acme.test', auth: CF_PASS.replace(/ana@/g, 'otro@') }));
    expect(m.setReject).toHaveBeenCalledWith('Sender not permitted');
    as(owner);
    const st = await api('art_esf_rej');
    expect(st.body.lastRejected).toMatchObject({ from: 'otro@acme.test', reason: 'not_allowed' });
    expect(st.body.lastRejected.message).toMatch(/not on the list/);
    expect(text(await mcp('check_email_sync', { artifact_id: 'art_esf_rej' }))).toMatch(/otro@acme\.test.*not on the list/);
  });

  it('an allowed sender whose mail is not verified shows why', async () => {
    const { address } = (await api('art_esf_rej')).body as { address: string };
    const m = await send(mail(address, { auth: 'mx.cloudflare.net; dkim=none; dmarc=fail header.from=acme.test' }));
    expect(m.setReject).toHaveBeenCalledWith('Sender not permitted');
    as(owner);
    expect((await api('art_esf_rej')).body.lastRejected).toMatchObject({ from: SENDER, reason: 'unverified' });
  });

  it('a good file after that still updates the page (decimals and accents exact)', async () => {
    const { address } = (await api('art_esf_rej')).body as { address: string };
    const m = await send(mail(address));
    expect(m.setReject).not.toHaveBeenCalled();
    as(owner);
    const st = await api('art_esf_rej');
    expect(st.body).toMatchObject({ state: 'ok', lastUpdate: { rowCount: 2 } });
  });
});

describe('P1-12 — MCP ergonomics', () => {
  it('unknown arguments are refused by name', async () => {
    const r = await mcp('set_email_sync', { artifact_id: 'art_esf_one', sender: SENDER });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/unknown argument “sender”.*senders/);
  });

  it('a page link or slug works as the page; a name answers with matching pages', async () => {
    await page('art_esf_link', ['ventas']);
    const byLink = await mcp('check_email_sync', { artifact_id: 'https://shareout.test/a/s-art_esf_link/' });
    expect(text(byLink)).toMatch(/not updated by email/);
    const bySlug = await mcp('check_email_sync', { artifact_id: 's-art_esf_link' });
    expect(text(bySlug)).toMatch(/not updated by email/);
    const byName = await mcp('check_email_sync', { artifact_id: 'Page art_esf_link' });
    expect(byName.isError).toBe(true);
    expect(text(byName)).toMatch(/art_esf_link/);
    const none = await mcp('check_email_sync', { artifact_id: 'art_nope' });
    expect(none.structuredContent).toMatchObject({ code: 'NOT_FOUND' });
    expect(text(none)).toMatch(/No page/);
  });

  it('senders may be one string; the suggested sender is in the text; a repeat call changes nothing', async () => {
    await page('art_esf_str', ['nuevo']);
    const ask = await mcp('set_email_sync', { artifact_id: 'art_esf_str' });
    expect(text(ask)).toContain(owner.email);
    expect(ask.structuredContent).toMatchObject({ code: 'NEEDS_SENDERS' });
    const on = await mcp('set_email_sync', { artifact_id: 'art_esf_str', senders: SENDER });
    expect(on.isError).toBeFalsy();
    expect(on.structuredContent).toMatchObject({ senders: [SENDER], dataset: 'nuevo' });
    expect(text(on)).toMatch(/subject and text do not matter/i);
    expect(text(on)).toMatch(/https:\/\/shareout\.test\/a\/s-art_esf_str\//);
    const again = await mcp('set_email_sync', { artifact_id: 'art_esf_str', senders: [SENDER] });
    expect(text(again)).toMatch(/already on, nothing changed/i);
    expect(await jobsOn('art_esf_str')).toHaveLength(1);
  });
});

describe('P2-16 — the REST API names the documented call and says what to do', () => {
  it('a job before any sender points at PUT …/email-sync/senders with the real id', async () => {
    await page('art_esf_api', ['ventas']);
    as(owner);
    const j = await createJob('art_esf_api', { dataset: 'ventas' });
    expect(j.status).toBe(400);
    expect(j.body.code).toBe('NO_SENDERS');
    expect(j.body.error).toContain('PUT /v1/artifacts/art_esf_api/email-sync/senders');
    expect(j.body.error).not.toMatch(/inbox\/enable/);
  });

  it('a bad dataset name says what was wrong and suggests one', async () => {
    as(owner);
    await api('art_esf_api', 'PUT', { senders: SENDER }, '/senders');
    const j = await createJob('art_esf_api', { dataset: 'Ventas del mes' });
    expect(j.status).toBe(400);
    expect(j.body.code).toBe('BAD_DATASET_NAME');
    expect(j.body.error).toMatch(/spaces.*ventas_del_mes/);
  });

  it('senders: one string accepted, GET allowed; delete echoes the senders it keeps', async () => {
    as(owner);
    expect((await api('art_esf_api', 'PUT', { senders: SENDER }, '/senders')).body).toMatchObject({ senders: [SENDER] });
    const got = await api('art_esf_api', 'GET', undefined, '/senders');
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ senders: [SENDER] });
    const j = await createJob('art_esf_api', { dataset: 'ventas' });
    expect(j.status).toBe(201);
    const del = await handleDeleteJob(e, { id: OWNER, email: owner.email } as never, String(j.body.job.id));
    expect(await del.json()).toMatchObject({ success: true, senders_kept: [SENDER] });
  });

  it('status carries a state, a one-line message and the limits', async () => {
    as(owner);
    await createJob('art_esf_api', { dataset: 'ventas' });
    const st = await api('art_esf_api');
    expect(st.body).toMatchObject({ state: 'waiting_first_email', limits: { fileMb: 8, rows: 100000, mailMb: 25, perDay: 200 } });
    expect(st.body.message).toMatch(/No file has arrived yet/);
  });
});

describe('parked 02bcca4f — a CSV with a decimal comma', () => {
  it('reads 1,5 as 1.5 when the separator is a semicolon', async () => {
    const csv = new TextEncoder().encode('producto;monto;unidades\nCafé;1,5;1.234\nTé verde;12,75;3\n');
    const { rows } = await sheetRows(csv, '');
    expect(rows).toEqual([{ producto: 'Café', monto: 1.5, unidades: 1234 }, { producto: 'Té verde', monto: 12.75, unidades: 3 }]);
  });

  it('a comma-separated CSV keeps reading dots as decimals', async () => {
    const { rows } = await sheetRows(new TextEncoder().encode('producto,monto\nCafé,1.5\n'), '');
    expect(rows).toEqual([{ producto: 'Café', monto: 1.5 }]);
  });
});
