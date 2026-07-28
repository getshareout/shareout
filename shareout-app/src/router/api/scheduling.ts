import {
  handleCreateJob,
  handleListJobs,
  handleGetJob,
  handleGetJobLogs,
  handleUpdateJob,
  handleDeleteJob,
  handleRunJob,
} from '../../scheduling/handler';
import {
  handleCreateTemplate,
  handleListTemplates,
  handleGetTemplate,
  handleUpdateTemplate,
  handleDeleteTemplate,
  handlePreviewTemplate,
} from '../../scheduling/templates-handler';
import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';

export async function routeSchedulingApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;

  if (path === '/v1/jobs' && request.method === 'GET') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListJobs(request, env, user));
  }

  if (path === '/v1/jobs' && request.method === 'POST') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleCreateJob(request, env, user));
  }

  const jobRunMatch = path.match(/^\/v1\/jobs\/([^/]+)\/run$/);
  if (jobRunMatch && request.method === 'POST') {
    const [, jobId] = jobRunMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleRunJob(env, user, jobId));
  }

  const jobLogsMatch = path.match(/^\/v1\/jobs\/([^/]+)\/logs$/);
  if (jobLogsMatch && request.method === 'GET') {
    const [, jobId] = jobLogsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleGetJobLogs(env, user, jobId));
  }

  const jobMatch = path.match(/^\/v1\/jobs\/([^/]+)$/);
  if (jobMatch) {
    const [, jobId] = jobMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      return addCORS(await handleGetJob(env, user, jobId));
    }
    if (request.method === 'PATCH' || request.method === 'PUT') {
      return addCORS(await handleUpdateJob(request, env, user, jobId));
    }
    if (request.method === 'DELETE') {
      return addCORS(await handleDeleteJob(env, user, jobId));
    }
  }

  if (path === '/v1/templates' && request.method === 'GET') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListTemplates(request, env, user));
  }

  if (path === '/v1/templates' && request.method === 'POST') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleCreateTemplate(request, env, user));
  }

  if (path === '/v1/templates/preview' && request.method === 'POST') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handlePreviewTemplate(request, env, user));
  }

  const templateMatch = path.match(/^\/v1\/templates\/([^/]+)$/);
  if (templateMatch) {
    const [, templateId] = templateMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      return addCORS(await handleGetTemplate(env, user, templateId));
    }
    if (request.method === 'PATCH' || request.method === 'PUT') {
      return addCORS(await handleUpdateTemplate(request, env, user, templateId));
    }
    if (request.method === 'DELETE') {
      return addCORS(await handleDeleteTemplate(env, user, templateId));
    }
  }

  const templatePreviewMatch = path.match(/^\/v1\/templates\/([^/]+)\/preview$/);
  if (templatePreviewMatch && request.method === 'POST') {
    const [, templateId] = templatePreviewMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handlePreviewTemplate(request, env, user, templateId));
  }

  return null;
}
