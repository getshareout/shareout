// GET /v1/artifacts/{id}/sources end to end, against the migrated schema, R2 and the
// per-artifact MiniDB: who may read it (the page's own gate), what each role sees, and
// what a policy-scoped viewer never learns.
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../../../src/index';
import { applyMigrations, e } from '../helpers/migrated-db';
import { createSessionToken } from '../../../src/token';
import { hashToken } from '../../../src/api-auth';
import { signSpaceGuestToken, spaceGuestCookieName } from '../../../src/sharees/space-guest';
import { hashGuestEmail } from '../../../src/data/comments/guest';
import { createMiniDb } from '../../../src/data/minidb-client';
import { checkSlidingWindowRateLimit } from '../../../src/rate-limit';
import type { DataSource, SourcesResponse } from '../../../src/provenance/types';

const ORIGIN = 'https://shareout.test';
const WS = 'wsp_ps';
const SECRET = 'provenance-test-session-secret';
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const U = {
  owner: { id: 'usr_ps_owner', email: 'owner@agency.test' },
  editor: { id: 'usr_ps_editor', email: 'editor@agency.test' },
  viewer: { id: 'usr_ps_viewer', email: 'viewer@agency.test' },
  member: { id: 'usr_ps_member', email: 'member@agency.test' },
  admin: { id: 'usr_ps_admin', email: 'admin@agency.test' },
  outsider: { id: 'usr_ps_out', email: 'out@else.test' },
  client: { id: 'usr_ps_client', email: 'ana@client-a.test' },
};
const OWNER_TOKEN = 'so_' + 'p'.repeat(64);
const AGENT_TOKEN = 'sot_' + 'q'.repeat(64);
const GUEST = 'guest@client-c.test';
const NOW_S = Math.floor(Date.now() / 1000);

const HTML = `<!doctype html><html><head>
<script type="shareout/manifest">${JSON.stringify({
  version: '2.0',
  sources: {
    json: { snapshot: { label: 'Resumen de pauta', query: 'SELECT spend FROM ads.daily', refresh: 'todos los días' } },
    tables: { leads: {} },
    connections: { warehouse: { label: 'Data warehouse' } },
  },
})}</script>
<script src="/sdk/shareout.js"></script><script src="app.js"></script>
</head><body>
<h1>Pauta</h1>
<span id="kpi" data-shareout-binding="json:snapshot.spend" data-shareout-display="Inversión">$0</span>
<ul data-shareout-template="l" data-shareout-template-source="table:leads"><li data-shareout-template-item></li></ul>
</body></html>`;
const APP_JS = "const so = await ShareOut.create(); await so.connection('warehouse').query('SELECT 1');";

async function publish(id: string, visibility: string, opts: { policy?: unknown; folder?: string; manifest?: unknown; paused?: boolean } = {}) {
  const ver = `ver_${id}`;
  await e.ARTIFACTS.put(`a/${id}/index.html`, HTML);
  await e.ARTIFACTS.put(`a/${id}/app.js`, APP_JS);
  await e.DB.batch([
    e.DB.prepare(`INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility, folder_id, access_policy, paused)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, id, `s-${id}`, U.owner.id, WS, visibility, opts.folder ?? null, opts.policy ? JSON.stringify(opts.policy) : null, opts.paused ? 1 : 0),
    e.DB.prepare('INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, ?, ?)')
      .bind(ver, id, 'index.html', JSON.stringify(opts.manifest ?? {})),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', ?)")
      .bind(`dep_${id}`, id, ver, `s-${id}`),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, 'index.html', ?, 'text/html', ?, 'x')")
      .bind(`ast_${id}_h`, ver, `a/${id}/index.html`, HTML.length),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, 'app.js', ?, 'application/javascript', ?, 'x')")
      .bind(`ast_${id}_j`, ver, `a/${id}/app.js`, APP_JS.length),
  ]);
}

async function sources(id: string, auth: { cookie?: string; bearer?: string; ip?: string } = {}, query = ''): Promise<Response> {
  const headers = new Headers();
  if (auth.cookie) headers.set('Cookie', auth.cookie);
  if (auth.bearer) headers.set('Authorization', `Bearer ${auth.bearer}`);
  if (auth.ip) headers.set('cf-connecting-ip', auth.ip);
  return worker.fetch(new Request(`${ORIGIN}/v1/artifacts/${id}/sources${query}`, { headers }), e, ctx);
}
const session = async (u: { id: string; email: string }) => ({ cookie: `shareout_session=${await createSessionToken(u.id, u.email, e)}` });
const body = async (res: Response) => (await res.json()) as SourcesResponse;
const find = (b: SourcesResponse, key: string) => b.sources.find((s) => s.key === key) as DataSource;

beforeAll(async () => {
  await applyMigrations();
  (e as { SESSION_SECRET: string }).SESSION_SECRET = SECRET;
  await e.DB.batch([
    ...Object.values(U).map((u) => e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(u.id, u.email, u.email.split('@')[0])),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Agencia', 'agencia-ps', ?)").bind(WS, U.owner.id),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_ps1', ?, ?, 'owner', 'internal'), ('wm_ps2', ?, ?, 'member', 'internal'), ('wm_ps3', ?, ?, 'admin', 'internal')`)
      .bind(WS, U.owner.id, WS, U.member.id, WS, U.admin.id),
    e.DB.prepare("INSERT INTO folders (id, workspace_id, owner_id, name, slug, created_by) VALUES ('fld_ps', ?, ?, 'Cliente C', 'cliente-c', ?)")
      .bind(WS, U.owner.id, U.owner.id),
    e.DB.prepare(`INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by)
                  VALUES ('grt_ps', ?, 'guest', ?, 'folder', 'fld_ps', 'view', ?)`).bind(WS, GUEST, U.owner.id),
    e.DB.prepare(`INSERT INTO connections (id, scope_type, scope_id, name, kind, provider, credential_scope, config) VALUES
      ('conn_ps_wh', 'workspace', ?, 'warehouse', 'platform', 'bigquery', 'shared', '{}'),
      ('conn_ps_b', 'workspace', ?, 'cliente_b_ads', 'platform', 'google-ads', 'shared', '{}'),
      ('conn_ps_mcp', 'workspace', ?, 'hub', 'platform', 'mcp', 'per_user', '{"url":"https://mcp.hub.test/mcp"}')`).bind(WS, WS, WS),
  ]);
  await e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash) VALUES ('tok_ps_owner', 'user', ?, ?, ?)")
    .bind(U.owner.id, U.owner.id, await hashToken(OWNER_TOKEN)).run();
  await e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, scopes) VALUES ('tok_ps_agent', 'workspace', ?, ?, ?, 'artifacts:read')")
    .bind(WS, U.member.id, await hashToken(AGENT_TOKEN)).run();

  await publish('art_ps_pub', 'public');
  await publish('art_ps_ws', 'workspace', { folder: 'fld_ps' });
  await publish('art_ps_priv', 'private');
  await publish('art_ps_paused', 'public', { paused: true });
  await publish('art_ps_mcp', 'workspace', { manifest: { capabilities: { mcp: { connections: [{ name: 'hub', tools: ['search_deals'] }] } } } });
  await publish('art_ps_pol', 'private', {
    policy: { version: 1, field: 'company', default: 'deny', rules: [{ match: { domain: 'client-a.test' }, values: [1] }] },
  });
  await e.DB.batch([
    e.DB.prepare(`INSERT INTO collaborators (id, artifact_id, email, role) VALUES
      ('col_ps1', 'art_ps_priv', ?, 'viewer'), ('col_ps2', 'art_ps_priv', ?, 'editor'),
      ('col_ps3', 'art_ps_pol', ?, 'viewer'), ('col_ps4', 'art_ps_pol', ?, 'editor')`)
      .bind(U.viewer.email, U.editor.email, U.client.email, U.editor.email),
    // Two refresh jobs on the policy page: one the page reads, one it never names.
    e.DB.prepare(`INSERT INTO scheduled_jobs (id, artifact_id, owner_id, action, schedule, config, next_run_at, last_run_at, last_status, title) VALUES
      ('job_ps_a', 'art_ps_pol', ?, 'query_snapshot', '0 6 * * *', ?, ?, ?, 'success', 'Ads diario'),
      ('job_ps_b', 'art_ps_pol', ?, 'materialize', '0 7 * * *', ?, ?, ?, 'success', 'Crudo Cliente B')`)
      .bind(
        U.owner.id, JSON.stringify({ connection: 'warehouse', queries: [{ query: 'SELECT spend FROM ads.daily', target: { type: 'json', name: 'snapshot' } }] }), String(NOW_S + 3600), String(NOW_S - 7200),
        U.owner.id, JSON.stringify({ connection: 'cliente_b_ads', query: 'SELECT * FROM b', target: { type: 'table', name: 'raw_cliente_b' } }), String(NOW_S + 3600), String(NOW_S - 3600),
      ),
    e.DB.prepare("INSERT INTO job_runs (id, job_id, created_at, status) VALUES ('jr_ps_a', 'job_ps_a', ?, 'success'), ('jr_ps_b', 'job_ps_b', ?, 'success')")
      .bind(String(NOW_S - 7200), String(NOW_S - 3600)),
    // A crew that an event (a row someone inserted) set off: its timing is not for scoped viewers.
    e.DB.prepare("INSERT INTO crews (id, artifact_id, workspace_id, owner_id, name, status) VALUES ('crew_ps', 'art_ps_pol', ?, ?, 'Seguimiento Cliente B', 'active')")
      .bind(WS, U.owner.id),
    e.DB.prepare("INSERT INTO crew_runs (id, crew_id, artifact_id, trigger_kind, status, started_at, ended_at) VALUES ('crun_ps', 'crew_ps', 'art_ps_pol', 'event', 'done', ?, ?)")
      .bind(new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() - 30_000).toISOString()),
    e.DB.prepare(`INSERT INTO crew_run_events (id, run_id, crew_id, seq, event_type, tool_name, input_json)
                  VALUES ('cev_ps', 'crun_ps', 'crew_ps', 1, 'tool_call', 'table_insert', '{"table":"leads","rows":[{"company":2}]}')`),
  ]);
  // The public page is refreshed daily by a named job.
  await e.DB.batch([
    e.DB.prepare(`INSERT INTO scheduled_jobs (id, artifact_id, owner_id, action, schedule, config, next_run_at, last_run_at, last_status, title)
                  VALUES ('job_ps_pub', 'art_ps_pub', ?, 'query_snapshot', '0 6 * * *', ?, ?, ?, 'success', 'Pauta diaria')`)
      .bind(U.owner.id, JSON.stringify({ connection: 'warehouse', queries: [{ query: 'SELECT 1', target: { type: 'table', name: 'leads' } }] }), String(NOW_S + 3600), String(NOW_S - 600)),
    e.DB.prepare("INSERT INTO job_runs (id, job_id, created_at, status) VALUES ('jr_ps_pub', 'job_ps_pub', ?, 'success')").bind(String(NOW_S - 600)),
  ]);
  // The public page's json key was last written an hour ago (by the data API).
  await createMiniDb(e, 'art_ps_pub', WS).prepare(
    "INSERT INTO artifact_json (id, artifact_id, key, value, size_bytes, created_at, updated_at) VALUES ('jsn_ps', 'art_ps_pub', 'snapshot', '{}', 2, ?, ?)",
  ).bind(new Date(Date.now() - 3_600_000).toISOString(), new Date(Date.now() - 3_600_000).toISOString()).run();
});

describe('who can read a page\'s sources', () => {
  it('anyone can read a public page\'s sources, without editor detail', async () => {
    const res = await sources('art_ps_pub');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const b = await body(res);
    expect(b).toMatchObject({ artifact_id: 'art_ps_pub', access: 'summary', scoped: false, version: { number: 1, page: 'index.html' } });
    const snap = find(b, 'json:snapshot');
    expect(snap).toMatchObject({ label: 'Resumen de pauta', declared: true, feed_count: 1, feeds: [{ selector: '#kpi', label: 'Inversión' }] });
    expect(snap.freshness.last_refresh_at).toBeTruthy();
    expect(find(b, 'connection:warehouse')).toMatchObject({ provider: 'bigquery', freshness: { refresher: { type: 'live' } } });
    expect(JSON.stringify(b)).not.toMatch(/SELECT|conn_ps_|details/);
  });

  it('a closed page is 404 to anonymous callers, outsiders and Agent tokens', async () => {
    expect((await sources('art_ps_priv')).status).toBe(404);
    expect((await sources('art_ps_nope')).status).toBe(404);
    expect((await sources('art_ps_priv', await session(U.outsider))).status).toBe(404);
    expect((await sources('art_ps_ws', { bearer: AGENT_TOKEN })).status).toBe(404);
  });

  it('workspace members, collaborators and space guests read the summary', async () => {
    for (const [id, auth] of [
      ['art_ps_ws', await session(U.member)],
      ['art_ps_priv', await session(U.viewer)],
      ['art_ps_ws', { cookie: `${spaceGuestCookieName('grt_ps')}=${await signSpaceGuestToken(SECRET, { w: WS, g: 'grt_ps', f: 'fld_ps', h: await hashGuestEmail(SECRET, GUEST), n: 'Caro' })}` }],
    ] as const) {
      const res = await sources(id, auth);
      expect(res.status, id).toBe(200);
      const b = await body(res);
      expect(b.access).toBe('summary');
      expect(b.sources.every((s) => s.details === undefined)).toBe(true);
    }
  });

  it('editors, owners (also by API token) and workspace admins get the full detail', async () => {
    for (const [id, auth] of [
      ['art_ps_priv', await session(U.editor)],
      ['art_ps_priv', { bearer: OWNER_TOKEN }],
      ['art_ps_ws', await session(U.admin)],
    ] as const) {
      const b = await body(await sources(id, auth));
      expect(b.access, id).toBe('full');
      expect(find(b, 'json:snapshot').details?.query).toBe('SELECT spend FROM ads.daily');
      expect(find(b, 'connection:warehouse').details?.connection).toMatchObject({ id: 'conn_ps_wh', scope: 'workspace', credential_scope: 'shared' });
    }
  });

  it('a paused page is hidden from viewers but not from its owner', async () => {
    expect((await sources('art_ps_paused')).status).toBe(404);
    expect((await sources('art_ps_paused', await session(U.owner))).status).toBe(200);
  });
});

describe('refresher names, cost limits and caching', () => {
  it('a public link learns when and how often, not who: names are for people tied to the page', async () => {
    const anon = find(await body(await sources('art_ps_pub', { ip: '198.51.100.7' })), 'table:leads');
    expect(anon.freshness.refresher).toEqual({ type: 'job', schedule: '0 6 * * *' });
    expect(anon.freshness.last_refresh_at).toBeTruthy();
    const member = find(await body(await sources('art_ps_pub', await session(U.member))), 'table:leads');
    expect(member.freshness.refresher).toMatchObject({ type: 'job', name: 'Pauta diaria' });
    // Signed in but unrelated to the page or its workspace: still a public-link viewer.
    const stranger = find(await body(await sources('art_ps_pub', await session(U.outsider))), 'table:leads');
    expect(stranger.freshness.refresher?.name).toBeUndefined();
  });

  it('signed-out callers share a per-IP budget; signed-in callers are not counted', async () => {
    const ip = '203.0.113.9';
    for (let i = 0; i < 120; i++) await checkSlidingWindowRateLimit(e.RATE_LIMIT_KV, ip, 'sourcesAnon');
    const limited = await sources('art_ps_pub', { ip });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { code: string }).code).toBe('RATE_LIMIT_EXCEEDED');
    expect((await sources('art_ps_pub', { ...(await session(U.member)), ip })).status).toBe(200);
    expect((await sources('art_ps_pub', { ip: '203.0.113.10' })).status).toBe(200);
  });

  it('caches viewer answers per class and never stores an editor\'s', async () => {
    const respKeys = async () => (await e.SLUGS!.list({ prefix: 'prov:v1:resp:art_ps_ws:' })).keys.map((k) => k.name);
    const full = await body(await sources('art_ps_ws', await session(U.owner)));
    expect(full.access).toBe('full');
    expect(JSON.stringify(full)).toContain('conn_ps_wh');
    await new Promise((r) => setTimeout(r, 50));
    expect((await respKeys()).some((k) => k.endsWith(':full'))).toBe(false);
    const member = await body(await sources('art_ps_ws', await session(U.member)));
    expect(member.access).toBe('summary');
    expect(member.sources.every((src) => src.details === undefined)).toBe(true);
    expect(JSON.stringify(member)).not.toContain('SELECT');
    await new Promise((r) => setTimeout(r, 50));
    const after = await respKeys();
    expect(after.some((k) => k.endsWith(':named'))).toBe(true);
    expect(after.some((k) => k.endsWith(':full'))).toBe(false);
    for (const key of after) expect(await e.SLUGS!.get(key)).not.toMatch(/SELECT|conn_ps_/);
    // An editor right after a member still gets the full answer, built fresh.
    expect((await body(await sources('art_ps_ws', await session(U.owner)))).access).toBe('full');
    // A version's page scan is cached once and reused by every caller class. It holds
    // what the published files hold, and none of the server facts editors get.
    const scanKeys = (await e.SLUGS!.list({ prefix: 'prov:v1:scan:ver_art_ps_ws:' })).keys;
    expect(scanKeys).toHaveLength(1);
    const scan = (await e.SLUGS!.get(scanKeys[0].name)) ?? '';
    expect(scan).toContain('warehouse');
    for (const fact of ['conn_ps_', 'credential_scope', 'job_ps_', 'crew_ps']) expect(scan).not.toContain(fact);
  });
});

describe('policy-scoped viewers', () => {
  it('see what the page itself names, refreshed on schedule, and nothing about other clients', async () => {
    const res = await sources('art_ps_pol', await session(U.client));
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b).toMatchObject({ access: 'summary', scoped: true });
    const text = JSON.stringify(b);
    expect(text).not.toMatch(/Cliente B|cliente_b|raw_cliente_b|Ads diario|Seguimiento/);
    expect(find(b, 'json:snapshot').freshness).toMatchObject({
      last_refresh_at: new Date((NOW_S - 7200) * 1000).toISOString(),
      refresher: { type: 'job', schedule: '0 6 * * *' },
    });
    expect(find(b, 'json:snapshot').freshness.refresher?.name).toBeUndefined();
    // Only an event set the crew off: no timing leaks from it.
    expect(find(b, 'table:leads').freshness.last_refresh_at).toBeUndefined();
  });

  it('the editor of the same page sees every job and crew', async () => {
    const b = await body(await sources('art_ps_pol', await session(U.editor)));
    expect(b).toMatchObject({ access: 'full', scoped: false });
    expect(find(b, 'json:snapshot').freshness.refresher).toMatchObject({ type: 'job', name: 'Ads diario' });
    expect(find(b, 'table:raw_cliente_b').details?.refreshers?.[0]).toMatchObject({ id: 'job_ps_b', name: 'Crudo Cliente B' });
    expect(find(b, 'table:leads').details?.refreshers?.[0]).toMatchObject({ type: 'crew', name: 'Seguimiento Cliente B' });
    expect(find(b, 'connection:cliente_b_ads')).toMatchObject({ direct: false, provider: 'google-ads' });
  });
});

describe('versions, pages and MCP', () => {
  it('only editors may ask for a specific version; unknown pages are 404', async () => {
    expect((await sources('art_ps_pub', {}, '?version=1')).status).toBe(403);
    const ok = await sources('art_ps_pub', { bearer: OWNER_TOKEN }, '?version=1');
    expect((await body(ok)).version.number).toBe(1);
    expect((await sources('art_ps_pub', { bearer: OWNER_TOKEN }, '?version=9')).status).toBe(404);
    const missing = await sources('art_ps_pub', {}, '?page=nope.html');
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { code: string }).code).toBe('PAGE_NOT_FOUND');
  });

  it('declared MCP connections are live sources; their tools are editor detail', async () => {
    const viewer = find(await body(await sources('art_ps_mcp', await session(U.member))), 'mcp:hub');
    expect(viewer).toMatchObject({ kind: 'mcp', declared: true, freshness: { refresher: { type: 'live' } } });
    expect(viewer.details).toBeUndefined();
    const owner = find(await body(await sources('art_ps_mcp', await session(U.owner))), 'mcp:hub');
    expect(owner.details).toMatchObject({ tools: ['search_deals'], connection: { id: 'conn_ps_mcp', credential_scope: 'per_user' } });
  });
});
