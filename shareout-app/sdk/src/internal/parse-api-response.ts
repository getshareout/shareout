import { ShareOutError } from '../shareout-error';
import type { DataResponse } from '../types/common';

type ApiBody = DataResponse<unknown> & {
  error?: string;
  code?: string;
  hint?: string;
  suggestion?: string;
  param?: string;
  docs?: string;
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

function apiError(response: Response, body: ApiBody): ShareOutError {
  return new ShareOutError(
    body.error || 'Unknown error',
    body.code || (response.status >= 500 ? 'INTERNAL_ERROR' : 'UNKNOWN'),
    response.status,
    body.hint,
    body.suggestion,
    body.param,
    body.docs,
  );
}

/** Parse a ShareOut JSON API envelope; never leak raw SyntaxError to callers. */
export async function parseApiResponse<T>(response: Response): Promise<T> {
  let body: ApiBody;
  try {
    body = await response.json() as ApiBody;
  } catch {
    throw nonJsonError(response);
  }

  if (!response.ok || body.success === false) {
    throw apiError(response, body);
  }

  return body.data as T;
}

export function wrapNetworkError(err: unknown): ShareOutError {
  if (err instanceof ShareOutError) return err;
  return new ShareOutError('Network request failed', 'NETWORK_ERROR', 0);
}
