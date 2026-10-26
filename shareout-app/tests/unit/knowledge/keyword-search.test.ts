// Keyword search inside a KnowledgeStore: stemmed matches, AND→OR fallback, partial
// words, and the stemmed-index backfill an existing store runs on first access.
import { describe, expect, it } from 'vitest';
import { env, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import type { Env } from '../../../src/types';
import { corpusFor, type SourceMeta } from '../../../src/knowledge/corpus/client';
import { STEM_VERSION } from '../../../src/knowledge/corpus/lexical';
import type { KnowledgeStore } from '../../../src/knowledge/corpus/store-do';

const e = env as unknown as Env;
let n = 0;
const nextWs = () => `wsp_kw_${++n}_${Date.now()}`;
const meta = (refId: string): SourceMeta => ({ refId, kind: 'asset', version: 'v1', title: refId, ownerId: 'u1' });
const refs = (hits: { refId: string }[]) => hits.map((h) => h.refId);

async function seed(ws: string, sources: Record<string, string[]>) {
  const store = corpusFor(e, ws)!;
  for (const [refId, texts] of Object.entries(sources)) {
    await store.replaceChunks(meta(refId), texts.map((text, ord) => ({ ord, locator: '', text })));
    await store.setStatus(meta(refId), 'ready');
  }
  return store;
}

/** The store's backfill state, which tests drive directly instead of waiting on alarms. */
interface Backfill { stemCursor: number | null; prepareStemIndex(): number | null; stemNext(max: number): boolean }
const backfill = (store: KnowledgeStore) => store as unknown as Backfill;

const read = (sql: SqlStorage) => {
  const get = (key: string) => sql.exec('SELECT value FROM meta WHERE key = ?', key).toArray()[0]?.value;
  const count = (q: string, ...args: unknown[]) => sql.exec(q, ...args).one().n as number;
  return { get, count };
};

/** A store as the previous deploy left it: chunks and chunks_fts, no stemmed index. */
function forgetStemIndex(sql: SqlStorage) {
  sql.exec('DROP TABLE chunks_stem_vocab');
  sql.exec('DROP TABLE chunks_stem');
  sql.exec("DELETE FROM meta WHERE key IN ('stem_version', 'stem_cursor')");
}

const FILLER = Object.fromEntries(
  ['Guía de marca: logo sobre fondo blanco.', 'Minuta del equipo de diseño.', 'Indicadores de ausentismo del personal.',
    'Calendario de lanzamientos del trimestre.', 'Plan de remediación de seguridad.', 'Política de vacaciones pagas.']
    .map((text, i) => [`dlv_fill${i}`, [text]]),
);

describe('KnowledgeStore keyword search', () => {
  it('matches other forms of a word, with or without accents', async () => {
    const store = await seed(nextWs(), {
      ...FILLER,
      dlv_budget: ['Presupuesto aprobado: el directorio aprobó USD 48.000 para la campaña de invierno.'],
    });
    expect(refs(await store.search('presupuestos aprobados', 10))).toEqual(['dlv_budget']);
    expect(refs(await store.search('campana invierno', 10))).toEqual(['dlv_budget']);
    expect(refs(await store.search('presupues', 10))).toEqual(['dlv_budget']);
  });

  it('answers with chunks holding every term when there are enough, else falls back to any term', async () => {
    const contracts = ['alquiler de oficinas', 'servicios de limpieza', 'mantenimiento anual', 'licencias de software', 'seguros generales']
      .map((what, i) => [`dlv_k${i}`, [`Contrato de ${what}.`]]);
    const store = await seed(nextWs(), {
      ...Object.fromEntries(contracts),
      dlv_a: ['Contrato de logística.'],
      dlv_b: ['Contrato y logística regional.'],
      dlv_c: ['Logística de puerto, logística de frontera y logística urbana.'],
    });
    // Any term: BM25 puts the chunk that says "logística" three times first.
    const any = refs(await store.search('contratos logísticos', 3));
    expect(any[0]).toBe('dlv_c');
    expect(any.slice(1).sort()).toEqual(['dlv_a', 'dlv_b']);
    // Two chunks hold both terms, enough for a page of two: they answer alone.
    expect(refs(await store.search('contratos logísticos', 2)).sort()).toEqual(['dlv_a', 'dlv_b']);
  });

  it('drops stopwords, so a question finds its subject', async () => {
    const store = await seed(nextWs(), { ...FILLER, dlv_q: ['La licencia por paternidad es de 10 días corridos.'] });
    expect(refs(await store.search('¿Cuántos días de licencia tiene un empleado cuando nace su hijo?', 10))).toEqual(['dlv_q']);
    // Only stopwords: searched as typed rather than not at all.
    expect(refs(await store.search('¿Qué es lo que hay?', 10))).toEqual(['dlv_q']);
  });
});

describe('KnowledgeStore stemmed-index backfill', () => {
  it('still searches every chunk while the index is built, by words as typed', async () => {
    const store = await seed(nextWs(), { ...FILLER, dlv_a: ['Presupuesto aprobado para la campaña de invierno.'] });
    await runInDurableObject(store, (instance, state) => {
      forgetStemIndex(state.storage.sql);
      const b = backfill(instance);
      b.stemCursor = b.prepareStemIndex();
      expect(b.stemCursor).toBe(0);
      expect(refs(instance.search('presupuesto', 10))).toEqual(['dlv_a']);
      expect(instance.search('presupuestos aprobados', 10)).toEqual([]);
      while (b.stemNext(2));
      expect(b.stemCursor).toBeNull();
      expect(refs(instance.search('presupuestos aprobados', 10))).toEqual(['dlv_a']);
    });
  });

  it('keeps the index in step with writes made while it is being built', async () => {
    const store = await seed(nextWs(), {
      dlv_a: ['uno presupuesto', 'dos presupuesto', 'tres presupuesto'],
      dlv_b: ['cuatro vacaciones', 'cinco vacaciones'],
    });
    await runInDurableObject(store, (instance, state) => {
      const sql = state.storage.sql;
      forgetStemIndex(sql);
      const b = backfill(instance);
      b.stemCursor = b.prepareStemIndex();
      b.stemNext(2);
      instance.replaceChunks(meta('dlv_a'), [{ ord: 0, locator: '', text: 'calendario nuevo' }, { ord: 1, locator: '', text: 'calendario viejo' }]);
      instance.removeSource('dlv_b');
      while (b.stemNext(2));
      const { count } = read(sql);
      const matching = (stem: string) => count('SELECT COUNT(*) AS n FROM chunks_stem WHERE chunks_stem MATCH ?', stem);
      expect({
        stemmed: count('SELECT COUNT(*) AS n FROM chunks_stem'),
        chunks: count('SELECT COUNT(*) AS n FROM chunks'),
        presupuest: matching('presupuest'),
        vacacion: matching('vacacion'),
        calendari: matching('calendari'),
      }).toEqual({ stemmed: 2, chunks: 2, presupuest: 0, vacacion: 0, calendari: 2 });
    });
  });

  it('rebuilds an outdated index from stored chunks on first access, once', async () => {
    const store = await seed(nextWs(), { ...FILLER, dlv_a: ['Presupuesto aprobado para la campaña de invierno.'] });
    await runInDurableObject(store, (_i, state) => {
      const sql = state.storage.sql;
      sql.exec("UPDATE meta SET value = '0' WHERE key = 'stem_version'");
      sql.exec("INSERT INTO chunks_stem (rowid, title, text) VALUES (999, 'viejo', 'stale')");
    });
    await evictDurableObject(store);

    expect(refs(await store.search('presupuesto', 10))).toEqual(['dlv_a']);
    for (let i = 0; i < 50 && !(await runInDurableObject(store, (inst) => backfill(inst).stemCursor === null)); i++) {
      await runDurableObjectAlarm(store);
    }
    const state = () => runInDurableObject(store, async (_i, s) => {
      const { get, count } = read(s.storage.sql);
      return {
        version: get('stem_version'),
        cursor: get('stem_cursor'),
        alarm: await s.storage.getAlarm(),
        stemmed: count('SELECT COUNT(*) AS n FROM chunks_stem'),
        chunks: count('SELECT COUNT(*) AS n FROM chunks'),
        stale: count("SELECT COUNT(*) AS n FROM chunks_stem WHERE chunks_stem MATCH 'stale'"),
      };
    });
    const built = { version: String(STEM_VERSION), cursor: undefined, alarm: null, stemmed: 7, chunks: 7, stale: 0 };
    expect(await state()).toEqual(built);
    expect(refs(await store.search('presupuestos aprobados', 10))).toEqual(['dlv_a']);

    await evictDurableObject(store);
    expect(refs(await store.search('presupuestos aprobados', 10))).toEqual(['dlv_a']);
    expect(await state()).toEqual(built);
  });
});
