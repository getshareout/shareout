import { DATA_ERRORS } from '../types';
import { errorResponse, type DataContext } from './middleware';

const DOC_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export async function handleRealtime(
  request: Request,
  ctx: DataContext,
  path: string
): Promise<Response> {
  if (ctx.viewerScope) {
    return errorResponse({
      ...DATA_ERRORS.FORBIDDEN,
      hint: 'This artifact has a row-level access policy; realtime documents are restricted to owners/editors.',
      suggestion: 'Store per-viewer data in sdk.table(), which is filtered by the access policy.',
    }, ctx.origin);
  }

  const docName = path.slice(1);

  if (!docName || !DOC_NAME_PATTERN.test(docName)) {
    return errorResponse({
      ...DATA_ERRORS.INVALID_REQUEST,
      message: 'Invalid document name. Must start with a letter, contain only alphanumeric, underscore, or hyphen, and be 1-64 characters.'
    });
  }

  const id = ctx.env.REALTIME.idFromName(`${ctx.artifactId}:${docName}`);
  const stub = ctx.env.REALTIME.get(id);

  const doUrl = new URL(request.url);
  doUrl.pathname = `/${ctx.artifactId}/${docName}`;

  const doRequest = new Request(doUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  return stub.fetch(doRequest);
}
