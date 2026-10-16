import type { Filter, FilterOperator } from './types';
import { escapeField } from './validation';
import { JSON_IN, jsonList } from '../../sql-in';

/**
 * Compile a Mongo-style filter into SQLite json_extract conditions.
 * Used by queries, counts, distinct, bulk updates/deletes, and metric alerts.
 */
// SQLite stores JSON booleans as 1/0, so a bound JS boolean must be compared as such.
const bindValue = (v: unknown): unknown => (typeof v === 'boolean' ? (v ? 1 : 0) : v);

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
            params.push(bindValue(opVal));
            break;
          case '$ne':
            conditions.push(`json_extract(data, '$.${escapedField}') != ?`);
            params.push(bindValue(opVal));
            break;
          case '$gt':
            conditions.push(`json_extract(data, '$.${escapedField}') > ?`);
            params.push(bindValue(opVal));
            break;
          case '$gte':
            conditions.push(`json_extract(data, '$.${escapedField}') >= ?`);
            params.push(bindValue(opVal));
            break;
          case '$lt':
            conditions.push(`json_extract(data, '$.${escapedField}') < ?`);
            params.push(bindValue(opVal));
            break;
          case '$lte':
            conditions.push(`json_extract(data, '$.${escapedField}') <= ?`);
            params.push(bindValue(opVal));
            break;
          case '$in': {
            conditions.push(`json_extract(data, '$.${escapedField}') IN ${JSON_IN}`);
            params.push(jsonList((opVal as unknown[]).map(bindValue)));
            break;
          }
          case '$nin': {
            conditions.push(`json_extract(data, '$.${escapedField}') NOT IN ${JSON_IN}`);
            params.push(jsonList((opVal as unknown[]).map(bindValue)));
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
      params.push(bindValue(value));
    }
  }

  return {
    sql: conditions.length > 0 ? conditions.join(' AND ') : '1=1',
    params,
  };
}
