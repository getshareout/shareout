/**
 * Artifact connection HTTP router — thin dispatcher over focused modules.
 *
 * Module layout (`src/data/connections/`):
 * - `types.ts` — shared types and constants
 * - `errors.ts` — upstream error mapping
 * - `resolve.ts` — connection lookup, credentials, authorization
 * - `crud.ts` — list/get/create/update/delete
 * - `rest-query.ts` — REST API query executor
 * - `test-connection.ts` — health-check endpoint
 * - `query.ts` — query handler + programmatic `queryConnectionData`
 * - `materialize.ts` — materialize endpoint
 */
import { DATA_ERRORS } from '../../types';
import {
  errorResponse,
  verifyOwner,
  type DataContext,
} from '../middleware';
import {
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  deleteConnection,
} from './crud';
import { authorizeConnectionAction } from './resolve';
import { executeQuery, queryConnectionData } from './query';
import { materializeConnection } from './materialize';
import { testConnection } from './test-connection';

export { queryConnectionData } from './query';

export async function handleConnections(
  request: Request,
  ctx: DataContext,
  path: string,
): Promise<Response> {
  const parts = path.split('/').filter(Boolean);
  const [name, action] = parts;
  const method = request.method;

  if (!name && method === 'GET') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) return errorResponse(DATA_ERRORS.FORBIDDEN);
    return listConnections(ctx);
  }

  if (!name && method === 'POST') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) return errorResponse(DATA_ERRORS.FORBIDDEN);
    return createConnection(request, ctx);
  }

  if (name && action === 'query' && method === 'POST') {
    const denied = await authorizeConnectionAction(request, ctx, name);
    if (denied) return denied;
    return executeQuery(request, ctx, name);
  }

  if (name && action === 'materialize' && method === 'POST') {
    const denied = await authorizeConnectionAction(request, ctx, name);
    if (denied) return denied;
    return materializeConnection(request, ctx, name);
  }

  if (name && action === 'test' && method === 'POST') {
    const denied = await authorizeConnectionAction(request, ctx, name);
    if (denied) return denied;
    return testConnection(request, ctx, name);
  }

  if (name && !action && method === 'GET') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) return errorResponse(DATA_ERRORS.FORBIDDEN);
    return getConnection(ctx, name);
  }

  if (name && !action && method === 'PUT') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) return errorResponse(DATA_ERRORS.FORBIDDEN);
    return updateConnection(request, ctx, name);
  }

  if (name && !action && method === 'DELETE') {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) return errorResponse(DATA_ERRORS.FORBIDDEN);
    return deleteConnection(ctx, name);
  }

  return errorResponse(DATA_ERRORS.NOT_FOUND);
}
