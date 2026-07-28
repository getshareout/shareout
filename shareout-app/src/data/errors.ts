import type { DataError } from '../types';
import { DATA_ERRORS } from '../types';
import { apiErrorResponse } from '../http/api-error';
import { corsHeaders } from './middleware';

export interface ErrorOptions {
  message?: string;
  hint?: string;
  suggestion?: string;
  param?: string;
  docs?: string;
}

export function createError(
  base: DataError,
  overrides?: ErrorOptions
): DataError {
  return {
    ...base,
    message: overrides?.message ?? base.message,
    hint: overrides?.hint ?? base.hint,
    suggestion: overrides?.suggestion ?? base.suggestion,
    param: overrides?.param ?? base.param,
    docs: overrides?.docs ?? base.docs,
  };
}

/** Data-plane error response — canonical envelope via `http/api-error`. */
export function errorJson(
  error: DataError,
  origin?: string | null
): Response {
  return apiErrorResponse(error, { headers: corsHeaders(origin) });
}

export function invalidParam(
  param: string,
  message: string,
  options?: { hint?: string; suggestion?: string }
): DataError {
  return {
    code: 'INVALID_PARAM',
    message,
    status: 400,
    param,
    hint: options?.hint ?? `The "${param}" parameter is invalid.`,
    suggestion: options?.suggestion,
  };
}

export function missingParam(param: string, expected?: string): DataError {
  return {
    code: 'MISSING_PARAM',
    message: `${param} is required`,
    status: 400,
    param,
    hint: `The "${param}" parameter must be provided.`,
    suggestion: expected ? `Expected format: ${expected}` : undefined,
  };
}

export function formatSizeError(
  code: string,
  message: string,
  maxSize: number,
  currentSize?: number
): DataError {
  const maxMB = (maxSize / 1_000_000).toFixed(1);
  const currentMB = currentSize ? (currentSize / 1_000_000).toFixed(2) : null;

  return {
    code,
    message,
    status: 413,
    hint: currentMB
      ? `Size: ${currentMB}MB exceeds limit of ${maxMB}MB.`
      : `Maximum allowed size is ${maxMB}MB.`,
    suggestion: 'Reduce the size or split into multiple smaller items.',
  };
}

export function formatLimitError(
  code: string,
  resourceType: string,
  limit: number,
  current?: number
): DataError {
  return {
    code,
    message: `Maximum ${resourceType} limit reached (${limit})`,
    status: 400,
    hint: current !== undefined
      ? `Current count: ${current}/${limit}`
      : `Limit: ${limit}`,
    suggestion: `Delete unused ${resourceType} to free up space.`,
  };
}

export function notFound(
  resourceType: string,
  identifier?: string
): DataError {
  const base = DATA_ERRORS.NOT_FOUND;
  return {
    ...base,
    message: `${resourceType} not found`,
    hint: identifier
      ? `No ${resourceType.toLowerCase()} exists with identifier "${identifier}".`
      : `The requested ${resourceType.toLowerCase()} does not exist.`,
    suggestion: `Verify the ${resourceType.toLowerCase()} ID/name is correct, or list available ${resourceType.toLowerCase()}s.`,
  };
}

export function conflict(resourceType: string, name: string): DataError {
  return {
    ...DATA_ERRORS.CONFLICT,
    message: `${resourceType} already exists`,
    hint: `A ${resourceType.toLowerCase()} named "${name}" already exists.`,
    suggestion: `Use a different name, or update the existing ${resourceType.toLowerCase()}.`,
  };
}

export function methodNotAllowed(method: string, allowed: string[]): DataError {
  return {
    code: 'METHOD_NOT_ALLOWED',
    message: `Method ${method} not allowed`,
    status: 405,
    hint: `The ${method} method is not supported for this endpoint.`,
    suggestion: `Allowed methods: ${allowed.join(', ')}`,
  };
}

export function validationError(
  field: string,
  issue: string,
  options?: { allowed?: string; example?: string; maxLength?: number }
): DataError {
  let suggestion = '';
  if (options?.allowed) suggestion += `Allowed: ${options.allowed}. `;
  if (options?.example) suggestion += `Example: "${options.example}". `;
  if (options?.maxLength) suggestion += `Max length: ${options.maxLength} chars.`;

  return {
    code: 'VALIDATION_ERROR',
    message: issue,
    status: 400,
    param: field,
    hint: `Invalid value for "${field}".`,
    suggestion: suggestion.trim() || undefined,
  };
}

export function rateLimitError(
  limit: number,
  windowMs?: number,
  retryAfter?: number
): DataError {
  const window = windowMs ? `${windowMs / 1000}s` : 'minute';
  return {
    code: 'RATE_LIMITED',
    message: `Rate limit exceeded (${limit} requests per ${window})`,
    status: 429,
    hint: retryAfter
      ? `Try again in ${retryAfter} seconds.`
      : 'Too many requests in a short period.',
    suggestion: 'Implement exponential backoff in your client code.',
  };
}

export function configError(missing: string): DataError {
  return {
    code: 'CONFIG_ERROR',
    message: 'Server configuration error',
    status: 500,
    hint: `Required configuration "${missing}" is not set.`,
    suggestion: 'Contact the artifact owner or ShareOut support.',
  };
}

export function proxyError(
  targetHost: string,
  statusCode?: number,
): DataError {
  let hint = `Request to ${targetHost} failed.`;
  if (statusCode) hint += ` Status: ${statusCode}.`;

  return {
    code: 'PROXY_ERROR',
    message: 'Proxy request failed',
    status: 502,
    hint,
    suggestion: 'Verify the target API is available and credentials are valid.',
  };
}

export function uploadError(
  stage: 'token' | 'upload' | 'confirm',
  issue: string
): DataError {
  const hints: Record<string, string> = {
    token: 'Failed to generate upload URL.',
    upload: 'Failed to upload file content.',
    confirm: 'Failed to confirm upload completion.',
  };

  return {
    code: 'UPLOAD_ERROR',
    message: issue,
    status: 400,
    hint: hints[stage],
    suggestion: 'Retry the upload process from the beginning.',
  };
}

export function forbiddenAction(
  action: string,
  reason?: string
): DataError {
  return {
    ...DATA_ERRORS.FORBIDDEN,
    message: `Cannot ${action}`,
    hint: reason ?? 'You do not have permission for this action.',
    suggestion: 'Request owner access or use appropriate credentials.',
  };
}

export const Errors = {
  json: DATA_ERRORS,
  create: createError,
  respond: errorJson,
  invalidParam,
  missingParam,
  formatSize: formatSizeError,
  formatLimit: formatLimitError,
  notFound,
  conflict,
  methodNotAllowed,
  validation: validationError,
  rateLimit: rateLimitError,
  config: configError,
  proxy: proxyError,
  upload: uploadError,
  forbidden: forbiddenAction,
};

export default Errors;
