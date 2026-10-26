// The certification API against the real schema: who may certify (owners/admins only),
// what a member's `status: certified` amounts to (nothing), and what an edit after a
// certification does to it ("changed since certification").
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ userId: '', session: true }));
vi.mock('../../../src/router/helpers/auth-guard', () => ({
  requireTokenOrSession: async () => ({ id: h.userId, email: `${h.userId}@agencia.example`, username: null }),
  isAuthUser: () => true,
}));
// The caller is signed in to ShareOut (a browser session) unless a test says otherwise.
vi.mock('../../../src/auth/session', async (orig) => ({
  ...(await orig<object>()),
  getSessionUser: async () => (h.session ? { id: h.userId, email: `${h.userId}@agencia.example` } : null),
}));

import { applyMigrations, e } from '../helpers/migrated-db';
import { routeCatalogApi } from '../../../src/router/api/catalog';
import { createFetchContext } from '../../../src/router/context';
import { listCatalogFiles, setCatalogEnabled, upsertCatalogFile } from '../../../src/catalog';

const WS = 'wsp_cert';
const OWNER = 'usr_cert_owner';
const ADMIN = 'usr_cert_admin';
const MEMBER = 'usr_cert_member';
const EXTERNAL = 'usr_cert_external';
const OUTSIDER = 'usr_cert_outsider';

const ROAS = `---
kind: metric
id: metric.roas
title: ROAS
owner: ana@agencia.example
description: { es: Ingresos atribuidos ÷ inversión }
source: { connection: conn_ads, fqn: analytics.ads_daily }
type: ratio
numerator: { agg: sum, expr: revenue }
denominator: { agg: sum, expr: spend }
time: { dimension: date, grains: [day, month] }
status: certified
---

Return on ad spend, all paid channels.`;

const ORDERS = `---
kind: table
id: t.orders
title: Orders
---

One row per order.`;

async function call(user: string, method: string, sub: string, body?: unknown, headers: Record<string, string> = {}) {
  h.userId = user;
  const req = new Request(`https://shareout.test/v1/workspaces/${WS}/catalog${sub}`, {
    method,
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await routeCatalogApi(createFetchContext(req, e));
  if (!res) throw new Error('unrouted');
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const getEntry = (id: string, user = MEMBER) => call(user, 'GET', `/entries/${encodeURIComponent(id)}`);
const certify = (user: string, id: string, body: Record<string, unknown>) =>
  call(user, 'POST', `/entries/${encodeURIComponent(id)}/certify`, body);

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare(
      "INSERT INTO users (id, email, name) VALUES (?, 'owner@agencia.example', 'Olga'), (?, 'admin@agencia.example', 'Ana Gómez'), (?, 'member@agencia.example', 'Mario'), (?, 'ext@cliente.example', 'Eli'), (?, 'out@else.example', 'Otto')"
    ).bind(OWNER, ADMIN, MEMBER, EXTERNAL, OUTSIDER),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Agencia', 'agencia-cert', ?)").bind(WS, OWNER),
    e.DB.prepare(
      `INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
        ('wm_c1', ?, ?, 'owner', 'internal'), ('wm_c2', ?, ?, 'admin', 'internal'),
        ('wm_c3', ?, ?, 'member', 'internal'), ('wm_c4', ?, ?, 'member', 'external')`
    ).bind(WS, OWNER, WS, ADMIN, WS, MEMBER, WS, EXTERNAL),
  ]);
});

beforeEach(async () => {
  h.session = true;
  await e.DB.exec('DELETE FROM catalog_certifications');
  await e.DB.exec('DELETE FROM workspace_files');
  await e.DB.exec('DELETE FROM catalog_settings');
  await setCatalogEnabled(e, WS, true);
  await upsertCatalogFile(e, WS, { path: 'metrics/roas.md', content: ROAS });
  await upsertCatalogFile(e, WS, { path: 'tables/orders.md', content: ORDERS });
});

describe('who may certify', () => {
  it("a member's self-certification stays a draft", async () => {
    const put = await call(MEMBER, 'PUT', '/files', { path: 'tables/orders.md', content: ORDERS.replace('title: Orders', 'title: Orders\nstatus: certified') });
    expect(put.status).toBe(200);
    const { body } = await getEntry('t.orders');
    expect(body.entry.status).toBe('draft');
    expect(body.entry.certification).toMatchObject({ status: 'draft', declared_status: 'certified', decision: null, stale: false });

    const denied = await certify(MEMBER, 't.orders', { decision: 'certified' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORBIDDEN');
    expect((await getEntry('t.orders')).body.entry.status).toBe('draft');
    expect((await call(MEMBER, 'GET', '/manifest')).body.manifest.kpis.certifiedPct).toBe(0);
  });

  it('an admin certification records who and when, and every read shows it', async () => {
    const before = await getEntry('metric.roas');
    expect(before.body.entry.status).toBe('draft');
    const hash = before.body.entry.certification.content_hash;

    const res = await certify(ADMIN, 'metric.roas', { decision: 'certified', note: 'Matches the ads platform for March', content_hash: hash });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, entry_id: 'metric.roas', status: 'certified' });
    expect(res.body.certification.decision).toMatchObject({
      decision: 'certified',
      note: 'Matches the ads platform for March',
      content_hash: hash,
      decided_by: { id: ADMIN, name: 'Ana Gómez', email: 'admin@agencia.example' },
    });
    expect(Date.parse(res.body.certification.decision.decided_at)).toBeGreaterThan(Date.now() - 60_000);

    const after = await getEntry('metric.roas');
    expect(after.body.entry.status).toBe('certified');
    expect(after.body.history).toHaveLength(1);
    expect(after.body.history[0]).toMatchObject({ decision: 'certified', current: true, decided_by: { name: 'Ana Gómez' } });

    const search = await call(MEMBER, 'GET', '?status=certified');
    expect(search.body.entries.map((x: { id: string }) => x.id)).toEqual(['metric.roas']);
    expect(search.body.facets.status).toContainEqual({ value: 'certified', count: 1 });
    expect((await call(MEMBER, 'GET', '/manifest')).body.manifest.kpis.certifiedPct).toBe(50);

    const audit = await e.DB.prepare("SELECT action, actor_id, target_id FROM audit_log WHERE workspace_id = ? AND action LIKE 'catalog.%'").bind(WS).all();
    expect(audit.results).toEqual([{ action: 'catalog.certify', actor_id: ADMIN, target_id: 'metric.roas' }]);
  });

  it('the owner can certify; external members and outsiders cannot even read', async () => {
    expect((await certify(OWNER, 't.orders', { decision: 'certified' })).status).toBe(200);
    expect((await certify(EXTERNAL, 't.orders', { decision: 'revoked' })).status).toBe(403);
    expect((await certify(OUTSIDER, 't.orders', { decision: 'revoked' })).status).toBe(403);
    expect((await getEntry('t.orders', EXTERNAL)).status).toBe(403);
    expect((await getEntry('t.orders')).body.entry.status).toBe('certified');
  });
});

describe('certification is a human act', () => {
  it('refuses any token, even an admin\'s, and points to the Catalog', async () => {
    for (const token of ['so_personal_token', 'sot_agent_token', 'so_mcp_access_token']) {
      const res = await call(ADMIN, 'POST', '/entries/t.orders/certify', { decision: 'certified' }, { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'SESSION_REQUIRED', error: 'Certification is done by an owner or admin in ShareOut', hint: expect.stringContaining('Catalog') });
    }
    expect((await getEntry('t.orders')).body.history).toEqual([]);
  });

  it('needs a signed-in session for the caller', async () => {
    h.session = false;
    const res = await certify(ADMIN, 't.orders', { decision: 'certified' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SESSION_REQUIRED');
  });

  it('records a signed-in decision as such in the audit trail', async () => {
    await certify(OWNER, 't.orders', { decision: 'deprecated', note: 'Use orders_v2' });
    const row = await e.DB.prepare("SELECT detail FROM audit_log WHERE workspace_id = ? AND action = 'catalog.deprecate'").bind(WS).first<{ detail: string }>();
    expect(JSON.parse(row!.detail)).toMatchObject({ via: 'session', note: 'Use orders_v2' });
  });
});

describe('edits after certification', () => {
  it('an edit shows "changed since certification" until an admin certifies the new version', async () => {
    await certify(ADMIN, 't.orders', { decision: 'certified' });
    await call(MEMBER, 'PUT', '/files', { path: 'tables/orders.md', content: ORDERS.replace('One row', 'Exactly one row') });

    const edited = await getEntry('t.orders');
    expect(edited.body.entry.status).toBe('draft');
    expect(edited.body.entry.certification).toMatchObject({ stale: true, decision: { decision: 'certified', decided_by: { id: ADMIN } } });
    expect(edited.body.history[0].current).toBe(false);

    await certify(ADMIN, 't.orders', { decision: 'certified', content_hash: edited.body.entry.certification.content_hash });
    const again = await getEntry('t.orders');
    expect(again.body.entry.certification).toMatchObject({ status: 'certified', stale: false });
    expect(again.body.history.map((x: { current: boolean }) => x.current)).toEqual([true, false]);
  });

  it('a metric keeps its certification through prose edits, not through spec edits', async () => {
    await certify(ADMIN, 'metric.roas', { decision: 'certified' });
    await call(MEMBER, 'PUT', '/files', {
      path: 'metrics/roas.md',
      content: ROAS.replace('Ingresos atribuidos ÷ inversión', 'Ingresos ÷ inversión publicitaria').replace('all paid channels', 'every paid channel'),
    });
    expect((await getEntry('metric.roas')).body.entry.status).toBe('certified');

    await call(MEMBER, 'PUT', '/files', { path: 'metrics/roas.md', content: ROAS.replace('expr: spend', 'expr: spend_usd') });
    const changed = await getEntry('metric.roas');
    expect(changed.body.entry.status).toBe('draft');
    expect(changed.body.entry.certification.stale).toBe(true);
  });

  it('refuses a decision on a version the admin did not review', async () => {
    const res = await certify(ADMIN, 't.orders', { decision: 'certified', content_hash: 'not-the-current-hash' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
    expect((await getEntry('t.orders')).body.history).toEqual([]);
  });

  it('revoke returns it to draft; deprecate sticks across edits', async () => {
    await certify(ADMIN, 't.orders', { decision: 'certified' });
    await certify(ADMIN, 't.orders', { decision: 'revoked', note: 'Source moved' });
    expect((await getEntry('t.orders')).body.entry.status).toBe('draft');

    await certify(ADMIN, 't.orders', { decision: 'deprecated', note: 'Use t.orders_v2' });
    await call(MEMBER, 'PUT', '/files', { path: 'tables/orders.md', content: ORDERS + '\nStill here.' });
    const dep = await getEntry('t.orders');
    expect(dep.body.entry.certification).toMatchObject({ status: 'deprecated', stale: true, decision: { note: 'Use t.orders_v2' } });
    expect(dep.body.history.map((x: { decision: string }) => x.decision)).toEqual(['deprecated', 'revoked', 'certified']);
  });
});

describe('certify input', () => {
  it('validates decision, note, entry and catalog state', async () => {
    expect((await certify(ADMIN, 't.orders', { decision: 'approved' })).status).toBe(400);
    expect((await certify(ADMIN, 't.orders', { decision: 'certified', note: 'x'.repeat(1001) })).status).toBe(400);
    expect((await certify(ADMIN, 't.orders', { decision: 'certified', note: 7 })).status).toBe(400);
    expect((await certify(ADMIN, 'nope', { decision: 'certified' })).status).toBe(404);
    expect((await call(ADMIN, 'GET', '/entries/t.orders/certify')).status).toBe(405);
    await setCatalogEnabled(e, WS, false);
    const off = await certify(ADMIN, 't.orders', { decision: 'certified' });
    expect(off.status).toBe(409);
    expect(off.body.code).toBe('CATALOG_DISABLED');
  });
});

describe('writes record their author', () => {
  it('PUT stores updated_by, and updated_by_kind = agent for a bearer token', async () => {
    await call(MEMBER, 'PUT', '/files', { path: 'tables/a.md', content: ORDERS.replace('t.orders', 't.a') });
    await call(ADMIN, 'PUT', '/files', { path: 'tables/b.md', content: ORDERS.replace('t.orders', 't.b') }, { Authorization: 'Bearer so_test' });
    const files = new Map((await listCatalogFiles(e, WS)).map((f) => [f.path, f]));
    expect(files.get('tables/a.md')).toMatchObject({ updatedBy: MEMBER, updatedByKind: 'user', source: 'manual' });
    expect(files.get('tables/b.md')).toMatchObject({ updatedBy: ADMIN, updatedByKind: 'agent' });
  });
});

describe('lineage and aliases over the API', () => {
  it("a connector source shows the datasets that point at it, under its old id too", async () => {
    await upsertCatalogFile(e, WS, {
      path: 'sources/conn_ads.md',
      content: '---\nkind: source\nid: conn.conn_ads\ntitle: Ads\nconnection_id: conn_ads\naliases: [conn.ads]\n---',
      source: 'seed:connector',
    });
    await upsertCatalogFile(e, WS, {
      path: 'datasets/ads/daily.md',
      content: '---\nkind: dataset\nid: ds.ads.daily\ntitle: daily\nupstream: [conn.ads]\n---',
      source: 'seed:connector',
    });
    const viaAlias = await getEntry('conn.ads');
    expect(viaAlias.status).toBe(200);
    expect(viaAlias.body.entry.id).toBe('conn.conn_ads');
    expect(viaAlias.body.downstream).toEqual([{ id: 'ds.ads.daily', present: true, title: 'daily', kind: 'dataset', status: 'draft' }]);

    const list = await call(MEMBER, 'GET', '');
    const source = list.body.entries.find((x: { id: string }) => x.id === 'conn.conn_ads');
    expect(source.downstream).toEqual(['ds.ads.daily']);
    expect((await call(MEMBER, 'GET', '/manifest')).body.manifest.orphans).not.toContain('conn.conn_ads');
  });
});
