import { describe, it, expect } from 'vitest';
import {
  isInternalProvenanceSource,
  pickSnapshotQuery,
  buildProvenanceFromSnapshotConfig,
  extractTablesFromSql,
  extractSelectColumns,
  extractWhereFilters,
  resolveDeliverySource,
} from '../../../src/crew/tools/source-provenance';
import type { Env } from '../../../src/types';

describe('isInternalProvenanceSource', () => {
  it('flags json_get and table_query tool references', () => {
    expect(isInternalProvenanceSource({ query: "json_get('digest')" })).toBe(true);
    expect(isInternalProvenanceSource({ label: 'digest (json_get)' })).toBe(true);
    expect(isInternalProvenanceSource({ query: 'table_query("sales")' })).toBe(true);
  });

  it('allows warehouse SQL', () => {
    expect(
      isInternalProvenanceSource({
        connection: 'bigquery',
        query: 'SELECT 1 FROM `proj.dataset.table`',
      })
    ).toBe(false);
  });
});

describe('pickSnapshotQuery', () => {
  it('prefers digest trends query', () => {
    const sql = pickSnapshotQuery({
      connection: 'bigquery',
      queries: [
        { query: 'SELECT 1', target: { type: 'json', name: 'snapshot', path: 'kpis' } },
        { query: 'SELECT trends', target: { type: 'json', name: 'digest', path: 'trends' } },
        { query: 'SELECT platform', target: { type: 'json', name: 'digest', path: 'by_platform' } },
      ],
    });
    expect(sql).toBe('SELECT trends');
  });
});

describe('buildProvenanceFromSnapshotConfig', () => {
  it('extracts tables, columns, and filters from digest SQL', () => {
    const prov = buildProvenanceFromSnapshotConfig({
      connection: 'bigquery',
      queries: [
        {
          query: `SELECT SUM(programmatic_revenue) AS last_day_revenue, AVG(dau) AS dau_7d_avg
FROM \`analytics-platform.bi_gold.revenue_actuals_vs_forecast\`
WHERE brand_name='Northwind' AND date_has_actuals=TRUE
GROUP BY 1`,
          target: { type: 'json', name: 'digest', path: 'trends' },
        },
        {
          query: `SELECT platform, SUM(dau) AS dau FROM \`analytics-platform.bi_gold.dau_and_session_metrics\`
WHERE brand=LOWER('Northwind')`,
          target: { type: 'json', name: 'digest', path: 'by_platform' },
        },
      ],
    });
    expect(prov?.connection).toBe('bigquery');
    expect(prov?.tables).toEqual([
      'bi_gold.dau_and_session_metrics',
      'bi_gold.revenue_actuals_vs_forecast',
    ]);
    expect(prov?.columns).toContain('last_day_revenue');
    expect(prov?.columns).toContain('dau_7d_avg');
    expect(prov?.filters).toContain("brand_name='Northwind'");
    expect(prov?.filters).toContain('date_has_actuals=TRUE');
  });
});

describe('sql extractors', () => {
  it('extractTablesFromSql dedupes dataset.table refs', () => {
    expect(
      extractTablesFromSql(
        'FROM `analytics-platform.bi_gold.revenue_actuals_vs_forecast` JOIN `analytics-platform.bi_gold.dau_and_session_metrics`'
      )
    ).toEqual(['bi_gold.revenue_actuals_vs_forecast', 'bi_gold.dau_and_session_metrics']);
  });

  it('extractSelectColumns collects AS aliases', () => {
    expect(extractSelectColumns('SELECT SUM(x) AS revenue, COUNT(*) AS n FROM t')).toEqual([
      'revenue',
      'n',
    ]);
  });

  it('extractWhereFilters splits AND predicates', () => {
    expect(
      extractWhereFilters("WHERE brand_name='Northwind' AND date_has_actuals=TRUE GROUP BY 1")
    ).toEqual(["brand_name='Northwind'", 'date_has_actuals=TRUE']);
  });
});

describe('resolveDeliverySource', () => {
  const config = {
    connection: 'bigquery',
    queries: [
      {
        query: 'SELECT rev AS last_day_revenue FROM `analytics-platform.bi_gold.revenue_actuals_vs_forecast` WHERE brand_name="Northwind"',
        target: { type: 'json', name: 'digest', path: 'trends' },
      },
    ],
  };
  const env = {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ config: JSON.stringify(config) }),
        }),
      }),
    },
  } as unknown as Env;

  it('replaces internal SDK source with query_snapshot provenance', async () => {
    const out = await resolveDeliverySource(env, 'art_test', {
      connection: 'team',
      label: 'digest (json_get)',
      query: "json_get('digest')",
      asOf: '2026-06-21',
    });

    expect(out).toMatchObject({
      connection: 'bigquery',
      asOf: '2026-06-21',
      query: 'SELECT rev AS last_day_revenue FROM `analytics-platform.bi_gold.revenue_actuals_vs_forecast` WHERE brand_name="Northwind"',
      columns: ['last_day_revenue'],
      filters: ['brand_name="Northwind"'],
    });
    expect(isInternalProvenanceSource(out)).toBe(false);
  });

  it('merges asOf-only input with query_snapshot provenance', async () => {
    const out = (await resolveDeliverySource(env, 'art_test', { asOf: '2026-06-21' })) as Record<
      string,
      unknown
    >;
    expect(out.asOf).toBe('2026-06-21');
    expect(out.connection).toBe('bigquery');
    expect(out.tables).toEqual(['bi_gold.revenue_actuals_vs_forecast']);
    expect(out.columns).toContain('last_day_revenue');
  });
});
