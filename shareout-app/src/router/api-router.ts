import { createLogger, logError } from '../logging';
import type { FetchContext } from './context';
import { routeArtifactApi } from './api/artifacts';
import { routeHomeApi } from './api/home';
import { routeHomeAgentApi } from './api/home-agent';
import { routeFolderApi } from './api/folders';
import { routeAssetApi } from './api/assets';
import { routeWorkspaceApi } from './api/workspaces';
import { routeWorkspaceAgentApi } from './api/workspace-agent';
import { routeSchedulingApi } from './api/scheduling';
import { routeMetricAlertsApi } from './api/metric-alerts';
import { routeMetricWatchApi } from './api/metric-watch';
import { routeMiscApi } from './api/misc';
import { routeCreateApi } from './api/create';
import { routeFunnelApi } from './api/funnel';
import { routePerfApi } from './api/perf';
import { routePresenceApi } from './api/presence';
import { routeAdminApi } from './api/admin';
import { routeFeaturesApi } from './api/features';
import { routeAccessRequestsApi } from './api/access-requests';
import { routeSupportApi } from './api/support';
import { routeCatalogApi } from './api/catalog';
import { routeKnowledgeApi } from './api/knowledge';
import { routeDemoApi } from './api/demo';
import { jsonError } from './helpers/json-response';

export async function routeApi(ctx: FetchContext): Promise<Response | null> {
  try {
    return (
      (await routeAdminApi(ctx)) ??
      (await routeFunnelApi(ctx)) ??
      (await routePerfApi(ctx)) ??
      (await routePresenceApi(ctx)) ??
      (await routeCreateApi(ctx)) ??
      (await routeMiscApi(ctx)) ??
      (await routeHomeApi(ctx)) ??
      (await routeHomeAgentApi(ctx)) ??
      (await routeFolderApi(ctx)) ??
      (await routeAssetApi(ctx)) ??
      (await routeArtifactApi(ctx)) ??
      (await routeAccessRequestsApi(ctx)) ??
      (await routeWorkspaceAgentApi(ctx)) ??
      (await routeWorkspaceApi(ctx)) ??
      (await routeSchedulingApi(ctx)) ??
      (await routeMetricAlertsApi(ctx)) ??
      (await routeMetricWatchApi(ctx)) ??
      (await routeFeaturesApi(ctx)) ??
      (await routeSupportApi(ctx)) ??
      (await routeCatalogApi(ctx)) ??
      (await routeKnowledgeApi(ctx)) ??
      (await routeDemoApi(ctx))
    );
  } catch (err) {
    const logger = createLogger(ctx.env, {
      event: 'api.handler_error',
      method: ctx.request.method,
      path: ctx.path,
    });
    logError(logger, 'api route handler threw', err);
    return ctx.addCORS(jsonError('Internal server error', 'INTERNAL_ERROR', 500));
  }
}
