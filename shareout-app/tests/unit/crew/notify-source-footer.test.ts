import { describe, it, expect } from 'vitest';
import { buildSourceFooter } from '../../../src/crew/tools/notify-send';

describe('buildSourceFooter — delivery provenance', () => {
  it('returns empty for missing/empty source', () => {
    expect(buildSourceFooter(undefined)).toBe('');
    expect(buildSourceFooter(null)).toBe('');
    expect(buildSourceFooter({})).toBe('');
    expect(buildSourceFooter('nope')).toBe('');
  });

  it('builds an italic attribution line from connection + asOf', () => {
    expect(buildSourceFooter({ connection: 'acme_snowflake', asOf: '2026-06-22' })).toBe(
      '_Source: acme_snowflake · as of 2026-06-22_'
    );
  });

  it('prefers label over connection', () => {
    expect(buildSourceFooter({ label: 'Warehouse', connection: 'conn_x' })).toBe('_Source: Warehouse_');
  });

  it('appends a single-line, clipped query', () => {
    const out = buildSourceFooter({ connection: 'wh', query: 'SELECT a,\n  b\nFROM t' });
    expect(out).toBe('_Source: wh_\n`SELECT a, b FROM t`');
  });

  it('clips very long queries to 160 chars', () => {
    const long = 'SELECT ' + 'x'.repeat(300);
    const out = buildSourceFooter({ connection: 'wh', query: long });
    const code = out.split('\n')[1];
    expect(code.length).toBeLessThanOrEqual(162); // backticks + 160
    expect(code).toContain('…');
  });

  it('emits query even with no origin/asOf', () => {
    expect(buildSourceFooter({ query: 'SELECT 1' })).toBe('_Source_\n`SELECT 1`');
  });

  it('formats BigQuery warehouse provenance', () => {
    expect(
      buildSourceFooter({
        label: 'bigquery · bi_gold.revenue_actuals_vs_forecast',
        connection: 'bigquery',
        query: 'SELECT rev FROM `analytics-platform.bi_gold.revenue_actuals_vs_forecast` WHERE brand_name="Northwind"',
        asOf: '2026-06-21',
      })
    ).toBe(
      '_Source: bigquery · bi_gold.revenue_actuals_vs_forecast · as of 2026-06-21_\n`SELECT rev FROM `analytics-platform.bi_gold.revenue_actuals_vs_forecast` WHERE brand_name="Northwind"`'
    );
  });

  it('shows tables, columns, and filters when provided', () => {
    const out = buildSourceFooter({
      label: 'bigquery · bi_gold.revenue_actuals_vs_forecast',
      asOf: '2026-06-21',
      tables: ['bi_gold.revenue_actuals_vs_forecast', 'bi_gold.dau_and_session_metrics'],
      columns: ['last_day_revenue', 'rev_7d_avg', 'dau_7d_avg', 'fill_rate', 'cpm'],
      filters: ["brand_name = 'Northwind'", 'date_has_actuals = TRUE'],
    });
    expect(out).toContain('_Source: bigquery · bi_gold.revenue_actuals_vs_forecast · as of 2026-06-21_');
    expect(out).toContain('`bi_gold.revenue_actuals_vs_forecast`');
    expect(out).toContain('_Columns:_ last_day_revenue');
    expect(out).toContain("_Filters:_ brand_name = 'Northwind'");
    expect(out).not.toContain('`SELECT');
  });
});
