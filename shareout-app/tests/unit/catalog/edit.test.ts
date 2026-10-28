// Editing a catalog entry in place — the shared core (applyEntryEdit / updateCatalogEntry)
// and PATCH …/catalog/entries/{id} against the real schema.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ userId: '' }));
vi.mock('../../../src/router/helpers/auth-guard', () => ({
  requireTokenOrSession: async () => ({ id: h.userId, email: `${h.userId}@agencia.example`, username: null }),
  isAuthUser: () => true,
}));
vi.mock('../../../src/auth/session', async (orig) => ({
  ...(await orig<object>()),
  getSessionUser: async () => ({ id: h.userId, email: `${h.userId}@agencia.example` }),
}));

import { applyMigrations, e } from '../helpers/migrated-db';
import { routeCatalogApi } from '../../../src/router/api/catalog';
import { createFetchContext } from '../../../src/router/context';
import {
  applyEntryEdit, listCatalogFiles, normalizeEntryEdit, parseEntry, setCatalogEnabled, updateCatalogEntry, upsertCatalogFile,
} from '../../../src/catalog';

const WS = 'wsp_edit';
const ADMIN = 'usr_edit_admin';
const MEMBER = 'usr_edit_member';
const OUTSIDER = 'usr_edit_outsider';

const TERM = `---
kind: term
id: term.cpr
title: "CPR — Código de Prioridad de Riesgo"
domain: "Seguridad y salud"
status: draft
tags: ["glosario", "seguridad"]
aliases: ["CPR"]
terms: ["term.iper"]
sources: ["rs-01-02"]  # kept as written
---

Valor de 1 a 4.`;

const ROAS = `---
kind: metric
id: metric.roas
title: ROAS
description: { es: Ingresos atribuidos ÷ inversión }
source: { connection: conn_ads, fqn: analytics.ads_daily }
type: ratio
numerator: { agg: sum, expr: revenue }
denominator: { agg: sum, expr: spend }
time: { dimension: date, grains: [day, month] }
---

Return on ad spend.`;

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
const patch = (user: string, id: string, body: unknown, headers?: Record<string, string>) =>
  call(user, 'PATCH', `/entries/${encodeURIComponent(id)}`, body, headers);
const file = async (path: string) => (await listCatalogFiles(e, WS)).find((f) => f.path === path)!;

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'a@agencia.example', 'Ana'), (?, 'm@agencia.example', 'Mario'), (?, 'o@else.example', 'Otto')")
      .bind(ADMIN, MEMBER, OUTSIDER),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Agencia', 'agencia-edit', ?)").bind(WS, ADMIN),
    e.DB.prepare(
      `INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
        ('wm_e1', ?, ?, 'admin', 'internal'), ('wm_e2', ?, ?, 'member', 'internal')`
    ).bind(WS, ADMIN, WS, MEMBER),
  ]);
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM catalog_certifications');
  await e.DB.exec('DELETE FROM workspace_files');
  await e.DB.exec('DELETE FROM catalog_settings');
  await setCatalogEnabled(e, WS, true);
  await upsertCatalogFile(e, WS, { path: 'terms/cpr.md', content: TERM, source: 'seed:connector' });
  await upsertCatalogFile(e, WS, { path: 'metrics/roas.md', content: ROAS });
});

describe('applyEntryEdit', () => {
  it('changes only the fields sent and keeps every other key and comment', () => {
    const out = applyEntryEdit(TERM, { title: 'CPR', tags: ['glosario'], body: 'Nuevo texto.' })!;
    expect(out).toContain('tags: [glosario]');
    expect(out).toContain('sources: ["rs-01-02"] # kept as written');
    expect(out).toContain('aliases: ["CPR"]');
    expect(out).toContain('status: draft');
    expect(out.endsWith('---\n\nNuevo texto.\n')).toBe(true);
    const { entry } = parseEntry('terms/cpr.md', out);
    expect(entry).toMatchObject({ id: 'term.cpr', kind: 'term', title: 'CPR', tags: ['glosario'], aliases: ['CPR'], body: 'Nuevo texto.' });
    expect(entry!.extra).toEqual({ sources: ['rs-01-02'] });
  });

  it('removes a text key on null and a list key on []; keeps the body when not sent', () => {
    const out = applyEntryEdit(TERM, { domain: null, terms: [] })!;
    const { entry } = parseEntry('terms/cpr.md', out);
    expect(entry!.domain).toBeUndefined();
    expect(entry!.terms).toEqual([]);
    expect(out).not.toMatch(/^domain:/m);
    expect(entry!.body).toBe('Valor de 1 a 4.');
  });

  it('refuses frontmatter it cannot rewrite', () => {
    expect(applyEntryEdit('no frontmatter', { title: 'x' })).toBeNull();
    expect(applyEntryEdit('---\n- a list\n---\n', { title: 'x' })).toBeNull();
  });
});

describe('normalizeEntryEdit', () => {
  it('trims, dedupes lists and turns an empty domain into a removal', () => {
    expect(normalizeEntryEdit({ title: ' CPR ', domain: ' ', tags: [' a ', 'a', '', 'b'] })).toEqual({
      edit: { title: 'CPR', domain: null, tags: ['a', 'b'] },
    });
  });

  it('refuses id, kind, status and other unknown keys, an empty title, wrong types and an empty edit', () => {
    for (const [input, param] of [
      [{ id: 'x' }, 'id'], [{ kind: 'metric' }, 'kind'], [{ status: 'certified' }, 'status'],
      [{ title: '  ' }, 'title'], [{ tags: 'a, b' }, 'tags'], [{ body: 5 }, 'body'],
    ] as const) {
      expect(normalizeEntryEdit(input), JSON.stringify(input)).toMatchObject({ ok: false, status: 400, code: 'INVALID_EDIT', param });
    }
    expect(normalizeEntryEdit({})).toMatchObject({ ok: false, code: 'INVALID_EDIT' });
    expect(normalizeEntryEdit(null)).toMatchObject({ ok: false, code: 'INVALID_EDIT' });
  });
});

describe('updateCatalogEntry', () => {
  it('saves as a manual file with its author, so connector re-seeds leave it alone', async () => {
    const r = await updateCatalogEntry(e, WS, 'term.cpr', { title: 'CPR' }, { id: MEMBER, kind: 'user' });
    expect(r).toMatchObject({ ok: true, path: 'terms/cpr.md', changed: ['title'] });
    expect(await file('terms/cpr.md')).toMatchObject({ source: 'manual', updatedBy: MEMBER, updatedByKind: 'user' });
  });

  it('finds the entry by an alias', async () => {
    const r = await updateCatalogEntry(e, WS, 'CPR', { owner: 'Rubén' }, { id: MEMBER, kind: 'user' });
    expect(r).toMatchObject({ ok: true, changed: ['owner'] });
  });

  it('writes nothing when the edit matches what the file already says', async () => {
    const before = await file('terms/cpr.md');
    const r = await updateCatalogEntry(e, WS, 'term.cpr', { aliases: ['CPR'] }, { id: MEMBER, kind: 'user' });
    expect(r).toMatchObject({ ok: true, changed: [] });
    expect(await file('terms/cpr.md')).toEqual(before);
  });

  it('404s an unknown entry and keeps a metric spec valid', async () => {
    expect(await updateCatalogEntry(e, WS, 'nope', { title: 'x' }, { id: MEMBER, kind: 'user' })).toMatchObject({ ok: false, status: 404 });
    const ok = await updateCatalogEntry(e, WS, 'metric.roas', { title: 'ROAS (paid)', tags: ['ads'] }, { id: MEMBER, kind: 'user' });
    expect(ok).toMatchObject({ ok: true, changed: ['title', 'tags'] });
  });

  it('refuses an edit that would pass the file size cap', async () => {
    const r = await updateCatalogEntry(e, WS, 'term.cpr', { body: 'x'.repeat(130 * 1024) }, { id: MEMBER, kind: 'user' });
    expect(r).toMatchObject({ ok: false, status: 413, code: 'FILE_TOO_LARGE' });
  });
});

describe('PATCH …/catalog/entries/{id}', () => {
  it('lets a member edit and returns the entry as everyone now reads it', async () => {
    const res = await patch(MEMBER, 'term.cpr', { title: 'CPR', body: 'Prioridad 1 a 4.' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, changed: ['title', 'body'], entry: { id: 'term.cpr', title: 'CPR', body: 'Prioridad 1 a 4.', status: 'draft' } });
    expect(res.body.entry.certification).toBeTruthy();
    const read = await call(MEMBER, 'GET', '/entries/term.cpr');
    expect(read.body.entry.title).toBe('CPR');
  });

  it('records a bearer-token edit as an agent write', async () => {
    await patch(ADMIN, 'term.cpr', { owner: 'SGI' }, { Authorization: 'Bearer so_test' });
    expect(await file('terms/cpr.md')).toMatchObject({ updatedBy: ADMIN, updatedByKind: 'agent' });
  });

  it('a certified entry shows as changed since certification after an edit', async () => {
    const cert = await call(ADMIN, 'POST', '/entries/term.cpr/certify', { decision: 'certified' });
    expect(cert.status).toBe(200);
    const res = await patch(MEMBER, 'term.cpr', { body: 'Otro texto.' });
    expect(res.body.entry.status).toBe('draft');
    expect(res.body.entry.certification).toMatchObject({ stale: true });
  });

  it('cannot certify through an edit', async () => {
    const res = await patch(MEMBER, 'term.cpr', { status: 'certified' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_EDIT', param: 'status' });
  });

  it('404s an unknown entry and 403s someone outside the workspace', async () => {
    expect((await patch(MEMBER, 'term.nope', { title: 'x' })).status).toBe(404);
    expect((await patch(OUTSIDER, 'term.cpr', { title: 'x' })).status).toBe(403);
    expect((await file('terms/cpr.md')).content).toBe(TERM);
  });
});
