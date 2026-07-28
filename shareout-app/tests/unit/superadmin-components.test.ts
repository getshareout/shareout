import { describe, expect, it } from 'vitest';
import { barChart, bytes, deltaText, fmt, money } from '../../src/superadmin/views/components';

describe('superadmin view components', () => {
  it('fmt formats integers with grouping', () => {
    expect(fmt(1234)).toBe('1,234');
    expect(fmt(0)).toBe('0');
  });

  it('bytes picks human-readable units', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(1024)).toBe('1.0 KB');
    expect(bytes(1_500_000)).toBe('1.4 MB');
  });

  it('money renders signed USD correctly', () => {
    expect(money(12.5)).toBe('$12.50');
    expect(money(-3.1)).toBe('-$3.10');
  });

  it('deltaText shows new when pct is null', () => {
    expect(deltaText({ value: 5, pct: null }, 'new')).toContain('5 new');
    expect(deltaText({ value: 5, pct: null }, 'new')).toContain('new');
  });

  it('deltaText shows directional change when pct is set', () => {
    const up = deltaText({ value: 10, pct: 25 });
    expect(up).toContain('▲');
    expect(up).toContain('25%');
    const down = deltaText({ value: 10, pct: -10 });
    expect(down).toContain('▼');
  });

  it('barChart returns empty state for no points', () => {
    expect(barChart([])).toContain('No data yet');
  });

  it('barChart renders bars for data points', () => {
    const html = barChart([
      { date: '2026-01-01', value: 10 },
      { date: '2026-01-02', value: 20 },
    ]);
    expect(html).toContain('sa-chart-bar');
    expect(html).toContain('title="2026-01-02: 20"');
  });
});
