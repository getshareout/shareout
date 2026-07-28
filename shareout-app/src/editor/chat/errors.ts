/** JSON error envelope used by all editor chat HTTP handlers. */
export function errorResponse(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({
    success: false,
    error: message,
    code,
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Parse a JSON request body; return a 400 response when the body is missing or malformed. */
export async function parseJsonBody<T>(request: Request): Promise<T | Response> {
  try {
    return await request.json() as T;
  } catch {
    return errorResponse('INVALID_JSON', 'Invalid JSON body', 400);
  }
}
