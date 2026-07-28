import { errorResponse, type DataContext } from '../middleware';
import { PRES_ID_PATTERN } from './constants';
import { handleWebSocket } from './websocket';
import {
  createPresentation,
  deletePresentation,
  getPresentation,
  listPresentations,
  updatePresentation,
} from './presentations';
import { handleSlidesRoutes } from './slides';
import { handleVersionsRoutes } from './versions';
import { handlePresenterRoutes } from './presenter';
import { handlePublishRoutes } from './publish';
import { handleGenerateRoute } from './generate';
import { handleExportRoute } from './export';
import { handleAnalyticsRoutes } from './analytics';
import { handleLinksRoutes } from './links';

export async function handleSlides(
  request: Request,
  ctx: DataContext,
  path: string
): Promise<Response> {
  const parts = path.split('/').filter(Boolean);
  const firstPart = parts[0];

  if (!firstPart) {
    switch (request.method) {
      case 'GET':
        return listPresentations(ctx);
      case 'POST':
        return createPresentation(request, ctx);
      default:
        return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
    }
  }

  if (firstPart === 'ws') {
    return handleWebSocket(request, ctx);
  }

  if (firstPart === 'generate') {
    return handleGenerateRoute(request, ctx);
  }

  if (!PRES_ID_PATTERN.test(firstPart)) {
    return errorResponse({ code: 'INVALID_ID', message: 'Invalid presentation ID', status: 400 });
  }

  const presId = firstPart;
  const secondPart = parts[1];

  if (!secondPart) {
    switch (request.method) {
      case 'GET':
        return getPresentation(ctx, presId);
      case 'PATCH':
        return updatePresentation(request, ctx, presId);
      case 'DELETE':
        return deletePresentation(request, ctx, presId);
      default:
        return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
    }
  }

  switch (secondPart) {
    case 'slides':
      return handleSlidesRoutes(request, ctx, presId, parts.slice(2));

    case 'versions':
      return handleVersionsRoutes(request, ctx, presId, parts.slice(2));

    case 'presenter':
      return handlePresenterRoutes(request, ctx, presId, parts.slice(2));

    case 'publish':
      return handlePublishRoutes(request, ctx, presId, parts.slice(2));

    case 'export':
      return handleExportRoute(request, ctx, presId);

    case 'analytics':
      return handleAnalyticsRoutes(request, ctx, presId, parts.slice(2));

    case 'links':
      return handleLinksRoutes(request, ctx, presId, parts.slice(2));

    default:
      return errorResponse({ code: 'NOT_FOUND', message: 'Route not found', status: 404 });
  }
}
