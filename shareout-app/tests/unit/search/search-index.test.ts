// The palette's local search index, its deep-search companion and recent searches,
// against the real migrated schema: same visibility as quickSearch, ETag revalidation,
// and per-user, per-workspace isolation of recent searches.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { handleHomeDeepSearchApi, handleHomeRecentSearchesApi, handleHomeSearchIndexApi } from '../../../src/pages/home/search-api';
import { buildSearchIndex, etagMatches, type SearchIndex } from '../../../src/search/search-index';
import { quickSearch } from '../../../src/search/quick-search';
import { PERSONAL_SCOPE } from '../../../src/chat-platforms/types';

const WS = 'wsp_si_acme';
const OTHER_WS = 'wsp_si_other';
const BIG_WS = 'wsp_si_big';
const ALICE = { id: 'usr_si_alice', email: 'si-alice@example.com' };
const BOB = { id: 'usr_si_bob', email: 'si-bob@example.com' };
const CAROL = { id: 'usr_si_carol', email: 'si-carol@example.com' };

const art = (id: string, name: string, owner: string, ws: string | null, visibility: string, extra: { description?: string; folder?: string } = {}) =>
  e.DB.prepare('INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id, description, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, owner, name, id.replace(/_/g, '-'), visibility, ws, extra.description ?? null, extra.folder ?? null);

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    ...[ALICE, BOB, CAROL].map((u) => e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(u.id, u.email, u.id.slice(7))),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'Acme', 'si-acme', BOB.id),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(OTHER_WS, 'Other', 'si-other', CAROL.id),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(BIG_WS, 'Big', 'si-big', ALICE.id),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_si_1', ?, ?, 'owner')").bind(WS, BOB.id),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_si_2', ?, ?, 'member')").bind(WS, ALICE.id),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_si_3', ?, ?, 'owner')").bind(OTHER_WS, CAROL.id),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_si_4', ?, ?, 'owner')").bind(BIG_WS, ALICE.id),
    e.DB.prepare("INSERT INTO folders (id, workspace_id, owner_id, name, slug) VALUES ('fld_si_ops', ?, ?, 'Operaciones', 'operaciones')").bind(WS, BOB.id),
    art('art_si_team', 'Clasificación de residuos', BOB.id, WS, 'workspace', { folder: 'fld_si_ops', description: 'Procedimiento para clasificar residuos peligrosos en planta' }),
    art('art_si_bob_private', 'Bob salary review', BOB.id, WS, 'private'),
    art('art_si_alice_private', 'Alice notes', ALICE.id, WS, 'private'),
    art('art_si_bob_personal', 'Bob personal draft', BOB.id, null, 'private'),
    art('art_si_other', 'Other workspace roadmap', CAROL.id, OTHER_WS, 'workspace'),
    e.DB.prepare("INSERT INTO artifact_tags (id, artifact_id, label) VALUES ('tag_si_1', 'art_si_team', 'seguridad')"),
    e.DB.prepare("INSERT INTO user_recent_views (user_id, artifact_id) VALUES (?, 'art_si_team')").bind(ALICE.id),
    e.DB.prepare("INSERT INTO user_recent_views (user_id, artifact_id) VALUES (?, 'art_si_bob_private')").bind(ALICE.id),
  ]);
});

const ids = (ix: SearchIndex) => ix.artifacts.map((a) => a[0]);
const req = (path: string, init?: RequestInit) => new Request(`https://x.test${path}`, init);

describe('search index visibility', () => {
  it('a member gets the workspace items, folders and people, but not someone else’s private page', async () => {
    const ix = await buildSearchIndex(e, ALICE.id, WS);
    expect(ids(ix).sort()).toEqual(['art_si_alice_private', 'art_si_team']);
    expect(ix.folders.map((f) => f[0])).toEqual(['fld_si_ops']);
    expect(ix.people.map((p) => p[0]).sort()).toEqual([ALICE.id, BOB.id].sort());
    const team = ix.artifacts.find((a) => a[0] === 'art_si_team')!;
    expect(team[4]).toBe('fld_si_ops');
    expect(team[5]).toBe('seguridad');
    // Recently opened only lists what the index can show.
    expect(ix.recent).toEqual(['art_si_team']);
  });

  it('a non-member gets nothing from the workspace: no items, folders or people', async () => {
    const ix = await buildSearchIndex(e, CAROL.id, WS);
    expect(ix.artifacts).toEqual([]);
    expect(ix.folders).toEqual([]);
    expect(ix.people).toEqual([]);
    // quickSearch's workspace groups follow the same rule.
    const qs = await quickSearch(e, CAROL.id, { q: '', workspaceId: WS });
    expect(qs.artifacts).toEqual([]);
    expect(qs.folders).toEqual([]);
    expect(qs.people).toEqual([]);
  });

  it('across workspaces: own pages plus workspace pages of member workspaces only', async () => {
    const ix = await buildSearchIndex(e, ALICE.id, undefined);
    expect(ids(ix)).toContain('art_si_team');
    expect(ids(ix)).toContain('art_si_alice_private');
    expect(ids(ix)).not.toContain('art_si_bob_private');
    expect(ids(ix)).not.toContain('art_si_bob_personal');
    expect(ids(ix)).not.toContain('art_si_other');
    expect(ix.workspaces.map((w) => w[0]).sort()).toEqual([BIG_WS, WS].sort());
  });

  it('personal scope: only the user’s own pages outside workspaces', async () => {
    expect(ids(await buildSearchIndex(e, BOB.id, PERSONAL_SCOPE))).toEqual(['art_si_bob_personal']);
    expect(ids(await buildSearchIndex(e, ALICE.id, PERSONAL_SCOPE))).toEqual([]);
  });
});

describe('GET /v1/home/search-index', () => {
  it('answers 304 to a matching If-None-Match, 200 again once something changes', async () => {
    const first = await handleHomeSearchIndexApi(req(`/v1/home/search-index?workspace=${WS}`), e, ALICE);
    expect(first.status).toBe(200);
    const etag = first.headers.get('ETag')!;
    expect(etag).toMatch(/^W\/"si[0-9a-f]{24}"$/);
    expect(first.headers.get('Cache-Control')).toBe('private, no-cache');
    const again = await handleHomeSearchIndexApi(req(`/v1/home/search-index?workspace=${WS}`, { headers: { 'If-None-Match': etag } }), e, ALICE);
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    // Another user never shares the ETag, even for identical content.
    const bob = await handleHomeSearchIndexApi(req(`/v1/home/search-index?workspace=${WS}`, { headers: { 'If-None-Match': etag } }), e, BOB);
    expect(bob.status).toBe(200);
    await e.DB.prepare("UPDATE artifacts SET name = 'Clasificación de residuos v2' WHERE id = 'art_si_team'").run();
    const changed = await handleHomeSearchIndexApi(req(`/v1/home/search-index?workspace=${WS}`, { headers: { 'If-None-Match': etag } }), e, ALICE);
    expect(changed.status).toBe(200);
    expect(changed.headers.get('ETag')).not.toBe(etag);
    await e.DB.prepare("UPDATE artifacts SET name = 'Clasificación de residuos' WHERE id = 'art_si_team'").run();
  });

  it('etagMatches handles weak tags, lists and *', () => {
    expect(etagMatches('W/"a", "b"', 'W/"b"')).toBe(true);
    expect(etagMatches('"a"', 'W/"a"')).toBe(true);
    expect(etagMatches('*', 'W/"x"')).toBe(true);
    expect(etagMatches('"c"', 'W/"x"')).toBe(false);
    expect(etagMatches(null, 'W/"x"')).toBe(false);
  });

  it('stays small: ~250 artifacts', async () => {
    const tags = ['ventas', 'finanzas', 'operaciones', 'marketing', 'producto'];
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 250; i++) {
      stmts.push(art(`art_si_big_${i}`, `Informe ${tags[i % 5]} semana ${i}`, ALICE.id, BIG_WS, 'workspace', {
        description: `Resumen semanal de ${tags[i % 5]} con métricas clave, comparativa contra el objetivo y notas del equipo número ${i}.`,
      }));
      stmts.push(e.DB.prepare('INSERT INTO artifact_tags (id, artifact_id, label) VALUES (?, ?, ?)').bind(`tag_si_big_${i}`, `art_si_big_${i}`, tags[i % 5]));
    }
    await e.DB.batch(stmts);
    const res = await handleHomeSearchIndexApi(req(`/v1/home/search-index?workspace=${BIG_WS}`), e, ALICE);
    const body = await res.text();
    const bytes = new TextEncoder().encode(body).length;
    const gz = await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    console.log(`search index, 250 artifacts: ${bytes} bytes JSON, ${gz.byteLength} bytes gzip`);
    expect((JSON.parse(body) as SearchIndex).artifacts).toHaveLength(250);
    expect(bytes).toBeLessThan(60_000);
    expect(gz.byteLength).toBeLessThan(12_000);
  });
});

describe('GET /v1/home/deep-search', () => {
  it('finds description text, never another user’s private page, nothing for a non-member', async () => {
    const hit = await handleHomeDeepSearchApi(req(`/v1/home/deep-search?q=peligrosos&workspace=${WS}`), e, ALICE);
    const body = (await hit.json()) as { content: { id: string }[]; passages: unknown[]; datasets: unknown[] };
    expect(body.content.map((h) => h.id)).toEqual(['art_si_team']);
    await e.DB.prepare("UPDATE artifacts SET description = 'peligrosos también' WHERE id = 'art_si_bob_private'").run();
    const again = (await (await handleHomeDeepSearchApi(req(`/v1/home/deep-search?q=peligrosos&workspace=${WS}`), e, ALICE)).json()) as { content: { id: string }[] };
    expect(again.content.map((h) => h.id)).toEqual(['art_si_team']);
    const carol = (await (await handleHomeDeepSearchApi(req(`/v1/home/deep-search?q=peligrosos&workspace=${WS}`), e, CAROL)).json()) as { content: unknown[] };
    expect(carol.content).toEqual([]);
  });

  it('does not repeat what the index answers: no artifact names, folders or people groups', async () => {
    const body = (await (await handleHomeDeepSearchApi(req(`/v1/home/deep-search?q=Operaciones&workspace=${WS}`), e, ALICE)).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['alerts', 'connectors', 'content', 'crew', 'datasets', 'passages', 'query', 'schedules', 'skills']);
  });
});

describe('/v1/home/recent-searches', () => {
  const call = async (user: typeof ALICE, method: string, qs = '', body?: unknown) => {
    const res = await handleHomeRecentSearchesApi(req(`/v1/home/recent-searches?workspace=${WS}${qs}`, {
      method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
    }), e, user);
    return ((await res.json()) as { searches: { q: string }[] }).searches.map((s) => s.q);
  };
  const tick = () => new Promise((r) => setTimeout(r, 3));

  it('records most recent first, dedupes accent/case-insensitively, caps at 20', async () => {
    await call(ALICE, 'POST', '', { q: 'ventas' }); await tick();
    await call(ALICE, 'POST', '', { q: 'Clasificación' }); await tick();
    expect(await call(ALICE, 'POST', '', { q: '  VENTAS ' })).toEqual(['VENTAS', 'Clasificación']);
    for (let i = 0; i < 25; i++) { await call(ALICE, 'POST', '', { q: `query ${i}` }); await tick(); }
    const list = await call(ALICE, 'GET');
    expect(list).toHaveLength(20);
    expect(list[0]).toBe('query 24');
    expect(list).not.toContain('ventas');
  });

  it('removes one, then clears all', async () => {
    expect(await call(ALICE, 'DELETE', '&q=query%2024')).not.toContain('query 24');
    expect(await call(ALICE, 'DELETE')).toEqual([]);
    expect(await call(ALICE, 'GET')).toEqual([]);
  });

  it('never leaks across users or workspaces', async () => {
    await call(ALICE, 'POST', '', { q: 'alice secret' });
    expect(await call(BOB, 'GET')).toEqual([]);
    const other = await handleHomeRecentSearchesApi(req(`/v1/home/recent-searches?workspace=${OTHER_WS}`), e, ALICE);
    expect(((await other.json()) as { searches: unknown[] }).searches).toEqual([]);
    // Bob clearing his list leaves Alice's alone.
    await call(BOB, 'DELETE');
    expect(await call(ALICE, 'GET')).toEqual(['alice secret']);
  });

  it('rejects an empty query', async () => {
    const res = await handleHomeRecentSearchesApi(req(`/v1/home/recent-searches?workspace=${WS}`, { method: 'POST', body: JSON.stringify({ q: '   ' }) }), e, ALICE);
    expect(res.status).toBe(400);
  });
});
