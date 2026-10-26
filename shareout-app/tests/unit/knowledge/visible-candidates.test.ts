// Knowledge search picks its candidates for the member asking: another member's private
// near-duplicates don't crowd their passages out of the pool, chunks they can't see don't
// decide the all-terms-first rule, and D1 stays the final word on every result.
import { beforeAll, describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import type { Env } from '../../../src/types';
import { corpusFor, type SourceKind, type SourceMeta } from '../../../src/knowledge/corpus/client';
import { searchCorpus } from '../../../src/knowledge/corpus/search';
import { fromCorpus } from '../../../src/chat-agent/tools/passages';
import { setKnowledgeEnabled } from '../../../src/knowledge';

const e = env as unknown as Env;
let n = 0;
const nextWs = () => `wsp_vc_${++n}_${Date.now()}`;

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT NOT NULL, name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'workspace', folder_id TEXT, deleted_at TEXT, type_metadata TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, owner_id TEXT, visibility TEXT, workspace_id TEXT, deleted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT)`,
  ]) {
    await e.DB.exec(sql);
  }
});

interface Doc { id: string; texts: string[]; kind?: SourceKind; owner?: string; visibility?: string }

/** Sources as the product keeps them: a D1 row (who may see it) plus chunks in the workspace store. */
async function seed(ws: string, docs: Doc[]) {
  await setKnowledgeEnabled(e, ws, true);
  const rows = docs.map((d) => d.kind === 'page'
    ? e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility, workspace_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(d.id, d.id, d.id, d.owner ?? 'u1', d.visibility ?? 'workspace', ws)
    : e.DB.prepare('INSERT INTO asset_deliverables (id, workspace_id, owner_id, name, visibility) VALUES (?, ?, ?, ?, ?)')
      .bind(d.id, ws, d.owner ?? 'u1', d.id, d.visibility ?? 'workspace'));
  for (let i = 0; i < rows.length; i += 50) await e.DB.batch(rows.slice(i, i + 50));
  const store = corpusFor(e, ws)!;
  for (const d of docs) {
    const meta: SourceMeta = { refId: d.id, kind: d.kind ?? 'asset', version: 'v1', title: d.id, ownerId: d.owner ?? 'u1' };
    await store.replaceChunks(meta, d.texts.map((text, ord) => ({ ord, locator: '', text })));
    await store.setStatus(meta, 'ready');
  }
  return store;
}

/** The store's record of who may see a source. */
const recorded = (ws: string, refId: string) =>
  runInDurableObject(corpusFor(e, ws)!, (_o, state) =>
    state.storage.sql.exec('SELECT access, owner_id FROM sources WHERE ref_id = ?', refId).one());

/** An env that counts store picks and D1 access lookups (each one round trip). */
function counting() {
  const calls = { picks: 0, lookups: 0 };
  const ns = e.KNOWLEDGE_STORE;
  const env = {
    ...e,
    DB: new Proxy(e.DB, {
      get(t, p) {
        const v = Reflect.get(t, p, t) as unknown;
        if (typeof v !== 'function') return v;
        return (...a: unknown[]) => {
          if (p === 'batch') calls.lookups++;
          return (v as (...x: unknown[]) => unknown).apply(t, a);
        };
      },
    }),
    KNOWLEDGE_STORE: {
      idFromName: (name: string) => ns.idFromName(name),
      get: (id: DurableObjectId) => new Proxy(ns.get(id), {
        get(t, p) {
          if (p === 'then') return undefined;
          return (...a: unknown[]) => {
            if (p === 'searchCandidates') calls.picks++;
            return (t as unknown as Record<string, (...x: unknown[]) => unknown>)[p as string](...a);
          };
        },
      }),
    },
  } as unknown as Env;
  return { env, calls };
}

const ids = (r: { hits: { source: { id: string } }[] }) => r.hits.map((h) => h.source.id);

// 25 Files the member may see, and another member's two private copies of each (ids are
// per test: D1 ids are global).
const visibleDocs = (tag: string) =>
  Array.from({ length: 25 }, (_, i): Doc => ({ id: `dlv_${tag}_v${String(i).padStart(2, '0')}`, texts: [`Reintegro número ${i}: ${'detalle '.repeat(i % 7)}fin.`] }));
const privateCopies = (docs: Doc[]) => [1, 2].flatMap((k) => docs.map((d): Doc => ({ ...d, id: `${d.id}_copy${k}`, owner: 'u2', visibility: 'private' })));
const untag = (tag: string) => (id: string) => id.replace(`dlv_${tag}_`, '');

describe('candidates are picked for the member asking', () => {
  it('another member’s private near-duplicates no longer starve the results', async () => {
    const control = nextWs();
    const stress = nextWs();
    await seed(control, visibleDocs('c'));
    const docs = visibleDocs('s');
    const store = await seed(stress, [...docs, ...privateCopies(docs)]);
    // The scenario: by plain rank, most of the best 30 chunks are someone else's — a pool cut
    // before the access check left the member fewer than 20.
    expect((await store.search('reintegro', 30)).filter((h) => !h.refId.includes('_copy')).length).toBeLessThan(20);

    const want = ids(await searchCorpus(e, control, 'u1', 'reintegro', { limit: 20 })).map(untag('c'));
    expect(want).toHaveLength(20);
    for (let round = 0; round < 2; round++) expect(ids(await searchCorpus(e, stress, 'u1', 'reintegro', { limit: 20 })).map(untag('s'))).toEqual(want);
    // The owner of the copies still finds them.
    expect(ids(await searchCorpus(e, stress, 'u2', 'reintegro', { limit: 30 })).filter((id) => id.includes('_copy')).length).toBeGreaterThan(0);
  });

  it('counts only chunks the member may see before answering with every term', async () => {
    const ws = nextWs();
    await seed(ws, [
      ...Array.from({ length: 5 }, (_, i): Doc => ({ id: `dlv_both${i}`, texts: [`Contrato de logística regional ${i}.`] })),
      ...Array.from({ length: 25 }, (_, i): Doc => ({ id: `dlv_one${String(i).padStart(2, '0')}`, texts: [`Logística de puerto ${i}.`] })),
      ...Array.from({ length: 40 }, (_, i): Doc => ({ id: `dlv_priv${String(i).padStart(2, '0')}`, texts: [`Contrato de logística ${i}.`], owner: 'u2', visibility: 'private' })),
    ]);
    // 5 chunks the member may see hold both terms, 40 private ones do too: not enough for
    // the member, so they get chunks holding any term — the five first.
    const member = ids(await searchCorpus(e, ws, 'u1', 'contrato logística', { limit: 20 }));
    expect(member).toHaveLength(20);
    expect(member.slice(0, 5).sort()).toEqual(['dlv_both0', 'dlv_both1', 'dlv_both2', 'dlv_both3', 'dlv_both4']);
    expect(member.every((id) => !id.startsWith('dlv_priv'))).toBe(true);
    // Their owner sees 45 chunks holding both terms: every result holds both.
    const owner = ids(await searchCorpus(e, ws, 'u2', 'contrato logística', { limit: 20 }));
    expect(owner).toHaveLength(20);
    expect(owner.every((id) => id.startsWith('dlv_priv') || id.startsWith('dlv_both'))).toBe(true);
  });

  it('keeps Files out of a pages-only search without using up its limit', async () => {
    const ws = nextWs();
    await seed(ws, [
      ...Array.from({ length: 6 }, (_, i): Doc => ({ id: `dlv_f${i}`, texts: [`Cisterna ${i}: cisterna, cisterna y cisterna.`] })),
      ...Array.from({ length: 6 }, (_, i): Doc => ({ id: `art_p${i}`, kind: 'page', texts: [`Mantenimiento de la cisterna, página ${i}, con más texto alrededor.`] })),
    ]);
    const passages = await fromCorpus(e, 'u1', [ws], 'cisterna');
    expect(passages).toHaveLength(5);
    expect(passages.every((p) => p.artifact.id.startsWith('art_p'))).toBe(true);
  });
});

describe('D1 stays the final word on access', () => {
  it('never returns a source the store still records as visible once D1 says private', async () => {
    const ws = nextWs();
    await seed(ws, [{ id: 'dlv_a', texts: ['Presupuesto anual aprobado.'], owner: 'u2' }, { id: 'dlv_b', texts: ['Presupuesto trimestral.'] }]);
    expect(ids(await searchCorpus(e, ws, 'u1', 'presupuesto')).sort()).toEqual(['dlv_a', 'dlv_b']);
    expect(await recorded(ws, 'dlv_a')).toEqual({ access: 'all', owner_id: 'u2' });

    await e.DB.prepare("UPDATE asset_deliverables SET visibility = 'private' WHERE id = 'dlv_a'").run();
    expect(ids(await searchCorpus(e, ws, 'u1', 'presupuesto'))).toEqual(['dlv_b']);
    expect(ids(await searchCorpus(e, ws, 'u2', 'presupuesto')).sort()).toEqual(['dlv_a', 'dlv_b']);
    expect(await recorded(ws, 'dlv_a')).toEqual({ access: 'owner', owner_id: 'u2' });
  });

  it('ignores a record that claims a private source is visible', async () => {
    const ws = nextWs();
    const store = await seed(ws, [{ id: 'dlv_s', texts: ['Bandas salariales de ingeniería.'], owner: 'u2', visibility: 'private' }]);
    await store.recordAccess([{ refId: 'dlv_s', access: 'all', ownerId: 'u2' }]);
    expect((await searchCorpus(e, ws, 'u1', 'bandas salariales')).hits).toEqual([]);
    expect(await recorded(ws, 'dlv_s')).toEqual({ access: 'owner', owner_id: 'u2' });
  });

  it('finds a source made visible since the store recorded it as private', async () => {
    const ws = nextWs();
    await seed(ws, [{ id: 'dlv_p', texts: ['Calendario de lanzamientos.'], owner: 'u2', visibility: 'private' }]);
    expect((await searchCorpus(e, ws, 'u1', 'calendario')).hits).toEqual([]);
    expect(await recorded(ws, 'dlv_p')).toEqual({ access: 'owner', owner_id: 'u2' });

    await e.DB.prepare("UPDATE asset_deliverables SET visibility = 'workspace' WHERE id = 'dlv_p'").run();
    expect(ids(await searchCorpus(e, ws, 'u1', 'calendario'))).toEqual(['dlv_p']);
    expect(await recorded(ws, 'dlv_p')).toEqual({ access: 'all', owner_id: 'u2' });
  });

  it('keeps a page awaiting moderation out, even for its owner', async () => {
    const ws = nextWs();
    await seed(ws, [{ id: 'art_m', kind: 'page', texts: ['Informe de flota.'] }]);
    expect(ids(await searchCorpus(e, ws, 'u1', 'flota'))).toEqual(['art_m']);
    await e.DB.prepare("INSERT INTO artifact_moderation (artifact_id, status) VALUES ('art_m', 'pending')").run();
    expect((await searchCorpus(e, ws, 'u1', 'flota')).hits).toEqual([]);
  });
});

describe('search cost stays bounded', () => {
  it('settles in one store pick and one D1 round trip once the store knows its sources', async () => {
    const ws = nextWs();
    const docs = visibleDocs('l');
    await seed(ws, [...docs, ...privateCopies(docs)]);
    const { env: counted, calls } = counting();
    // First search over a store that has never been checked: a few picks at most.
    expect(ids(await searchCorpus(counted, ws, 'u1', 'reintegro', { limit: 20 }))).toHaveLength(20);
    expect(calls.picks).toBeGreaterThan(1);
    expect(calls.picks).toBeLessThanOrEqual(4);
    expect(calls.lookups).toBe(calls.picks);
    // From then on: one pick, one lookup, whatever the private copies.
    for (const q of ['reintegro', 'reintegro número', 'detalle']) {
      calls.picks = 0;
      calls.lookups = 0;
      await searchCorpus(counted, ws, 'u1', q, { limit: 20 });
      expect({ q, ...calls }).toEqual({ q, picks: 1, lookups: 1 });
    }
  });

  it('falls back to the plain top chunks when the store predates candidate picking', async () => {
    const ws = nextWs();
    await seed(ws, [{ id: 'dlv_o', texts: ['Política de viáticos.'] }, { id: 'dlv_x', texts: ['Viáticos del directorio.'], owner: 'u2', visibility: 'private' }]);
    const ns = e.KNOWLEDGE_STORE;
    const old = {
      ...e,
      KNOWLEDGE_STORE: {
        idFromName: (name: string) => ns.idFromName(name),
        get: (id: DurableObjectId) => new Proxy(ns.get(id), {
          get(t, p) {
            if (p === 'then') return undefined;
            if (p === 'searchCandidates') return async () => { throw new TypeError('The RPC receiver does not implement the method "searchCandidates".'); };
            return (...a: unknown[]) => (t as unknown as Record<string, (...x: unknown[]) => unknown>)[p as string](...a);
          },
        }),
      },
    } as unknown as Env;
    expect(ids(await searchCorpus(old, ws, 'u1', 'viáticos'))).toEqual(['dlv_o']);
  });
});
