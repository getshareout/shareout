import { describe, it, expect } from 'vitest';
import {
  getAllBindableKeys,
  validateBindingAgainstManifest,
  type ParsedManifest,
} from '../src/manifest/manifest-parser';

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
  },
  valid: true,
  errors: [],
  jsonKeys: ['title'],
  tableNames: ['orders'],
  blobNames: [],
  realtimeDocs: [],
  computedNames: ['revenue'],
  formatterNames: [],
};

describe('manifest bindable keys (powers the Inspect "Connect to data" picker)', () => {
  it('lists json keys, table aggregates/rows, and computed values', () => {
    const keys = getAllBindableKeys(parsed);
    expect(keys).toContain('json:title');
    expect(keys).toContain('computed:revenue');
    expect(keys).toContain('table:orders:sum:total');
    expect(keys).toContain('table:orders:row:$id:id');
  });

  it('validates a binding against the manifest', () => {
    expect(validateBindingAgainstManifest('json:title', parsed)).toBeNull();
    expect(validateBindingAgainstManifest('table:orders:sum:total', parsed)).toBeNull();
    expect(validateBindingAgainstManifest('computed:revenue', parsed)).toBeNull();
    expect(validateBindingAgainstManifest('json:missing', parsed)).toMatch(/not declared/i);
    expect(validateBindingAgainstManifest('table:ghost', parsed)).toMatch(/not declared/i);
  });
});
