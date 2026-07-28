import { describe, it, expect } from 'vitest';
import { pctChange, exceedsThreshold, validateSpec, buildWatchMessage } from '../../../src/metric-watch/watches';

describe('pctChange', () => {
  it('computes signed percent change', () => {
    expect(pctChange(100, 120)).toBe(20);
    expect(pctChange(100, 80)).toBe(-20);
    expect(pctChange(50, 0)).toBe(-100);
  });

  it('handles a zero previous value (leaving zero is an infinite move)', () => {
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(0, 5)).toBe(Infinity);
  });
});

describe('exceedsThreshold', () => {
  it('never alerts without a baseline', () => {
    expect(exceedsThreshold(null, 999, 20)).toBe(false);
  });

  it('alerts on a move at or above the threshold, either direction', () => {
    expect(exceedsThreshold(100, 120, 20)).toBe(true);   // +20% == threshold
    expect(exceedsThreshold(100, 80, 20)).toBe(true);    // -20%
    expect(exceedsThreshold(100, 119, 20)).toBe(false);  // +19% < threshold
  });

  it('alerts when a metric leaves a zero baseline but not when it stays at zero', () => {
    expect(exceedsThreshold(0, 5, 20)).toBe(true);
    expect(exceedsThreshold(0, 0, 20)).toBe(false);
  });
});

describe('validateSpec', () => {
  it('accepts a count with the default threshold', () => {
    const r = validateSpec({ table: 'orders', kind: 'count' });
    expect(r).toEqual({ ok: true, spec: { table: 'orders', kind: 'count', column: undefined }, thresholdPct: 20 });
  });

  it('requires a column for sum and last', () => {
    expect(validateSpec({ table: 'orders', kind: 'sum' })).toMatchObject({ ok: false });
    expect(validateSpec({ table: 'orders', kind: 'last' })).toMatchObject({ ok: false });
    expect(validateSpec({ table: 'orders', kind: 'sum', column: 'total' })).toMatchObject({ ok: true });
  });

  it('rejects a missing table, a bad kind, and a non-positive threshold', () => {
    expect(validateSpec({ kind: 'count' })).toMatchObject({ ok: false });
    expect(validateSpec({ table: 't', kind: 'median' })).toMatchObject({ ok: false });
    expect(validateSpec({ table: 't', kind: 'count', threshold_pct: -5 })).toMatchObject({ ok: false });
    expect(validateSpec({ table: 't', kind: 'count', threshold_pct: 0 })).toMatchObject({ ok: false });
  });

  it('honors a positive threshold override', () => {
    const r = validateSpec({ table: 't', kind: 'count', threshold_pct: 50 });
    expect(r).toMatchObject({ ok: true, thresholdPct: 50 });
  });
});

describe('buildWatchMessage', () => {
  it('names the metric, direction, and values', () => {
    expect(buildWatchMessage({ metric_kind: 'count', column_name: '' }, 'Dash', 100, 134))
      .toBe('Row count jumped 34% (100 → 134) on "Dash".');
    expect(buildWatchMessage({ metric_kind: 'sum', column_name: 'revenue' }, 'Dash', 200, 150))
      .toBe('sum(revenue) dropped 25% (200 → 150) on "Dash".');
  });

  it('reads naturally when the baseline was zero', () => {
    expect(buildWatchMessage({ metric_kind: 'count', column_name: '' }, 'Dash', 0, 5))
      .toBe('Row count went from 0 to 5 on "Dash".');
  });
});
