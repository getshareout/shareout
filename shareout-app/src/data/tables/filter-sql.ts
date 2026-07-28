import type { Filter, FilterOperator } from './types';
import { escapeField } from './validation';

/**
 * Compile a Mongo-style filter into SQLite json_extract conditions.
 * Used by queries, counts, distinct, bulk updates/deletes, and metric alerts.
 */
export function filterToSql(filter: Filter): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  for (const [field, value] of Object.entries(filter)) {
    const escapedField = escapeField(field);

    if (value === null) {
      conditions.push(`json_extract(data, '$.${escapedField}') IS NULL`);
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      const opValue = value as FilterOperator;
      for (const [op, opVal] of Object.entries(opValue)) {
        switch (op) {
          case '$eq':
            conditions.push(`json_extract(data, '$.${escapedField}') = ?`);
            params.push(opVal);
            break;
          case '$ne':
            conditions.push(`json_extract(data, '$.${escapedField}') != ?`);
            params.push(opVal);
            break;
          case '$gt':
            conditions.push(`json_extract(data, '$.${escapedField}') > ?`);
            params.push(opVal);
            break;
          case '$gte':
            conditions.push(`json_extract(data, '$.${escapedField}') >= ?`);
            params.push(opVal);
            break;
          case '$lt':
            conditions.push(`json_extract(data, '$.${escapedField}') < ?`);
            params.push(opVal);
            break;
          case '$lte':
            conditions.push(`json_extract(data, '$.${escapedField}') <= ?`);
            params.push(opVal);
            break;
          case '$in': {
            const arr = opVal as unknown[];
            const placeholders = arr.map(() => '?').join(', ');
            conditions.push(`json_extract(data, '$.${escapedField}') IN (${placeholders})`);
            params.push(...arr);
            break;
          }
          case '$nin': {
            const arr = opVal as unknown[];
            const placeholders = arr.map(() => '?').join(', ');
            conditions.push(`json_extract(data, '$.${escapedField}') NOT IN (${placeholders})`);
            params.push(...arr);
            break;
          }
          case '$contains':
            conditions.push(`json_extract(data, '$.${escapedField}') LIKE ?`);
            params.push(`%${opVal}%`);
            break;
          case '$startsWith':
            conditions.push(`json_extract(data, '$.${escapedField}') LIKE ?`);
            params.push(`${opVal}%`);
            break;
          case '$endsWith':
            conditions.push(`json_extract(data, '$.${escapedField}') LIKE ?`);
            params.push(`%${opVal}`);
            break;
        }
      }
    } else {
      conditions.push(`json_extract(data, '$.${escapedField}') = ?`);
      params.push(value);
    }
  }

  return {
    sql: conditions.length > 0 ? conditions.join(' AND ') : '1=1',
    params,
  };
}
