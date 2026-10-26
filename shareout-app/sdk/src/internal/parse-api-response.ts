import { ConsentRequiredError, ShareOutError } from '../shareout-error';
import type { DataResponse } from '../types/common';

type ApiBody = DataResponse<unknown> & {
  error?: string;
  code?: string;
  hint?: string;
  suggestion?: string;
  param?: string;
  docs?: string;
  request_id?: string;
  reason?: string;
  consent_url?: string;
};

function nonJsonError(response: Response): ShareOutError {
  const status = response.status;
  if (status >= 500) {
    return new ShareOutError('Internal server error', 'INTERNAL_ERROR', status);
  }
  if (!status || status === 0) {
    return new ShareOutError('Network request failed', 'NETWORK_ERROR', 0);
  }
  return new ShareOutError(
    `Request failed (${status})`,
    'HTTP_ERROR',
    status,
  );
}

/** Build a ShareOutError from a JSON error envelope (`{ error, code, request_id, … }`). */
export function errorFromEnvelope(body: ApiBody, status: number, fallbackCode?: string): ShareOutError {
  if (body.code === 'CONSENT_REQUIRED' && body.consent_url) {
    return new ConsentRequiredError(body.error || 'Consent required', status, body.consent_url, body.hint, body.request_id);
  }
  return new ShareOutError(
    body.error || 'Unknown error',
    body.code || fallbackCode || (status >= 500 ? 'INTERNAL_ERROR' : 'UNKNOWN'),
    status,
    body.hint,
    body.suggestion,
    body.param,
    body.docs,
    body.request_id,
    body.reason,
  );
}

export interface ParseOptions {
  /**
   * Control-plane routes (`/v1/artifacts/…`, `/v1/workspaces/…`) mostly answer with a
   * bare JSON object instead of the `{ success, data }` envelope. When set, a body
   * without a `data` key is returned as-is instead of `undefined`.
   */
  bareBody?: boolean;
}

/** Parse a ShareOut JSON API envelope; never leak raw SyntaxError to callers. */
export async function parseApiResponse<T>(response: Response, options: ParseOptions = {}): Promise<T> {
  let body: ApiBody;
  try {
    body = await response.json() as ApiBody;
  } catch {
    throw nonJsonError(response);
  }

  if (!response.ok || body?.success === false) {
    throw errorFromEnvelope(body ?? ({} as ApiBody), response.status);
  }

  if (options.bareBody && body && typeof body === 'object' && !('data' in body)) return body as T;
  return body?.data as T;
}

export function wrapNetworkError(err: unknown): ShareOutError {
  if (err instanceof ShareOutError) return err;
  return new ShareOutError('Network request failed', 'NETWORK_ERROR', 0);
}
