import { jsonWithApiErrors, simpleApiError } from '../../http/api-error';

export function jsonResponse(data: unknown): Response {
  return jsonWithApiErrors(data, 200);
}

export function errorResponse(code: string, message: string, status: number): Response {
  return simpleApiError(message, code, status);
}
