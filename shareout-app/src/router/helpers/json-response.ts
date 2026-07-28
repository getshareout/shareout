import { jsonWithApiErrors, simpleApiError } from '../../http/api-error';

export function jsonResponse(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

export function jsonError(error: string, code: string, status: number): Response {
  return simpleApiError(error, code, status);
}
