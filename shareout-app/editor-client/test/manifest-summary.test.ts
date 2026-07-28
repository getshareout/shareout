import { describe, it, expect } from 'vitest';
import { buildManifestSummary } from '../src/manifest/manifest-parser';
import type { ParsedManifest } from '../src/manifest/manifest-parser';

const parsed: ParsedManifest = {
  manifest: {
    version: '2.0',
    sources: {
      json: { title: {} },
      tables: {
        orders: {
          schema: [
            { name: 'total', type: 'number' },
            { name: 'id', type: 'string', primary: true },
          ],
        },
      },
    },
    computed: { revenue: { formula: 'sum(orders.total)' } },
    formatters: { usd: { currency: 'USD' } },
  },
  valid: true,
  errors: [],
  jsonKeys: ['title'],
  tableNames: ['orders'],
  blobNames: [],
  realtimeDocs: [],
  computedNames: ['revenue'],
  formatterNames: ['usd'],
};

describe('buildManifestSummary', () => {
  it('summarizes json keys, table schema, computed, and formatters', () => {
    const s = buildManifestSummary(parsed)!;
    expect(s.json).toEqual([{ key: 'title', type: 'value' }]);
    expect(s.tables?.[0].name).toBe('orders');
    expect(s.tables?.[0].fields).toContainEqual({ name: 'id', type: 'string', primary: true });
    expect(s.computed).toEqual([{ name: 'revenue', formula: 'sum(orders.total)' }]);
    expect(s.formatters).toEqual(['usd']);
  });

  it('returns null for a null or empty manifest', () => {
    expect(buildManifestSummary(null)).toBeNull();
    expect(
      buildManifestSummary({
        manifest: { version: '2.0' },
        valid: true,
        errors: [],
        jsonKeys: [],
        tableNames: [],
        blobNames: [],
        realtimeDocs: [],
        computedNames: [],
        formatterNames: [],
      }),
    ).toBeNull();
  });
});
