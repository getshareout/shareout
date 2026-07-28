// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderDataModelMarkup } from '../src/rail/data-browser';
import type { ManifestSummary } from '../src/manifest/manifest-parser';

describe('renderDataModelMarkup', () => {
  it('renders table schemas, computed formulas, formatters and realtime docs', () => {
    const summary: ManifestSummary = {
      tables: [{
        name: 'orders',
        fields: [
          { name: 'id', type: 'string', primary: true },
          { name: 'total', type: 'number' },
        ],
      }],
      computed: [{ name: 'revenue', formula: 'sum(orders.total)' }],
      formatters: ['usd'],
      realtime: ['live'],
    };

    const html = renderDataModelMarkup(summary);
    expect(html).toContain('orders');
    expect(html).toContain('id (id)'); // primary key marked
    expect(html).toContain('total');
    expect(html).toContain('Computed');
    expect(html).toContain('revenue');
    expect(html).toContain('sum(orders.total)');
    expect(html).toContain('Formatters');
    expect(html).toContain('usd');
    expect(html).toContain('Realtime');
    expect(html).toContain('live');
  });

  it('shows the empty-tables hint and no extra sections when there is no data model', () => {
    const html = renderDataModelMarkup(null);
    expect(html).toContain('Tables');
    expect(html).toContain('Declare tables in your manifest');
    expect(html).not.toContain('Computed');
    expect(html).not.toContain('Formatters');
  });

  it('renders live row counts when provided (pluralized), omits when absent', () => {
    const summary: ManifestSummary = { tables: [{ name: 'orders', fields: [] }] };
    expect(renderDataModelMarkup(summary, { orders: 42 })).toContain('42 rows');
    expect(renderDataModelMarkup(summary, { orders: 1 })).toContain('1 row');
    expect(renderDataModelMarkup(summary, {})).not.toContain('rows');
  });
});
