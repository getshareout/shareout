import {
  handleListWorkspaceSchedules,
  handleGetWorkspaceScheduleLogs,
  handleRunWorkspaceSchedule,
  handleToggleWorkspaceSchedule,
  handleDeleteWorkspaceSchedule,
  handleListWorkspaceAutomations,
  handleGetWorkspaceAutomationRuns,
  handleRunWorkspaceAutomation,
  handleToggleWorkspaceAutomation,
  handleDeleteWorkspaceAutomation,
  handleListWorkspaceRuns,
  handleGetWorkspaceRun,
} from './workspace-jobs';
import {
  handleListWorkspaceAlerts,
  handleGetWorkspaceAlertEvents,
  handleRunWorkspaceAlert,
  handleToggleWorkspaceAlert,
  handleDeleteWorkspaceAlert,
} from './workspace-metric-alerts';
import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';

/** Admin schedules, automations, metric alerts, and unified run inspector routes.
 *  Split out of workspaces.ts to keep the main router under the size cap. */
export async function routeWorkspaceOps(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;

  const schedulesMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/schedules$/);
  if (schedulesMatch && request.method === 'GET') {
    const [, workspaceId] = schedulesMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListWorkspaceSchedules(env, user, workspaceId));
  }

  const scheduleLogsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/schedules\/([^/]+)\/logs$/);
  if (scheduleLogsMatch && request.method === 'GET') {
    const [, workspaceId, jobId] = scheduleLogsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleGetWorkspaceScheduleLogs(env, user, workspaceId, jobId));
  }

  const scheduleRunMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/schedules\/([^/]+)\/run$/);
  if (scheduleRunMatch && request.method === 'POST') {
    const [, workspaceId, jobId] = scheduleRunMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleRunWorkspaceSchedule(env, user, workspaceId, jobId));
  }

  const scheduleMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/schedules\/([^/]+)$/);
  if (scheduleMatch) {
    const [, workspaceId, jobId] = scheduleMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'PATCH' || request.method === 'PUT') {
      return addCORS(await handleToggleWorkspaceSchedule(request, env, user, workspaceId, jobId));
    }
    if (request.method === 'DELETE') {
      return addCORS(await handleDeleteWorkspaceSchedule(env, user, workspaceId, jobId));
    }
  }

  const automationsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/automations$/);
  if (automationsMatch && request.method === 'GET') {
    const [, workspaceId] = automationsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListWorkspaceAutomations(env, user, workspaceId));
  }

  const automationRunsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/automations\/([^/]+)\/runs$/);
  if (automationRunsMatch && request.method === 'GET') {
    const [, workspaceId, triggerId] = automationRunsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleGetWorkspaceAutomationRuns(env, user, workspaceId, triggerId));
  }

  const automationRunNowMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/automations\/([^/]+)\/run$/);
  if (automationRunNowMatch && request.method === 'POST') {
    const [, workspaceId, triggerId] = automationRunNowMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleRunWorkspaceAutomation(env, user, workspaceId, triggerId));
  }

  const automationMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/automations\/([^/]+)$/);
  if (automationMatch) {
    const [, workspaceId, triggerId] = automationMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'PATCH' || request.method === 'PUT') {
      return addCORS(await handleToggleWorkspaceAutomation(request, env, user, workspaceId, triggerId));
    }
    if (request.method === 'DELETE') {
      return addCORS(await handleDeleteWorkspaceAutomation(env, user, workspaceId, triggerId));
    }
  }

  const alertsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/metric-alerts$/);
  if (alertsMatch && request.method === 'GET') {
    const [, workspaceId] = alertsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListWorkspaceAlerts(env, user, workspaceId));
  }

  const alertEventsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/metric-alerts\/([^/]+)\/events$/);
  if (alertEventsMatch && request.method === 'GET') {
    const [, workspaceId, ruleId] = alertEventsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleGetWorkspaceAlertEvents(env, user, workspaceId, ruleId));
  }

  const runDetailMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/runs\/(crew|job|alert)\/([^/]+)$/);
  if (runDetailMatch && request.method === 'GET') {
    const [, workspaceId, surface, runId] = runDetailMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleGetWorkspaceRun(env, user, workspaceId, surface, runId));
  }

  const runsListMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/runs$/);
  if (runsListMatch && request.method === 'GET') {
    const [, workspaceId] = runsListMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListWorkspaceRuns(env, user, workspaceId, new URL(request.url).searchParams));
  }

  const alertRunMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/metric-alerts\/([^/]+)\/run$/);
  if (alertRunMatch && request.method === 'POST') {
    const [, workspaceId, ruleId] = alertRunMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleRunWorkspaceAlert(env, user, workspaceId, ruleId));
  }

  const alertMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/metric-alerts\/([^/]+)$/);
  if (alertMatch) {
    const [, workspaceId, ruleId] = alertMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'PATCH' || request.method === 'PUT') {
      return addCORS(await handleToggleWorkspaceAlert(request, env, user, workspaceId, ruleId));
    }
    if (request.method === 'DELETE') {
      return addCORS(await handleDeleteWorkspaceAlert(env, user, workspaceId, ruleId));
    }
  }

  return null;
}
