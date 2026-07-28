import { DATA_ERRORS } from '../../types';
import { errorResponse, verifyOwner, type DataContext } from '../middleware';
import {
  createSheetConnection,
  deleteSheetConnection,
  getSheetConnection,
  listSheetConnections,
} from './connections';
import {
  getAuthUrl,
  handleAuthCallback,
  handleSheetsOAuthCallback,
  getTokenStatus,
} from './artifact-auth';
import { clearCache, getCacheStatus } from './cache';
import { fetchSheetData } from './fetch-data';
import { importFromSheet, exportToSheet } from './import-export';
import {
  initiateGoogleConnect,
  handleGoogleCallback,
  getConnectionStatus,
  disconnectGoogle,
} from './legacy-oauth';
import { updateSheetData, appendSheetData } from './write-data';

export { handleSheetsOAuthCallback } from './artifact-auth';

async function requireOwner(
  request: Request,
  ctx: DataContext,
  handler: () => Promise<Response>
): Promise<Response> {
  const isOwner = await verifyOwner(request, ctx);
  if (!isOwner) return errorResponse(DATA_ERRORS.FORBIDDEN);
  return handler();
}

export async function handleSheets(
  request: Request,
  ctx: DataContext,
  path: string
): Promise<Response> {
  const parts = path.split('/').filter(Boolean);
  const [action, name] = parts;
  const method = request.method;

  if (action === 'auth-url' && method === 'GET') {
    return getAuthUrl(request, ctx);
  }

  if (action === 'auth-callback' && method === 'GET') {
    return handleAuthCallback(request, ctx);
  }

  if (action === 'fetch' && method === 'POST') {
    return fetchSheetData(request, ctx);
  }

  if (action === 'token-status' && method === 'GET') {
    return getTokenStatus(ctx);
  }

  if (action === 'update' && method === 'POST') {
    return updateSheetData(request, ctx);
  }

  if (action === 'append' && method === 'POST') {
    return appendSheetData(request, ctx);
  }

  if (action === 'cache' && method === 'GET') {
    return getCacheStatus(ctx);
  }

  if (action === 'cache' && method === 'DELETE') {
    return clearCache(request, ctx);
  }

  if (action === 'connect' && method === 'GET') {
    return initiateGoogleConnect(request, ctx);
  }

  if (action === 'callback' && method === 'GET') {
    return handleGoogleCallback(request, ctx);
  }

  if (action === 'status' && method === 'GET') {
    return getConnectionStatus(request, ctx);
  }

  if (action === 'disconnect' && method === 'POST') {
    return disconnectGoogle(request, ctx);
  }

  if (!action && method === 'GET') {
    return requireOwner(request, ctx, () => listSheetConnections(ctx));
  }

  if (!action && method === 'POST') {
    return requireOwner(request, ctx, () => createSheetConnection(request, ctx));
  }

  if (action === 'import' && name && method === 'POST') {
    return requireOwner(request, ctx, () => importFromSheet(request, ctx, name));
  }

  if (action === 'export' && name && method === 'POST') {
    return requireOwner(request, ctx, () => exportToSheet(request, ctx, name));
  }

  if (action && !name && method === 'GET') {
    return requireOwner(request, ctx, () => getSheetConnection(ctx, action));
  }

  if (action && !name && method === 'DELETE') {
    return requireOwner(request, ctx, () => deleteSheetConnection(ctx, action));
  }

  return errorResponse(DATA_ERRORS.NOT_FOUND);
}
