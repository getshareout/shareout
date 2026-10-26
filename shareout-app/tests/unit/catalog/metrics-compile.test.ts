// The metric compiler: one golden per dialect (the SQL is the contract with each
// warehouse), and the cases that must never reach a database — quotes, `;`, comments,
// backslashes, identifiers the spec does not name, a scoped caller on an unscoped metric.
import { describe, expect, it } from 'vitest';
import { compileMetric, resolveQuery, type ResolvedQuery } from '../../../src/catalog/metrics/compile';
import { validateMetricSpec, type MetricSpec } from '../../../src/catalog/metrics/spec';
import { filterColumns, filterProblem, sqlLiteral, type Dialect } from '../../../src/catalog/metrics/sql-safety';
import type { CompileBase } from '../../../src/catalog/metrics/target';

function spec(data: Record<string, unknown>): MetricSpec {
  const r = validateMetricSpec({ kind: 'metric', id: 'metric.roas', title: 'ROAS', ...data });
  if (!r.ok) throw new Error(`${r.issue.param}: ${r.issue.message}`);
  return r.spec;
}

const ROAS = spec({
  source: { connection: 'conn_7f2', fqn: 'analytics.ads_daily' },
  type: 'ratio',
  numerator: { agg: 'sum', expr: 'revenue' },
  denominator: { agg: 'sum', expr: 'spend' },
  time: { dimension: 'date', grains: ['day', 'week', 'month'] },
  dimensions: [{ name: 'cliente', column: 'client_id' }, { name: 'canal', column: 'channel' }],
  filters: ["status = 'active'"],
  format: { kind: 'ratio', decimals: 2, suffix: 'x' },
  scope_field: 'client_id',
});

const MARCH: ResolvedQuery = { grain: 'month', by: ['canal'], from: '2026-03-01', to: '2026-03-31', where: { cliente: ["O'Brien", 7] } };
const SCOPE = { field: 'client_id', values: ['c1', 'c2'] };

function sql(s: MetricSpec, q: ResolvedQuery, dialect: Dialect, base: CompileBase, scope: { field: string; values: Array<string | number> } | null = null) {
  const r = compileMetric(s, q, { dialect, base }, scope);
  if (!r.ok) throw new Error(r.issue.message);
  return r.compiled.sql;
}

const FQN: CompileBase = { kind: 'fqn', fqn: 'analytics.ads_daily' };

describe('compileMetric — goldens per dialect', () => {
  it('BigQuery', () => {
    expect(sql(ROAS, MARCH, 'bigquery', FQN, SCOPE)).toMatchInlineSnapshot(`
      "SELECT
        FORMAT_DATE('%Y-%m-%d', DATE_TRUNC(DATE(so_base.date), MONTH)) AS so_period,
        so_base.channel AS so_d0,
        CAST(SUM(so_base.revenue) AS FLOAT64) / NULLIF(SUM(so_base.spend), 0) AS so_value,
        SUM(so_base.revenue) AS so_num,
        SUM(so_base.spend) AS so_den
      FROM (
        SELECT * FROM \`analytics.ads_daily\`
      ) so_base
      WHERE DATE(so_base.date) BETWEEN DATE '2026-03-01' AND DATE '2026-03-31'
        AND (status = 'active')
        AND so_base.client_id IN ('O\\'Brien', 7)
        AND so_base.client_id IN ('c1', 'c2')
      GROUP BY 1, 2
      ORDER BY 1, 2
      LIMIT 1000"
    `);
  });

  it('Snowflake', () => {
    expect(sql(ROAS, MARCH, 'snowflake', FQN, SCOPE)).toMatchInlineSnapshot(`
      "SELECT
        TO_CHAR(DATE_TRUNC('MONTH', CAST(so_base.date AS DATE)), 'YYYY-MM-DD') AS so_period,
        so_base.channel AS so_d0,
        CAST(SUM(so_base.revenue) AS FLOAT) / NULLIF(SUM(so_base.spend), 0) AS so_value,
        SUM(so_base.revenue) AS so_num,
        SUM(so_base.spend) AS so_den
      FROM (
        SELECT * FROM analytics.ads_daily
      ) so_base
      WHERE CAST(so_base.date AS DATE) BETWEEN TO_DATE('2026-03-01') AND TO_DATE('2026-03-31')
        AND (status = 'active')
        AND so_base.client_id IN ('O''Brien', 7)
        AND so_base.client_id IN ('c1', 'c2')
      GROUP BY 1, 2
      ORDER BY 1, 2
      LIMIT 1000"
    `);
  });

  it('Postgres family (Supabase, Redshift, Aurora PostgreSQL)', () => {
    expect(sql(ROAS, MARCH, 'postgres', FQN, SCOPE)).toMatchInlineSnapshot(`
      "SELECT
        TO_CHAR(DATE_TRUNC('month', CAST(so_base.date AS DATE)), 'YYYY-MM-DD') AS so_period,
        so_base.channel AS so_d0,
        CAST(SUM(so_base.revenue) AS DOUBLE PRECISION) / NULLIF(SUM(so_base.spend), 0) AS so_value,
        SUM(so_base.revenue) AS so_num,
        SUM(so_base.spend) AS so_den
      FROM (
        SELECT * FROM analytics.ads_daily
      ) so_base
      WHERE CAST(so_base.date AS DATE) BETWEEN DATE '2026-03-01' AND DATE '2026-03-31'
        AND (status = 'active')
        AND so_base.client_id IN ('O''Brien', 7)
        AND so_base.client_id IN ('c1', 'c2')
      GROUP BY 1, 2
      ORDER BY 1, 2
      LIMIT 1000"
    `);
  });

  it('a shared table on MiniDB (SQLite over JSON rows)', () => {
    const shared = spec({
      source: { shared_table: 'ads_daily' },
      type: 'ratio',
      numerator: { agg: 'sum', expr: 'Ingresos' },
      denominator: { agg: 'sum', expr: 'Inversión' },
      time: { dimension: 'Fecha', grains: ['week', 'month'] },
      dimensions: [{ name: 'canal', column: 'Canal' }],
      filters: ["Estado = 'activo'"],
      scope_field: 'cliente_id',
    });
    const q: ResolvedQuery = { grain: 'week', by: ['canal'], from: '2026-03-02', to: '2026-03-29', where: {} };
    expect(sql(shared, q, 'sqlite', { kind: 'rows', artifactId: 'art_1', table: 'ads_daily' }, { field: 'cliente_id', values: ['c1'] })).toMatchInlineSnapshot(`
      "SELECT
        date(so_base."Fecha", '-' || ((CAST(strftime('%w', so_base."Fecha") AS INTEGER) + 6) % 7) || ' days') AS so_period,
        so_base."Canal" AS so_d0,
        CAST(SUM(CAST(so_base."Ingresos" AS REAL)) AS REAL) / NULLIF(SUM(CAST(so_base."Inversión" AS REAL)), 0) AS so_value,
        SUM(CAST(so_base."Ingresos" AS REAL)) AS so_num,
        SUM(CAST(so_base."Inversión" AS REAL)) AS so_den
      FROM (
        SELECT json_extract(data, '$."Fecha"') AS "Fecha", json_extract(data, '$."Ingresos"') AS "Ingresos", json_extract(data, '$."Inversión"') AS "Inversión", json_extract(data, '$."Canal"') AS "Canal", json_extract(data, '$."cliente_id"') AS "cliente_id", json_extract(data, '$."Estado"') AS "Estado" FROM artifact_rows WHERE table_id = (SELECT id FROM artifact_tables WHERE artifact_id = 'art_1' AND name = 'ads_daily')
      ) so_base
      WHERE date(so_base."Fecha") BETWEEN '2026-03-02' AND '2026-03-29'
        AND (Estado = 'activo')
        AND so_base."cliente_id" IN ('c1')
      GROUP BY 1, 2
      ORDER BY 1, 2
      LIMIT 1000"
    `);
  });

  it('a simple metric with no time dimension and no grouping', () => {
    const orders = spec({ source: { connection: 'conn_7f2', sql: 'SELECT * FROM shop.orders -- all orders\n;' }, type: 'simple', measure: { agg: 'count', expr: '*' } });
    expect(sql(orders, { grain: null, by: [], from: null, to: null, where: {} }, 'postgres', { kind: 'sql', sql: orders.source.kind === 'sql' ? orders.source.sql : '' })).toMatchInlineSnapshot(`
      "SELECT
        COUNT(*) AS so_value
      FROM (
        SELECT * FROM shop.orders
      ) so_base
      LIMIT 1000"
    `);
  });
});

describe('resolveQuery', () => {
  const now = new Date('2026-10-25T15:00:00Z');

  it('defaults to the first grain and whole periods ending today', () => {
    expect(resolveQuery(ROAS, {}, now)).toEqual({ ok: true, query: { grain: 'day', by: [], where: {}, from: '2026-09-26', to: '2026-10-25' } });
    expect(resolveQuery(ROAS, { grain: 'week' }, now)).toMatchObject({ query: { from: '2026-08-03', to: '2026-10-25' } });
    expect(resolveQuery(ROAS, { grain: 'month' }, now)).toMatchObject({ query: { from: '2025-11-01', to: '2026-10-25' } });
  });

  it('refuses what the spec does not name', () => {
    expect(resolveQuery(ROAS, { by: ['region'] }, now)).toMatchObject({ ok: false, issue: { param: 'query.by' } });
    expect(resolveQuery(ROAS, { where: { client_id: ['c1'] } }, now)).toMatchObject({ ok: false, issue: { message: 'Unknown dimension "client_id"' } });
    expect(resolveQuery(ROAS, { grain: 'year' }, now)).toMatchObject({ ok: false, issue: { param: 'query.grain' } });
    expect(resolveQuery(ROAS, { from: '2026-03-01; DROP TABLE x' }, now)).toMatchObject({ ok: false, issue: { param: 'query.from' } });
    expect(resolveQuery(ROAS, { sql: 'SELECT 1' }, now)).toMatchObject({ ok: false, issue: { param: 'query.sql' } });
    expect(resolveQuery(ROAS, { from: '2016-01-01', to: '2026-12-31' }, now)).toMatchObject({ ok: false, issue: { param: 'from' } });
  });
});

describe('injection', () => {
  it('escapes quotes per dialect and refuses what it cannot escape', () => {
    expect(sqlLiteral('bigquery', "O'Brien \\ x")).toBe("'O\\'Brien \\\\ x'");
    expect(sqlLiteral('snowflake', "O'Brien \\ x")).toBe("'O''Brien \\\\ x'");
    expect(sqlLiteral('postgres', "O'Brien")).toBe("'O''Brien'");
    expect(sqlLiteral('sqlite', "x'); DROP TABLE artifact_rows; --")).toBe("'x''); DROP TABLE artifact_rows; --'");
    expect(sqlLiteral('postgres', 'a\\')).toBeNull();
    expect(sqlLiteral('sqlite', "a\\' OR 1=1")).toBeNull();
    expect(sqlLiteral('bigquery', 'line\nbreak')).toBeNull();
    expect(sqlLiteral('bigquery', Number.NaN)).toBeNull();
  });

  it('keeps a hostile dimension value inside its literal (one statement, nothing after it)', () => {
    const q = { ...MARCH, where: { canal: ["meta'); DELETE FROM ads; --", 'Set B'] } };
    for (const dialect of ['bigquery', 'snowflake', 'postgres'] as const) {
      const out = sql(ROAS, q, dialect, FQN);
      expect(out).toContain('so_base.channel IN (');
      expect(out.split('\n').at(-1)).toBe('LIMIT 1000');
    }
    expect(compileMetric(ROAS, { ...MARCH, where: { canal: ['a\\'] } }, { dialect: 'postgres', base: FQN }, null)).toMatchObject({ ok: false });
  });

  it('refuses filters that could break out of their parentheses or hide code', () => {
    expect(filterProblem("status = 'active'", null)).toBeNull();
    expect(filterProblem('1=1; DROP TABLE ads', null)).toMatch(/single condition|statement/);
    expect(filterProblem('1=1 -- and the rest', null)).toMatch(/comments/);
    expect(filterProblem('1=1 /* x */', null)).toMatch(/comments/);
    expect(filterProblem('1=1) OR (1=1', null)).toMatch(/parentheses/);
    expect(filterProblem("x = 'unterminated", null)).toMatch(/unterminated/);
    expect(filterProblem("x = 'a\\' ) OR (1=1 OR x = '", null)).toMatch(/backslash/);
    expect(filterProblem('id IN (SELECT id FROM other)', 'bigquery')).toBeNull();
    expect(filterProblem('id IN (SELECT id FROM artifact_json)', 'sqlite')).toMatch(/own columns/);
    expect(filterProblem("x = $$ ) $$", 'sqlite')).toMatch(/\$/);
    expect(filterProblem('1=1 OR pg_sleep(10) IS NULL; COMMIT', null)).not.toBeNull();
    expect(filterProblem('updated = 1 OR drop_flag = 0', null)).toBeNull();
    expect(filterProblem('x = 1 OR (DELETE FROM t) IS NULL', null)).toMatch(/delete/);
  });

  it('refuses a base SQL that is not one read-only SELECT', () => {
    const base = (s: string) => validateMetricSpec({ kind: 'metric', id: 'm', title: 'M', type: 'simple', measure: { agg: 'count', expr: '*' }, source: { connection: 'conn_1', sql: s } });
    expect(base('SELECT * FROM t')).toMatchObject({ ok: true });
    expect(base('SELECT * FROM t; DROP TABLE t')).toMatchObject({ ok: false, issue: { param: 'source.sql' } });
    expect(base('DELETE FROM t')).toMatchObject({ ok: false });
    expect(base('SELECT * FROM t) so_base UNION SELECT * FROM (SELECT * FROM secrets')).toMatchObject({ ok: false, issue: { message: expect.stringMatching(/parentheses/) } });
    // lexSql reads \' as an escaped quote; Postgres and SQLite do not, so where the
    // database is one of them a backslash never reaches it.
    const sneaky = "SELECT * FROM t WHERE x = 'a\\' OR 1=1 --'";
    expect(base(sneaky)).toMatchObject({ ok: true });
    const none0 = { grain: null, by: [], from: null, to: null, where: {} };
    const sneakySpec = spec({ source: { connection: 'conn_1', sql: sneaky }, type: 'simple', measure: { agg: 'count', expr: '*' } });
    expect(compileMetric(sneakySpec, none0, { dialect: 'postgres', base: { kind: 'sql', sql: sneaky } }, null)).toMatchObject({ ok: false });
    const withBackslash = "SELECT * FROM t WHERE x = 'a\\b'";
    const s = spec({ source: { connection: 'conn_1', sql: withBackslash }, type: 'simple', measure: { agg: 'count', expr: '*' } });
    const none = { grain: null, by: [], from: null, to: null, where: {} };
    expect(compileMetric(s, none, { dialect: 'postgres', base: { kind: 'sql', sql: withBackslash } }, null)).toMatchObject({ ok: false, issue: { message: expect.stringMatching(/backslash/) } });
    expect(compileMetric(s, none, { dialect: 'bigquery', base: { kind: 'sql', sql: withBackslash } }, null)).toMatchObject({ ok: true });
  });

  it('only names columns the spec names; a shared-table filter projects what it reads', () => {
    expect(filterColumns("Estado = 'activo' AND \"Tipo de venta\" <> 'x' AND lower(canal) = 'meta' AND 1e5 > 0")).toEqual(['Estado', 'Tipo de venta', 'canal']);
    expect(validateMetricSpec({ kind: 'metric', id: 'm', title: 'M', type: 'simple', source: { connection: 'conn_1', fqn: 't' }, measure: { agg: 'sum', expr: 'revenue - refunds' } })).toMatchObject({ ok: false, issue: { param: 'measure.expr' } });
    expect(validateMetricSpec({ kind: 'metric', id: 'm', title: 'M', type: 'simple', source: { connection: 'conn_1', fqn: 't' }, measure: { agg: 'sum', expr: 'x' }, dimensions: [{ name: 'c', column: 'a; DROP' }] })).toMatchObject({ ok: false, issue: { param: 'dimensions[0].column' } });
  });
});

describe('scope', () => {
  it('applies the scope before aggregation', () => {
    const out = sql(ROAS, MARCH, 'postgres', FQN, SCOPE);
    expect(out.indexOf("so_base.client_id IN ('c1', 'c2')")).toBeLessThan(out.indexOf('GROUP BY'));
  });

  it('denies every row for an empty scope', () => {
    expect(sql(ROAS, MARCH, 'postgres', FQN, { field: 'client_id', values: [] })).toContain('1 = 0');
  });

  it('fails closed for a scoped caller on a metric without scope_field, or scoped by another field', () => {
    const unscoped = spec({ source: { connection: 'conn_7f2', fqn: 'a.b' }, type: 'simple', measure: { agg: 'sum', expr: 'x' } });
    expect(compileMetric(unscoped, { grain: null, by: [], from: null, to: null, where: {} }, { dialect: 'bigquery', base: FQN }, SCOPE)).toMatchObject({ ok: false, issue: { param: 'scope_field' } });
    expect(compileMetric(ROAS, MARCH, { dialect: 'bigquery', base: FQN }, { field: 'region', values: ['north'] })).toMatchObject({ ok: false, issue: { param: 'scope_field' } });
  });
});
