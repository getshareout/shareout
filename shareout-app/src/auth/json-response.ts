import { jsonWithApiErrors } from '../http/api-error';

export function jsonResponse(body: unknown, status: number): Response {
  return jsonWithApiErrors(body, status);
}
