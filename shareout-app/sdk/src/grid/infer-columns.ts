import type { GridColumn, GridColumnType, GridRow } from './types';

const HIDDEN_FIELDS = new Set(['id', 'createdAt', 'updatedAt']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|$)/;

function valueType(value: unknown): GridColumnType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string' && ISO_DATE.test(value)) return 'date';
  return 'text';
}

function humanize(field: string): string {
  return field
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Derive grid columns from a sample of rows. Field order follows first
 * appearance across the sample; the column type is taken from the first
 * non-null value seen for that field.
 */
export function inferColumns(rows: GridRow[], editable = true): GridColumn[] {
  const fields: string[] = [];
  const types = new Map<string, GridColumnType>();

  for (const row of rows) {
    for (const field of Object.keys(row)) {
      if (HIDDEN_FIELDS.has(field)) continue;
      if (!types.has(field)) {
        fields.push(field);
        types.set(field, 'text');
      }
      const current = row[field];
      if (current != null && types.get(field) === 'text') {
        types.set(field, valueType(current));
      }
    }
  }

  return fields.map((field) => ({
    field,
    title: humanize(field),
    type: types.get(field) ?? 'text',
    editable,
  }));
}
