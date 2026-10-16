// @vitest-environment happy-dom
// The palette ranks the local search index in the browser on every keystroke. These run
// the shipped engine source (search-engine.ts) on its own, on real clocks (the workers pool freezes them).
import { describe, expect, it } from 'vitest';
import { workspace_client_search_engine_JS as engineJs } from '../../../src/pages/home/render-workspace/client-script/search-engine';

interface Item { kind: string; id: string; title: string; _n: string; _t: string; _d: string; _u?: number }
interface Engine { fold(s: string): string; rank(items: Item[], q: string, limit: number): Item[]; score(q: string, it: Item): number }

const engine = new Function(`${engineJs}\nreturn wsxSearch;`)() as Engine;
const now = Math.floor(Date.now() / 1000);
const item = (id: string, title: string, extra: Partial<Item> = {}): Item =>
  ({ kind: 'artifact', id, title, _n: engine.fold(title), _t: '', _d: '', ...extra });

describe('local ranking', () => {
  it('folds case and accents both ways', () => {
    expect(engine.fold('  Clasificación   de RESIDUOS ')).toBe('clasificacion de residuos');
    const items = [item('a', 'Clasificación de residuos'), item('b', 'Otra cosa')];
    expect(engine.rank(items, 'clasificacion', 5).map((i) => i.id)).toEqual(['a']);
    expect(engine.rank(items, 'CLASIFICACIÓN', 5).map((i) => i.id)).toEqual(['a']);
    expect(engine.rank([item('c', 'Clasificacion sin tilde')], 'clasificación', 5).map((i) => i.id)).toEqual(['c']);
  });

  it('prefix beats word-start beats substring beats fuzzy subsequence', () => {
    const items = [
      item('fuzzy', 'Revisión de ventas'), // r-e-v…n-u-e: subsequence only
      item('inner', 'Prerevenue notes'), // substring inside a word
      item('word', 'Q3 revenue plan'), // word start
      item('prefix', 'Revenue dashboard'), // prefix
    ];
    expect(engine.rank(items, 'revenue', 10).map((i) => i.id)).toEqual(['prefix', 'word', 'inner']);
    const typo = [item('fuzzy', 'Revenue'), item('none', 'Pipeline')];
    expect(engine.rank(typo, 'revnue', 10).map((i) => i.id)).toEqual(['fuzzy']);
    expect(engine.score('rev', item('p', 'Revenue'))).toBeGreaterThan(engine.score('rev', item('w', 'Q3 revenue')));
    expect(engine.score('rvn', item('f', 'Revenue'))).toBeLessThan(engine.score('rev', item('w', 'Q3 revenue')));
  });

  it('recency boosts within a tier but never lifts fuzzy over prefix', () => {
    const fresh = item('fresh', 'Report weekly', { _u: now });
    const old = item('old', 'Report monthly', { _u: now - 200 * 86400 });
    expect(engine.rank([old, fresh], 'report', 2).map((i) => i.id)).toEqual(['fresh', 'old']);
    const freshFuzzy = item('ff', 'Rxexpxoxrxt', { _u: now });
    const oldPrefix = item('op', 'Report', { _u: now - 400 * 86400 });
    expect(engine.rank([freshFuzzy, oldPrefix], 'report', 2)[0].id).toBe('op');
  });

  it('matches tags and descriptions below the name', () => {
    const byTag = item('tag', 'Untitled', { _t: engine.fold('finanzas q3') });
    const byName = item('name', 'Finanzas 2026');
    const byDesc = item('desc', 'Notes', { _d: engine.fold('resumen de finanzas') });
    expect(engine.rank([byDesc, byTag, byName], 'finanzas', 3).map((i) => i.id)).toEqual(['name', 'tag', 'desc']);
  });

  it('every word must appear for a multi-word query', () => {
    const items = [item('both', 'Ventas por region norte'), item('one', 'Ventas totales')];
    expect(engine.rank(items, 'norte ventas', 5).map((i) => i.id)).toEqual(['both']);
  });

  it('ranks 3,000 items in under 16 ms per keystroke', () => {
    const words = ['ventas', 'clasificación', 'informe', 'revenue', 'pipeline', 'equipo', 'métricas', 'cohorte', 'retención', 'campaña'];
    const items: Item[] = [];
    for (let i = 0; i < 3000; i++) {
      const title = `${words[i % 10]} ${words[(i * 7) % 10]} ${i} ${words[(i * 3) % 10]}`;
      items.push(item(`a${i}`, title, {
        _t: engine.fold(`${words[(i * 5) % 10]} tag${i % 40} slug-${i}`),
        _d: engine.fold(`Descripción breve del artefacto ${i} con ${words[(i * 9) % 10]} y más texto de relleno`),
        _u: now - (i % 120) * 86400,
      }));
    }
    const queries = ['v', 've', 'ven', 'vent', 'venta', 'ventas', 'clasif', 'clasificacion', 'retncion', 'zzzz', 'equipo met', 'informe 1234'];
    for (const q of queries) engine.rank(items, q, 6); // warm up the JIT
    const times: number[] = [];
    for (let round = 0; round < 3; round++) {
      for (const q of queries) {
        const t0 = performance.now();
        engine.rank(items, q, 6);
        times.push(performance.now() - t0);
      }
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    console.log(`local ranking, 3000 items: median ${times[times.length >> 1].toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${times[times.length - 1].toFixed(2)} ms`);
    expect(p95).toBeLessThan(16);
    expect(engine.rank(items, 'clasificacion', 6)).toHaveLength(6);
  });
});
