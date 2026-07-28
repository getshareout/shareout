import { jsonWithApiErrors } from '../http/api-error';

/** JSON helper shared by artifact REST handlers. Errors use the canonical envelope. */
export function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}
