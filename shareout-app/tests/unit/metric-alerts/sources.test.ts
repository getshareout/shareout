import { describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import { miniDbBinding } from '../helpers/minidb-mock';
import { evaluateMetric, evaluateCondition } from '../../../src/metric-alerts/sources';

// A tiny D1-ish double routed by SQL substring, fed through the MINIDB DO mock.
function miniEnv(rows: Record<string, unknown>): Env {
  const d1ish = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              for (const [needle, value] of Object.entries(rows)) {
                if (sql.includes(needle)) return value;
              }
              return null;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
  return { MINIDB: miniDbBinding(d1ish) } as unknown as Env;
}

describe('evaluateCondition', () => {
  it('matches absolute operators', () => {
    expect(evaluateCondition('gt', 100, 150, null)).toBe(true);
    expect(evaluateCondition('gt', 100, 50, null)).toBe(false);
    expect(evaluateCondition('lt', 100, 50, null)).toBe(true);
    expect(evaluateCondition('lte', 100, 100, null)).toBe(true);
    expect(evaluateCondition('eq', 42, 42, null)).toBe(true);
  });

  it('computes percent change against the last value', () => {
    // 120 vs prior 100 = +20%
    expect(evaluateCondition('change_pct_gt', 10, 120, 100)).toBe(true);
    expect(evaluateCondition('change_pct_gt', 30, 120, 100)).toBe(false);
    // 80 vs prior 100 = -20%
    expect(evaluateCondition('change_pct_lt', -10, 80, 100)).toBe(true);
  });

  it('never matches percent change without a baseline', () => {
    expect(evaluateCondition('change_pct_gt', 10, 120, null)).toBe(false);
    expect(evaluateCondition('change_pct_gt', 10, 120, 0)).toBe(false);
  });
});

describe('evaluateMetric', () => {
  it('reads a numeric value from a json_path source', async () => {
    const env = miniEnv({ artifact_json: { value: JSON.stringify({ revenue: 92420, nested: { kpi: 7 } }) } });
    expect(await evaluateMetric(env, 'art_1', 'ws_1', { type: 'json_path', key: 'metrics', path: '$.revenue' }))
      .toEqual({ value: 92420 });
    expect(await evaluateMetric(env, 'art_1', 'ws_1', { type: 'json_path', key: 'metrics', path: '$.nested.kpi' }))
      .toEqual({ value: 7 });
  });

  it('errors when the json key is missing', async () => {
    const env = miniEnv({});
    const result = await evaluateMetric(env, 'art_1', 'ws_1', { type: 'json_path', key: 'metrics', path: '$.revenue' });
    expect('error' in result).toBe(true);
  });

  it('errors when the path does not resolve to a number', async () => {
    const env = miniEnv({ artifact_json: { value: JSON.stringify({ revenue: 'not-a-number' }) } });
    const result = await evaluateMetric(env, 'art_1', 'ws_1', { type: 'json_path', key: 'metrics', path: '$.revenue' });
    expect('error' in result).toBe(true);
  });

  it('counts rows for a table_count source', async () => {
    const env = miniEnv({ artifact_tables: { id: 'tbl_1' }, 'COUNT(*)': { n: 5 } });
    expect(await evaluateMetric(env, 'art_1', 'ws_1', { type: 'table_count', table: 'orders' }))
      .toEqual({ value: 5 });
  });

  it('aggregates a numeric field for a table_aggregate source', async () => {
    const env = miniEnv({ artifact_tables: { id: 'tbl_1' }, 'SUM(': { agg: 250.5 } });
    expect(await evaluateMetric(env, 'art_1', 'ws_1', { type: 'table_aggregate', table: 'orders', field: 'total', fn: 'sum' }))
      .toEqual({ value: 250.5 });
  });

  it('errors when the table is not found', async () => {
    const env = miniEnv({});
    const result = await evaluateMetric(env, 'art_1', 'ws_1', { type: 'table_count', table: 'orders' });
    expect('error' in result).toBe(true);
  });
});
