import { describe, expect, it } from 'vitest';
import { DashboardHelpers } from '../src/stores/dashboards/helpers';

describe('DashboardHelpers', () => {
  const helpers = new DashboardHelpers();

  it('formats numbers, currency, and percent', () => {
    expect(helpers.formatNumber(1234.5)).toBe('1,234.5');
    expect(helpers.formatCurrency(99)).toMatch(/\$99\.00/);
    expect(helpers.formatPercent(0.125)).toBe('12.5%');
  });

  it('formats dates from strings and Date objects', () => {
    const formatted = helpers.formatDate('2024-06-15');
    expect(formatted).toMatch(/Jun/);
    expect(formatted).toMatch(/2024/);
  });

  it('returns color scales and semantic colors', () => {
    const sequential = helpers.getColorScale('sequential', 'blue');
    expect(sequential).toHaveLength(5);
    expect(helpers.getSemanticColor('positive')).toBe('#10b981');
    expect(helpers.getSemanticColor('negative')).toBe('#ef4444');
  });

  it('aggregates rows by group with sum and count', () => {
    const data = [
      { region: 'East', revenue: 100 },
      { region: 'East', revenue: 200 },
      { region: 'West', revenue: 50 },
    ];
    const result = helpers.aggregate(data, 'region', [
      { field: 'revenue', fn: 'sum' },
      { field: 'revenue', fn: 'count' },
    ]);

    expect(result).toHaveLength(2);
    const east = result.find(r => (r as Record<string, unknown>).region === 'East');
    expect(east).toMatchObject({ revenue_sum: 300, revenue_count: 2 });
  });
});
