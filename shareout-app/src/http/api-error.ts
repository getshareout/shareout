/**
 * Canonical public API error envelope for ShareOut.
 *
 * Shape (JSON):
 *   {
 *     "success": false,
 *     "error":   "<human message>",
 *     "code":    "<STABLE_MACHINE_CODE>",
 *     "request_id"?: string,
 *     "hint"?: string,
 *     "suggestion"?: string,
 *     "param"?: string,
 *     "docs"?: string
 *   }
 *
 * - `code` is stable for clients; do not overload it with free-form text.
 * - Never put stack traces or secret values in `error` / `hint`.
 * - Prefer this helper over ad-hoc `Response.json({ error: ... })`.
 */

export interface ApiErrorFields {
  code: string;
  message: string;
  status: number;
  hint?: string;
  suggestion?: string;
  param?: string;
  docs?: string;
}

export interface ApiErrorBody {
  success: false;
  error: string;
  code: string;
  request_id?: string;
  hint?: string;
  suggestion?: string;
  param?: string;
  docs?: string;
}

export interface ApiErrorResponseOptions {
  /** Optional CORS / extra headers merged into the response. */
  headers?: HeadersInit;
  /** Correlation id (also set as X-Request-Id when provided). */
  requestId?: string;
}

/** Pure body builder — easy to unit-test without Response. */
export function buildApiErrorBody(
  fields: Pick<ApiErrorFields, 'code' | 'message'> &
    Partial<Omit<ApiErrorFields, 'code' | 'message' | 'status'>>,
  requestId?: string
): ApiErrorBody {
  const body: ApiErrorBody = {
    success: false,
    error: fields.message,
    code: fields.code,
  };
  if (requestId) body.request_id = requestId;
  if (fields.hint) body.hint = fields.hint;
  if (fields.suggestion) body.suggestion = fields.suggestion;
  if (fields.param) body.param = fields.param;
  if (fields.docs) body.docs = fields.docs;
  return body;
}

/**
 * Build a JSON error Response using the canonical envelope.
 * Always sets Content-Type application/json.
 */
export function apiErrorResponse(
  fields: ApiErrorFields,
  options: ApiErrorResponseOptions = {}
): Response {
  const body = buildApiErrorBody(fields, options.requestId);
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.requestId) {
    headers.set('X-Request-Id', options.requestId);
  }
  return new Response(JSON.stringify(body), {
    status: fields.status,
    headers,
  });
}

/** Convenience for simple handlers that only have message + code + status. */
export function simpleApiError(
  message: string,
  code: string,
  status: number,
  options: ApiErrorResponseOptions = {}
): Response {
  return apiErrorResponse({ message, code, status }, options);
}

/**
 * Drop-in replacement for local `json(data, status)` helpers.
 * Error-shaped payloads (`{ error, code }` without `success`) on status ≥ 400
 * are rewritten to the canonical envelope so call sites stay one-liners.
 * Success and non-envelope bodies pass through unchanged.
 *
 * @param extraHeaders Optional headers (Set-Cookie, CORS, …) merged into the response.
 */
export function jsonWithApiErrors(
  data: unknown,
  status = 200,
  extraHeaders?: HeadersInit
): Response {
  let response: Response;
  if (
    status >= 400 &&
    data !== null &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    'error' in data &&
    'code' in data &&
    typeof (data as { error: unknown }).error === 'string' &&
    typeof (data as { code: unknown }).code === 'string' &&
    !('success' in data)
  ) {
    const d = data as {
      error: string;
      code: string;
      hint?: string;
      suggestion?: string;
      param?: string;
      docs?: string;
    };
    response = apiErrorResponse(
      {
        message: d.error,
        code: d.code,
        status,
        hint: d.hint,
        suggestion: d.suggestion,
        param: d.param,
        docs: d.docs,
      },
      { headers: extraHeaders }
    );
  } else {
    const headers = new Headers(extraHeaders);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    response = new Response(JSON.stringify(data), { status, headers });
  }
  return response;
}
