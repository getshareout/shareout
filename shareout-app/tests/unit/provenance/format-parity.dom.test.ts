// @vitest-environment happy-dom
// The words for a data source come from two twins: shared/data-sources/format.ts (editor)
// and the inline-script soDsFormat (viewer panel, Studio tab). Same copy, same rules.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_SOURCES_COPY, type DataSourcesLocale } from '../../../shared/data-sources/copy';
import { createSourceFormatter, type SourceFormatter } from '../../../shared/data-sources/format';
import { DATA_SOURCES_FORMAT_JS } from '../../../src/serve/sandbox-viewer/data-sources/format-js';
import type { DataSource } from '../../../shared/data-sources/types';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const base = (over: Partial<DataSource>): DataSource => ({
  key: 'json:snapshot', kind: 'json', label: 'Resumen', provider: 'shareout', provider_label: null,
  declared: true, direct: true, freshness: {}, feeds: [], feed_count: 0, upstream: [], access: 'summary', ...over,
});
const SOURCES: DataSource[] = [
  base({ freshness: { last_refresh_at: '2026-10-25T09:40:00Z', refresher: { type: 'job', name: 'Ads diario' } }, feed_count: 3, upstream: ['connection:~1'] }),
  base({ key: 'table:leads', kind: 'table', label: 'leads', freshness: { last_refresh_at: '2026-10-25T11:59:30Z', refresher: { type: 'crew' } }, feed_count: 1 }),
  base({ key: 'table:x', kind: 'table', label: 'x', freshness: { refresher: { type: 'crew', name: 'Resumen semanal' } } }),
  base({ key: 'dataset:d', kind: 'dataset', label: 'd', freshness: { last_refresh_at: '2026-10-24T10:00:00Z' } }),
  base({ key: 'dataset:e', kind: 'dataset', label: 'e', freshness: { last_refresh_at: '2026-09-01T10:00:00Z' } }),
  base({ key: 'json:asof', freshness: { as_of: '2026-06-22' } }),
  base({ key: 'json:refresh', freshness: { refresh: 'daily 12:00 UTC' } }),
  base({ key: 'json:manual', freshness: { refresher: { type: 'manual' } } }),
  base({ key: 'json:~2', label: 'json', provider_label: null }),
  base({ key: 'connection:~1', kind: 'connection', label: 'connection', provider: 'google-ads', provider_label: 'Google Ads', direct: false }),
  base({ key: 'connection:warehouse', kind: 'connection', label: 'warehouse', provider: 'bigquery', provider_label: 'BigQuery', freshness: { refresher: { type: 'live' } } }),
  base({ key: 'mcp:hub', kind: 'mcp', label: 'hub', provider: 'mcp', provider_label: 'MCP', freshness: { refresher: { type: 'live' } } }),
  base({ key: 'knowledge:workspace', kind: 'knowledge', label: 'knowledge' }),
  base({ key: 'file:uploads', kind: 'file', label: 'uploads' }),
  // Public-link viewers: no names, the schedule in words when it reads well.
  base({ key: 'json:g1', freshness: { last_refresh_at: '2026-10-25T09:40:00Z', refresher: { type: 'job', schedule: '0 6 * * *' } } }),
  base({ key: 'json:g2', freshness: { refresher: { type: 'crew', schedule: '0 9 * * 1' } } }),
  base({ key: 'json:g3', freshness: { refresher: { type: 'job', schedule: '15 8 * * 1-5' } } }),
  base({ key: 'json:g4', freshness: { refresher: { type: 'job', schedule: '*/10 * * * *' } } }),
  base({ key: 'json:g5', freshness: { refresher: { type: 'job', schedule: '0 */6 * * *' } } }),
  base({ key: 'json:g6', freshness: { refresher: { type: 'job', schedule: '0 7 1 * *' } } }),
  base({ key: 'json:g7', freshness: { refresher: { type: 'job', schedule: '0 7,19 * * *' } } }),
  base({ key: 'json:g8', freshness: { refresher: { type: 'job' } } }),
];
const byKey = Object.fromEntries(SOURCES.map((s) => [s.key, s]));
const DETAILS: DataSource['details'][] = [
  undefined,
  { query: 'SELECT 1' },
  {
    connection: { id: 'c', name: 'warehouse', scope: 'artifact', kind: 'generic', credential_scope: 'shared' },
    tables: ['A', 'B'],
    refreshers: [
      { type: 'job', id: 'j', name: 'Ads', schedule: '0 6 * * *', enabled: true, last_status: 'failed' },
      { type: 'sync', id: 's', name: 'Ventas', enabled: false },
      { type: 'crew', id: 'w', name: 'Semanal', enabled: true },
    ],
    tools: ['a', 'b'], hosts: ['api.example.test'],
    replication: { credentials: 'vault', build: 'make', publish: 'node p.mjs', notes: 'n' },
    manage: { connections: '/c', jobs: '/j', data: '/d' },
  },
  { missing_connection: 'gone' },
];

type JsFormatter = Omit<SourceFormatter, 'details'> & { details: SourceFormatter['details'] };
function jsFormatter(lang: DataSourcesLocale): JsFormatter {
  const make = new Function(`${DATA_SOURCES_FORMAT_JS}; return soDsFormat;`)() as (c: unknown, l: string) => JsFormatter;
  return make(DATA_SOURCES_COPY[lang], lang);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe.each(['en', 'es'] as const)('data source wording (%s)', (lang) => {
  it('the editor formatter and the inline twin say the same thing', () => {
    const ts = createSourceFormatter(DATA_SOURCES_COPY[lang], lang);
    const js = jsFormatter(lang);
    for (const s of SOURCES) {
      expect(js.label(s), s.key).toBe(ts.label(s));
      expect(js.meta(s, byKey), s.key).toBe(ts.meta(s, byKey));
      expect(js.feeds(s), s.key).toBe(ts.feeds(s));
    }
    for (const d of DETAILS) expect(JSON.parse(JSON.stringify(js.details(d)))).toEqual(ts.details(d));
  });
});

describe('the words themselves', () => {
  it('reads the way the copy promises', () => {
    const es = createSourceFormatter(DATA_SOURCES_COPY.es, 'es');
    const en = createSourceFormatter(DATA_SOURCES_COPY.en, 'en');
    expect(es.meta(SOURCES[0], byKey)).toBe('Desde Google Ads · Actualizado hace 2 h · por el job “Ads diario”');
    expect(en.meta(SOURCES[0], byKey)).toBe('From Google Ads · Updated 2 h ago · by the job “Ads diario”');
    expect(es.meta(SOURCES[1], byKey)).toBe('Actualizado recién · automáticamente');
    expect(es.meta(SOURCES[2], byKey)).toBe('Lo actualiza la tarea con IA “Resumen semanal”');
    expect(es.meta(SOURCES[3], byKey)).toBe('Actualizado ayer');
    expect(en.meta(SOURCES[4], byKey)).toBe('Updated on Sep 1, 2026');
    expect(es.meta(SOURCES[5], byKey)).toBe('Datos al 22 jun 2026');
    expect(es.meta(SOURCES[6], byKey)).toBe('Se actualiza: daily 12:00 UTC');
    expect(es.meta(SOURCES[7], byKey)).toBe('Se actualiza a mano');
    expect(es.meta(base({ key: 'json:none' }), byKey)).toBe('Actualización sin declarar');
    expect(es.label(SOURCES[8])).toBe('Datos guardados');
    expect(es.meta(SOURCES[10], byKey)).toBe('BigQuery · En vivo');
    expect(es.meta(SOURCES[11], byKey)).toBe('En vivo, con tu cuenta');
    expect(es.label(SOURCES[12])).toBe('Conocimiento del espacio');
    expect(es.feeds(SOURCES[0])).toBe('Alimenta: 3 elementos');
    expect(es.feeds(SOURCES[1])).toBe('Alimenta: 1 elemento');
    expect(es.feeds(SOURCES[2])).toBe('No está vinculada a elementos de la página');
    expect(es.details(DETAILS[2])?.rows).toContainEqual(['La actualiza', 'Job “Ads” · 0 6 * * * · la última vez falló']);
    expect(es.details(DETAILS[2])?.rows).toContainEqual(['La actualiza', 'Sincronización “Ventas” · en pausa']);
    expect(en.details(DETAILS[2])?.rows).toContainEqual(['Connection', 'warehouse · only this page · shared credentials']);
    expect(en.details(DETAILS[3])?.rows).toEqual([['Connection', 'No connection named “gone” here']]);
    expect(en.details({})).toBeNull();
  });

  it('says when a public-link viewer\'s data refreshes, never who refreshes it', () => {
    const es = createSourceFormatter(DATA_SOURCES_COPY.es, 'es');
    const en = createSourceFormatter(DATA_SOURCES_COPY.en, 'en');
    const g = (k: string) => byKey[`json:${k}`];
    expect(es.meta(g('g1'), byKey)).toBe('Actualizado hace 2 h · automáticamente, todos los días a las 06:00 UTC');
    expect(en.meta(g('g1'), byKey)).toBe('Updated 2 h ago · automatically, daily at 06:00 UTC');
    expect(es.meta(g('g2'), byKey)).toBe('Actualizado automáticamente, los lunes a las 09:00 UTC');
    expect(en.meta(g('g2'), byKey)).toBe('Updated automatically, every Monday at 09:00 UTC');
    expect(es.meta(g('g3'), byKey)).toBe('Actualizado automáticamente, de lunes a viernes a las 08:15 UTC');
    expect(en.meta(g('g4'), byKey)).toBe('Updated automatically, every hour');
    expect(es.meta(g('g5'), byKey)).toBe('Actualizado automáticamente, cada 6 horas');
    expect(en.meta(g('g6'), byKey)).toBe('Updated automatically, monthly on day 1 at 07:00 UTC');
    expect(es.meta(g('g7'), byKey)).toBe('Actualizado automáticamente');
    expect(en.meta(g('g8'), byKey)).toBe('Updated automatically');
  });
});
