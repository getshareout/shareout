/**
 * Client-side formatting and aggregation utilities for dashboard widgets.
 * Exposed via `sdk.dashboards.helpers` — pure functions with no network or doc state.
 */
export class DashboardHelpers {
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat('en-US', options).format(value);
  }

  formatCurrency(value: number, currency = 'USD'): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  }

  formatPercent(value: number, decimals = 1): string {
    return new Intl.NumberFormat('en-US', {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }

  formatDate(date: Date | string, _format?: string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  getColorScale(type: 'sequential' | 'diverging' | 'categorical', name?: string): string[] {
    const scales: Record<string, Record<string, string[]>> = {
      sequential: {
        blue: ['#e0f2fe', '#7dd3fc', '#0ea5e9', '#0369a1', '#0c4a6e'],
        green: ['#dcfce7', '#86efac', '#22c55e', '#15803d', '#14532d'],
      },
      diverging: {
        redGreen: ['#dc2626', '#f87171', '#e5e7eb', '#4ade80', '#16a34a'],
        blueOrange: ['#1d4ed8', '#60a5fa', '#e5e7eb', '#fb923c', '#ea580c'],
      },
      categorical: {
        default: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'],
        pastel: ['#93c5fd', '#6ee7b7', '#fcd34d', '#fca5a5', '#c4b5fd', '#f9a8d4'],
      },
    };
    return scales[type]?.[name || 'default'] || scales.categorical.default;
  }

  getSemanticColor(type: 'positive' | 'negative' | 'neutral' | 'warning'): string {
    const colors = {
      positive: '#10b981',
      negative: '#ef4444',
      neutral: '#6b7280',
      warning: '#f59e0b',
    };
    return colors[type];
  }

  aggregate(
    data: unknown[],
    groupBy: string,
    aggs: { field: string; fn: 'sum' | 'avg' | 'count' | 'min' | 'max' }[],
  ): unknown[] {
    const groups = new Map<string, unknown[]>();
    for (const row of data) {
      const key = String((row as Record<string, unknown>)[groupBy]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const result: unknown[] = [];
    for (const [key, rows] of groups) {
      const aggResult: Record<string, unknown> = { [groupBy]: key };
      for (const agg of aggs) {
        const values = rows.map(r => Number((r as Record<string, unknown>)[agg.field]) || 0);
        switch (agg.fn) {
          case 'sum': aggResult[`${agg.field}_sum`] = values.reduce((a, b) => a + b, 0); break;
          case 'avg': aggResult[`${agg.field}_avg`] = values.reduce((a, b) => a + b, 0) / values.length; break;
          case 'count': aggResult[`${agg.field}_count`] = values.length; break;
          case 'min': aggResult[`${agg.field}_min`] = Math.min(...values); break;
          case 'max': aggResult[`${agg.field}_max`] = Math.max(...values); break;
        }
      }
      result.push(aggResult);
    }
    return result;
  }
}
