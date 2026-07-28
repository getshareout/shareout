import { DATA_ERRORS } from '../../types';
import { errorResponse } from '../middleware';
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
