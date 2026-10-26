// Catalog metrics end to end against the real schema and a real MiniDB shared table:
// who may run what, the numbers that come back (scope applied before aggregation),
// the provenance on every answer, the rate limit, and the index kept in sync.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  userId: '',
  limit: { allowed: true, limit: 60, remaining: 59, reset: 0, retryAfter: 120 } as { allowed: boolean; limit: number; remaining: number; reset: number; retryAfter?: number },
  warehouseRows: [] as Record<string, unknown>[],
  calls: [] as Array<{ conn: { id: string }; sql: string; opts: Record<string, unknown>; userId: unknown }>,
}));
vi.mock('../../../src/router/helpers/auth-guard', () => ({
  requireTokenOrSession: async () => ({ id: h.userId, email: `${h.userId}@agencia.example`, username: null }),
  isAuthUser: () => true,
}));
// Callers are signed in to ShareOut (certification only accepts a browser session).
vi.mock('../../../src/auth/session', async (orig) => ({
  ...(await orig<object>()),
  getSessionUser: async () => ({ id: h.userId, email: `${h.userId}@agencia.example` }),
}));
vi.mock('../../../src/data/connections/warehouse-query', async (orig) => ({
  ...(await orig<object>()),
  queryWorkspaceConnection: async (_env: unknown, _ws: string, conn: { id: string }, sql: string, opts: Record<string, unknown>, userId: unknown) => {
    h.calls.push({ conn, sql, opts, userId });
    return h.warehouseRows;
  },
}));
vi.mock('../../../src/rate-limit', async (orig) => ({
  ...(await orig<object>()),
  checkWebAgentQueryLimit: async () => h.limit,
}));

import { applyMigrations, e } from '../helpers/migrated-db';
import { routeCatalogApi } from '../../../src/router/api/catalog';
import { routeCatalogMetricsApi } from '../../../src/router/api/catalog-metrics';
import { createFetchContext } from '../../../src/router/context';
import { setCatalogEnabled } from '../../../src/catalog';
import { runCatalogMetric } from '../../../src/catalog/metrics/run';
import { writeTableRows } from '../../../src/data/tables/materialize';

const WS = 'wsp_metrics';
const OTHER_WS = 'wsp_metrics_other';
const OWNER = 'usr_m_owner';
const ADMIN = 'usr_m_admin';
const MEMBER = 'usr_m_member';
const AUTHOR = 'usr_m_author';
const EXTERNAL = 'usr_m_external';
const ART = 'art_m_ads';

const SHARED_ROAS = `---
kind: metric
id: metric.roas_ads
title: ROAS
title_es: Retorno de la inversión publicitaria
owner: ana@agencia.example
source: { shared_table: ads_daily }
type: ratio
numerator: { agg: sum, expr: Ingresos }
denominator: { agg: sum, expr: Inversión }
time: { dimension: Fecha, grains: [month, week] }
dimensions: [{ name: canal, column: Canal }, { name: cliente, column: cliente_id }]
filters: ["Estado = 'activo'"]
format: { kind: ratio, decimals: 2, suffix: "x" }
scope_field: cliente_id
freshness_sla: 26h
---
Paid media, every channel.`;

const WAREHOUSE_SPEND = `---
kind: metric
id: metric.spend
title: Inversión
source: { connection: conn_m_wh, fqn: analytics.ads_daily }
type: simple
measure: { agg: sum, expr: spend }
time: { dimension: date, grains: [month] }
dimensions: [{ name: canal, column: channel }]
format: { kind: currency, currency: ARS }
---`;

async function call(user: string, method: string, sub: string, body?: unknown) {
  h.userId = user;
  const req = new Request(`https://shareout.test/v1/workspaces/${WS}/catalog${sub}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ctx = createFetchContext(req, e);
  const res = (await routeCatalogMetricsApi(ctx)) ?? (await routeCatalogApi(ctx));
  if (!res) throw new Error(`unrouted ${sub}`);
  return { status: res.status, headers: res.headers, body: (await res.json()) as Record<string, any> };
}

const put = (user: string, path: string, content: string) => call(user, 'PUT', '/files', { path, content });
const query = (user: string, id: string, q: unknown = {}) => call(user, 'POST', `/metrics/${encodeURIComponent(id)}/query`, q);
const indexRow = (entryId: string) =>
  e.DB.prepare('SELECT * FROM catalog_metrics WHERE workspace_id = ? AND entry_id = ?').bind(WS, entryId).first<Record<string, any>>();

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare(
      "INSERT INTO users (id, email, name) VALUES (?, 'o@agencia.example', 'Olga'), (?, 'a@agencia.example', 'Ana Gómez'), (?, 'm@agencia.example', 'Mario'), (?, 'au@agencia.example', 'Aldo'), (?, 'x@cliente.example', 'Xime')"
    ).bind(OWNER, ADMIN, MEMBER, AUTHOR, EXTERNAL),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Agencia', 'agencia-metrics', ?), (?, 'Otra', 'otra-metrics', ?)").bind(WS, OWNER, OTHER_WS, OWNER),
    e.DB.prepare(
      `INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
        ('wm_m1', ?, ?, 'owner', 'internal'), ('wm_m2', ?, ?, 'admin', 'internal'), ('wm_m3', ?, ?, 'member', 'internal'),
        ('wm_m4', ?, ?, 'member', 'internal'), ('wm_m5', ?, ?, 'member', 'external')`
    ).bind(WS, OWNER, WS, ADMIN, WS, MEMBER, WS, AUTHOR, WS, EXTERNAL),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id) VALUES (?, ?, 'Ads', 'ads-metrics', 'workspace', ?)").bind(ART, OWNER, WS),
    e.DB.prepare(
      "INSERT INTO workspace_shared_tables (id, workspace_id, shared_name, owner_artifact_id, source_table_name, access) VALUES ('wst_m1', ?, 'ads_daily', ?, 'ads_daily', 'read')"
    ).bind(WS, ART),
    e.DB.prepare(
      `INSERT INTO connections (id, scope_type, scope_id, name, kind, provider, config, agent_query_enabled) VALUES
        ('conn_m_wh', 'workspace', ?, 'Warehouse', 'platform', 'bigquery', '{"projectId":"p1"}', 0),
        ('conn_m_open', 'workspace', ?, 'Snow', 'platform', 'snowflake', '{}', 1),
        ('conn_m_sheet', 'workspace', ?, 'Sheet', 'platform', 'google-sheets', '{}', 1),
        ('conn_m_foreign', 'workspace', ?, 'Foreign', 'platform', 'bigquery', '{}', 1)`
    ).bind(WS, WS, WS, OTHER_WS),
    e.DB.prepare(
      "INSERT INTO connections (id, scope_type, scope_id, name, kind, provider, config, is_private, created_by) VALUES ('conn_m_private', 'workspace', ?, 'Finance', 'platform', 'bigquery', '{}', 1, ?)"
    ).bind(WS, OWNER),
  ]);
  await writeTableRows(e, ART, 'ads_daily', [
    { Fecha: '2026-03-02', Canal: 'Meta', cliente_id: 'c1', Ingresos: 300, Inversión: 100, Estado: 'activo' },
    { Fecha: '2026-03-10', Canal: 'Meta', cliente_id: 'c2', Ingresos: 100, Inversión: 100, Estado: 'activo' },
    { Fecha: '2026-03-15T09:30:00Z', Canal: 'Google', cliente_id: 'c1', Ingresos: '50', Inversión: 20, Estado: 'activo' },
    { Fecha: '2026-03-20', Canal: 'Meta', cliente_id: 'c1', Ingresos: 999, Inversión: 1, Estado: 'pausado' },
    { Fecha: '2026-04-05', Canal: 'Meta', cliente_id: 'c1', Ingresos: 90, Inversión: 30, Estado: 'activo' },
    { Fecha: '2026-05-01', Canal: 'Meta', cliente_id: 'c1', Ingresos: 10, Inversión: 0, Estado: 'activo' },
  ]);
});

beforeEach(async () => {
  h.limit = { allowed: true, limit: 60, remaining: 59, reset: 0, retryAfter: 120 };
  h.warehouseRows = [{ SO_PERIOD: '2026-03-01', SO_D0: 'meta', SO_VALUE: '1520.5' }];
  h.calls = [];
  await e.DB.exec('DELETE FROM catalog_certifications');
  await e.DB.exec('DELETE FROM catalog_metrics');
  await e.DB.exec('DELETE FROM workspace_files');
  await setCatalogEnabled(e, WS, true);
  expect((await put(ADMIN, 'metrics/roas.md', SHARED_ROAS)).status).toBe(200);
  expect((await put(AUTHOR, 'metrics/spend.md', WAREHOUSE_SPEND)).status).toBe(200);
});

describe('running a shared-table metric (MiniDB)', () => {
  it('returns ROAS by month and channel, with the filter applied and provenance attached', async () => {
    const res = await query(ADMIN, 'metric.roas_ads', { grain: 'month', by: ['canal'], from: '2026-03-01', to: '2026-04-30' });
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([
      { period: '2026-03-01', canal: 'Google', value: 2.5, numerator: 50, denominator: 20 },
      { period: '2026-03-01', canal: 'Meta', value: 2, numerator: 400, denominator: 200 },
      { period: '2026-04-01', canal: 'Meta', value: 3, numerator: 90, denominator: 30 },
    ]);
    expect(res.body).toMatchObject({
      metric: { id: 'metric.roas_ads', title: 'ROAS', title_es: 'Retorno de la inversión publicitaria', type: 'ratio', formula: 'Σ Ingresos ÷ Σ Inversión' },
      status: 'draft',
      certified_by: null,
      certified_at: null,
      spec_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      format: { kind: 'ratio', decimals: 2, suffix: 'x' },
      source: { type: 'shared_table', shared_table: 'ads_daily', dialect: 'sqlite' },
      freshness: { sla: '26h', last_updated_at: expect.any(String), stale: false },
      scope: null,
      truncated: false,
      query: { grain: 'month', by: ['canal'], from: '2026-03-01', to: '2026-04-30' },
    });
    expect(Date.parse(res.body.computed_at)).toBeGreaterThan(Date.now() - 60_000);
    expect(res.body.sql).toContain('FROM artifact_rows');
  });

  it('answers a zero denominator with null, not a division error', async () => {
    const res = await query(ADMIN, 'metric.roas_ads', { grain: 'month', from: '2026-05-01', to: '2026-05-31' });
    expect(res.body.rows).toEqual([{ period: '2026-05-01', value: null, numerator: 10, denominator: 0 }]);
  });

  it('applies the viewer scope to rows before they are aggregated', async () => {
    const scoped = await runCatalogMetric(e, {
      workspaceId: WS,
      userId: MEMBER,
      role: 'member',
      metricId: 'metric.roas_ads',
      query: { grain: 'month', by: ['canal'], from: '2026-03-01', to: '2026-03-31' },
      scope: { field: 'cliente_id', values: ['c1'] },
    });
    expect(scoped.ok).toBe(true);
    if (!scoped.ok) return;
    // c1 only: Meta 300/100. Filtering after aggregation would have said 2.
    expect(scoped.body.rows).toEqual([
      { period: '2026-03-01', canal: 'Google', value: 2.5, numerator: 50, denominator: 20 },
      { period: '2026-03-01', canal: 'Meta', value: 3, numerator: 300, denominator: 100 },
    ]);
    expect(scoped.body.scope).toEqual({ field: 'cliente_id', values: ['c1'] });
    expect(scoped.body.sql).toBeUndefined();
  });

  it('refuses a scoped caller on a metric that has no scope_field', async () => {
    const r = await runCatalogMetric(e, { workspaceId: WS, userId: ADMIN, role: 'admin', metricId: 'metric.spend', query: {}, scope: { field: 'client_id', values: ['c1'] } });
    expect(r).toMatchObject({ ok: false, status: 403, code: 'SCOPE_REQUIRED' });
    expect(h.calls).toHaveLength(0);
  });
});

describe('who may run a metric', () => {
  it('a draft on a closed connection runs for owners/admins and its author only', async () => {
    const member = await query(MEMBER, 'metric.spend');
    expect(member.status).toBe(403);
    expect(member.body.code).toBe('METRIC_NOT_CERTIFIED');
    expect(h.calls).toHaveLength(0);

    const author = await query(AUTHOR, 'metric.spend', { from: '2026-03-01', to: '2026-03-31' });
    expect(author.status).toBe(200);
    expect(author.body.sql).toBeUndefined();
    expect(author.body.rows).toEqual([{ period: '2026-03-01', value: 1520.5 }]);
    expect(h.calls[0]).toMatchObject({ conn: { id: 'conn_m_wh' }, userId: AUTHOR, opts: { maxResults: 1000, timeoutMs: 30_000 } });
    expect(h.calls[0].sql).toContain('SELECT * FROM `analytics.ads_daily`');
    expect(h.calls[0].sql).toContain("DATE(so_base.date) BETWEEN DATE '2026-03-01' AND DATE '2026-03-31'");

    const owner = await query(OWNER, 'metric.spend');
    expect(owner.status).toBe(200);
    expect(owner.body.sql).toContain('FORMAT_DATE');
  });

  it("an admin's certification lets every internal member run it, and says who certified it", async () => {
    const entry = await call(ADMIN, 'GET', '/entries/metric.spend');
    const cert = await call(ADMIN, 'POST', '/entries/metric.spend/certify', { decision: 'certified', content_hash: entry.body.entry.certification.content_hash });
    expect(cert.status).toBe(200);
    const member = await query(MEMBER, 'metric.spend');
    expect(member.status).toBe(200);
    expect(member.body).toMatchObject({ status: 'certified', certified_by: { id: ADMIN, name: 'Ana Gómez' }, certified_at: expect.any(String) });
    expect(member.body.spec_hash).toBe(entry.body.entry.certification.content_hash);
    expect(member.body.sql).toBeUndefined();
  });

  it('a draft runs for anyone when its data is already open to members', async () => {
    await put(AUTHOR, 'metrics/open.md', WAREHOUSE_SPEND.replace('metric.spend', 'metric.open').replace('conn_m_wh', 'conn_m_open'));
    expect((await query(MEMBER, 'metric.open')).status).toBe(200);
    expect((await query(MEMBER, 'metric.roas_ads')).status).toBe(200);
  });

  it("writing a draft is not a way into a connection its creator reserved", async () => {
    await put(AUTHOR, 'metrics/private.md', WAREHOUSE_SPEND.replace('metric.spend', 'metric.private').replace('conn_m_wh', 'conn_m_private'));
    const author = await query(AUTHOR, 'metric.private');
    expect(author.status).toBe(403);
    expect(author.body.code).toBe('METRIC_NOT_CERTIFIED');
    expect(h.calls).toHaveLength(0);
    expect((await query(OWNER, 'metric.private')).status).toBe(200);
    const entry = await call(ADMIN, 'GET', '/entries/metric.private');
    await call(ADMIN, 'POST', '/entries/metric.private/certify', { decision: 'certified', content_hash: entry.body.entry.certification.content_hash });
    expect((await query(AUTHOR, 'metric.private')).status).toBe(200);
  });

  it('external members cannot list or run metrics', async () => {
    expect((await call(EXTERNAL, 'GET', '/metrics')).status).toBe(403);
    expect((await query(EXTERNAL, 'metric.roas_ads')).status).toBe(403);
  });

  it('stops at the workspace query limit', async () => {
    h.limit = { allowed: false, limit: 60, remaining: 0, reset: 0, retryAfter: 120 };
    const res = await query(ADMIN, 'metric.roas_ads');
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(res.headers.get('Retry-After')).toBe('120');
  });
});

describe('listing and explaining', () => {
  it('lists every metric with its status, formula, source and whether the caller can run it', async () => {
    const res = await call(MEMBER, 'GET', '/metrics');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.metrics.map((m: { id: string }) => [m.id, m]));
    expect(byId['metric.roas_ads']).toMatchObject({ status: 'draft', formula: 'Σ Ingresos ÷ Σ Inversión', grains: ['month', 'week'], dimensions: ['canal', 'cliente'], can_run: true, freshness_sla: '26h', problem: null });
    expect(byId['metric.spend']).toMatchObject({
      formula: 'Σ spend',
      source: { type: 'fqn', connection_id: 'conn_m_wh', connection_name: 'Warehouse', provider: 'bigquery', fqn: 'analytics.ads_daily', dialect: 'bigquery' },
      can_run: false,
    });
  });

  it('explains the formula to members, and shows owners/admins the SQL', async () => {
    const member = await call(MEMBER, 'GET', '/metrics/metric.spend/explain?grain=month&by=canal');
    expect(member.status).toBe(200);
    expect(member.body).toMatchObject({ formula: 'Σ spend', dialect: 'bigquery', query: { grain: 'month', by: ['canal'] } });
    expect(member.body.sql).toBeUndefined();
    const admin = await call(ADMIN, 'GET', '/metrics/metric.spend/explain?grain=month&by=canal');
    expect(admin.body.sql).toContain('so_base.channel AS so_d0');
    expect((await call(ADMIN, 'GET', '/metrics/metric.spend/explain?by=region')).status).toBe(400);
  });

  it('gives a metric in full, with live freshness for a shared table', async () => {
    const res = await call(MEMBER, 'GET', '/metrics/metric.roas_ads');
    expect(res.body.metric).toMatchObject({ id: 'metric.roas_ads', scoped: true, time_dimension: 'Fecha', freshness: { sla: '26h', stale: false } });
  });
});

describe('the spec on write, and the index', () => {
  it('refuses an invalid spec on PUT with the key it meant', async () => {
    const res = await put(AUTHOR, 'metrics/bad.md', WAREHOUSE_SPEND.replace('measure:', 'medida:'));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_METRIC_SPEC', param: 'medida', error: expect.stringContaining('Did you mean "measure"?') });
  });

  it('keeps one index row per metric, in step with the file', async () => {
    const roas = await indexRow('metric.roas_ads');
    const entry = await call(ADMIN, 'GET', '/entries/metric.roas_ads');
    expect(roas).toMatchObject({ path: 'metrics/roas.md', connection_id: null, compile_error: null, updated_by: ADMIN });
    expect(roas?.spec_hash).toBe(entry.body.entry.certification.content_hash);
    expect(JSON.parse(roas?.spec_json)).toMatchObject({ type: 'ratio', source: { kind: 'shared_table' } });
    expect(await indexRow('metric.spend')).toMatchObject({ connection_id: 'conn_m_wh', updated_by: AUTHOR });

    await put(AUTHOR, 'metrics/spend.md', WAREHOUSE_SPEND.replace('id: metric.spend', 'id: metric.spend_v2'));
    expect(await indexRow('metric.spend')).toBeNull();
    expect(await indexRow('metric.spend_v2')).toMatchObject({ path: 'metrics/spend.md' });

    await call(ADMIN, 'DELETE', '/files?path=metrics%2Fspend.md');
    expect(await indexRow('metric.spend_v2')).toBeNull();
  });

  it("records why a metric cannot run: another workspace's connection, a provider without SQL", async () => {
    await put(AUTHOR, 'metrics/foreign.md', WAREHOUSE_SPEND.replace('metric.spend', 'metric.foreign').replace('conn_m_wh', 'conn_m_foreign'));
    expect(await indexRow('metric.foreign')).toMatchObject({ connection_id: null, compile_error: 'No connection conn_m_foreign in this workspace' });
    const run = await query(ADMIN, 'metric.foreign');
    expect(run.status).toBe(422);
    expect(run.body.code).toBe('METRIC_UNAVAILABLE');
    expect(h.calls).toHaveLength(0);

    await put(AUTHOR, 'metrics/sheet.md', WAREHOUSE_SPEND.replace('metric.spend', 'metric.sheet').replace('conn_m_wh', 'conn_m_sheet'));
    expect((await indexRow('metric.sheet'))?.compile_error).toContain('cannot run SQL');
    const listed = await call(ADMIN, 'GET', '/metrics');
    expect(listed.body.metrics.find((m: { id: string }) => m.id === 'metric.sheet')).toMatchObject({ can_run: false, problem: { message: expect.stringContaining('cannot run SQL') } });
  });

  it('seeding backfills metrics written before the index existed', async () => {
    await e.DB.exec('DELETE FROM catalog_metrics');
    const seeded = await call(ADMIN, 'POST', '/seed');
    expect(seeded.body.metrics).toBe(2);
    expect(await indexRow('metric.roas_ads')).not.toBeNull();
  });

  it('deleting a connection leaves its metric unrunnable, not orphaned', async () => {
    await e.DB.exec("INSERT INTO connections (id, scope_type, scope_id, name, kind, provider, config) VALUES ('conn_m_tmp', 'workspace', 'wsp_metrics', 'Tmp', 'platform', 'bigquery', '{}')");
    await put(AUTHOR, 'metrics/tmp.md', WAREHOUSE_SPEND.replace('metric.spend', 'metric.tmp').replace('conn_m_wh', 'conn_m_tmp'));
    expect((await indexRow('metric.tmp'))?.connection_id).toBe('conn_m_tmp');
    await e.DB.exec("DELETE FROM connections WHERE id = 'conn_m_tmp'");
    expect((await indexRow('metric.tmp'))?.connection_id).toBeNull();
    expect((await query(ADMIN, 'metric.tmp')).body.code).toBe('METRIC_UNAVAILABLE');
  });
});
