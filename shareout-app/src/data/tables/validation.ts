import { DATA_ERRORS } from '../../types';
import { errorResponse } from '../middleware';
import { Errors } from '../errors';
import { MAX_FIELD_NAME_LENGTH, TABLE_NAME_PATTERN } from './constants';

/** Returns a human-readable error or null when the name is valid. */
export function validateTableName(name: string): string | null {
  if (!name) return 'Table name is required';
  if (name.length > MAX_FIELD_NAME_LENGTH) {
    return `Table name too long (max ${MAX_FIELD_NAME_LENGTH} chars)`;
  }
  if (!TABLE_NAME_PATTERN.test(name)) {
    return 'Table name must start with a letter and contain only letters, numbers, and underscores';
  }
  return null;
}

/** Parse JSON body or return a 400 error Response. */
export async function parseJsonBody(
  request: Request,
  origin?: string | null,
): Promise<Record<string, unknown> | Response> {
  try {
    return await request.json();
  } catch {
    return errorResponse(DATA_ERRORS.INVALID_JSON, origin);
  }
}

/** Escape a JSON field path for safe use inside json_extract(). */
export function escapeField(field: string): string {
  return field.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

const OPERATORS = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$contains', '$startsWith', '$endsWith'];

/** Reject filters filterToSql would silently drop (unknown operator) or crash on ($in non-array). */
export function validateFilter(filter: unknown): ReturnType<typeof Errors.validation> | null {
  if (filter === undefined || filter === null) return null;
  if (typeof filter !== 'object' || Array.isArray(filter)) {
    return Errors.validation('filter', 'filter must be an object of field → value or operator', { example: '{"status":"open"}' });
  }
  for (const [field, value] of Object.entries(filter)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const [op, opVal] of Object.entries(value)) {
      if (!OPERATORS.includes(op)) {
        return Errors.validation(`filter.${field}.${op}`, `Unknown filter operator "${op}"`, { allowed: OPERATORS.join(', ') });
      }
      if ((op === '$in' || op === '$nin') && !Array.isArray(opVal)) {
        return Errors.validation(`filter.${field}.${op}`, `${op} expects an array`, { example: `{"${field}":{"${op}":["a","b"]}}` });
      }
    }
  }
  return null;
}

/** POST /tables/{name} body: one row object, or {"rows": [objects]} for bulk insert. */
export function validateInsertBody(body: unknown): ReturnType<typeof Errors.validation> | null {
  if (Array.isArray(body)) {
    return Errors.validation('body', 'Send one row object, or {"rows": [...]} for bulk insert — a top-level JSON array is not accepted', {
      example: '{"rows":[{"name":"a"},{"name":"b"}]}',
    });
  }
  if (body === null || typeof body !== 'object') {
    return Errors.validation('body', 'Row must be a JSON object', { example: '{"name":"a"}' });
  }
  const rows = (body as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return null;
  const bad = rows.findIndex((r) => r === null || typeof r !== 'object' || Array.isArray(r));
  return bad === -1 ? null : Errors.validation(`rows[${bad}]`, 'Each row must be a JSON object', { example: '{"name":"a"}' });
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * PATCH /tables/{name}/{rowId}: the body is the fields to change. The bulk route's {"changes": {...}} wrapper is
 * accepted too (agents reuse it) and unwrapped; any other use of a `changes` key is rejected so a literal
 * `changes` field is never stored.
 */
export function normalizeRowPatchBody(
  body: Record<string, unknown>,
): { changes: Record<string, unknown> } | { error: ReturnType<typeof Errors.validation> } {
  if (!('changes' in body)) return { changes: body };
  const keys = Object.keys(body);
  if (keys.length === 1 && isPlainObject(body.changes)) return { changes: body.changes };
  return {
    error: Errors.validation('changes', '"changes" is the bulk wrapper: send {"changes":{...fields}} alone, or the fields directly', {
      example: '{"estado":"pendiente"}',
    }),
  };
}

/** PATCH /tables/{name} (bulk): needs a filter object ({} matches every row) and a changes object. */
export function validateBulkPatchBody(body: Record<string, unknown>): ReturnType<typeof Errors.validation> | null {
  if (!isPlainObject(body.filter)) {
    return Errors.validation('filter', 'Bulk PATCH needs "filter" ({} matches every row). To update one row use PATCH /tables/{name}/{rowId}', {
      example: '{"filter":{"id":"row_..."},"changes":{"estado":"pendiente"}}',
    });
  }
  if (!isPlainObject(body.changes)) {
    return Errors.validation('changes', 'Bulk PATCH needs "changes" as an object of fields to set', {
      example: '{"filter":{"estado":"nuevo"},"changes":{"estado":"pendiente"}}',
    });
  }
  return null;
}
