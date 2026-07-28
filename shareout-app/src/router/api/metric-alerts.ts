import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';
import {
  createRule,
  listRulesForArtifact,
  listRulesForOwner,
  getRule,
  updateRule,
  deleteRule,
  runRuleManually,
  getRuleEvents,
  type CreateRuleRequest,
} from '../../metric-alerts/rules';
import {
  upsertDefinition,
  listDefinitions,
  deleteDefinition,
  type UpsertDefinitionRequest,
} from '../../metric-alerts/definitions';
import { jsonWithApiErrors, simpleApiError } from '../../http/api-error';

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

function errorJson(error: string): Response {
  const status = /not found/i.test(error) ? 404 : /permission|denied|only/i.test(error) ? 403 : 400;
  // Free-form message without a stable code — use a generic INVALID_REQUEST code.
  return simpleApiError(error, status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : 'INVALID_REQUEST', status);
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }
}

/**
 * Follow Metric Alerts API. Metric definitions and alert subscriptions are
 * account/product objects (like /v1/jobs). They accept either a ShareOut API
 * token or a browser session cookie, so the editor, the home, and the artifact
 * toolbar can all manage them.
 */
export async function routeMetricAlertsApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, url, addCORS } = ctx;
  if (!path.startsWith('/v1/metric-alerts')) return null;

  // --- Metric definitions: /v1/metric-alerts/definitions ---
  if (path === '/v1/metric-alerts/definitions') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      const artifactId = url.searchParams.get('artifact_id');
      if (!artifactId) return addCORS(json({ error: 'artifact_id query param required' }, 400));
      const result = await listDefinitions(env, user.id, artifactId);
      return addCORS(result.error ? errorJson(result.error) : json({ definitions: result.definitions }));
    }
    if (request.method === 'PUT' || request.method === 'POST') {
      const bodyOrError = await parseJsonBody(request);
      if (bodyOrError instanceof Response) return addCORS(bodyOrError);
      const body = bodyOrError;
      const artifactId = body.artifact_id as string;
      if (!artifactId) return addCORS(json({ error: 'artifact_id required' }, 400));
      const result = await upsertDefinition(env, user.id, artifactId, body as unknown as UpsertDefinitionRequest);
      return addCORS(result.error ? errorJson(result.error) : json({ definition: result.definition }));
    }
  }

  const defDeleteMatch = path.match(/^\/v1\/metric-alerts\/definitions\/([^/]+)\/([^/]+)$/);
  if (defDeleteMatch && request.method === 'DELETE') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    const [, artifactId, metricId] = defDeleteMatch;
    const result = await deleteDefinition(env, user.id, artifactId, metricId);
    return addCORS(result.error ? errorJson(result.error) : json({ success: true }));
  }

  // --- Alert rules: /v1/metric-alerts ---
  if (path === '/v1/metric-alerts') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      const artifactId = url.searchParams.get('artifact_id');
      if (artifactId) {
        const result = await listRulesForArtifact(env, user.id, artifactId);
        return addCORS(result.error ? errorJson(result.error) : json({ alerts: result.rules }));
      }
      // No artifact_id → the caller's own alerts across every artifact (personal view).
      const rules = await listRulesForOwner(env, user.id);
      return addCORS(json({ alerts: rules }));
    }
    if (request.method === 'POST') {
      const bodyOrError = await parseJsonBody(request);
      if (bodyOrError instanceof Response) return addCORS(bodyOrError);
      const result = await createRule(env, user.id, bodyOrError as unknown as CreateRuleRequest);
      return addCORS(result.error ? errorJson(result.error) : json({ alert: result.rule }, 201));
    }
  }

  const runMatch = path.match(/^\/v1\/metric-alerts\/([^/]+)\/run$/);
  if (runMatch && request.method === 'POST') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    const result = await runRuleManually(env, user.id, runMatch[1]);
    return addCORS(result.error ? errorJson(result.error) : json({ outcome: result.outcome }));
  }

  const eventsMatch = path.match(/^\/v1\/metric-alerts\/([^/]+)\/events$/);
  if (eventsMatch && request.method === 'GET') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    const result = await getRuleEvents(env, user.id, eventsMatch[1]);
    return addCORS(result.error ? errorJson(result.error) : json({ events: result.events }));
  }

  const ruleMatch = path.match(/^\/v1\/metric-alerts\/([^/]+)$/);
  if (ruleMatch) {
    const ruleId = ruleMatch[1];
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      const result = await getRule(env, user.id, ruleId);
      return addCORS(result.error ? errorJson(result.error) : json({ alert: result.rule }));
    }
    if (request.method === 'PATCH' || request.method === 'PUT') {
      const bodyOrError = await parseJsonBody(request);
      if (bodyOrError instanceof Response) return addCORS(bodyOrError);
      const result = await updateRule(env, user.id, ruleId, bodyOrError);
      return addCORS(result.error ? errorJson(result.error) : json({ alert: result.rule }));
    }
    if (request.method === 'DELETE') {
      const result = await deleteRule(env, user.id, ruleId);
      return addCORS(result.error ? errorJson(result.error) : json({ success: true }));
    }
  }

  return null;
}
