import {
  handleGetSubdomain,
  handleEnableSubdomain,
  handleDisableSubdomain,
} from '../../enterprise';
import { handleGetSkill, handleGetSkillVersion, handleGetSkillMeta, handleGetSkillFile } from '../../skill';
import { handleGlobalProxy } from '../../proxy';
import type { FetchContext } from '../context';
import { isAuthUser, requireToken, getTokenOrSessionUser, requireTokenOrSession } from '../helpers/auth-guard';
import { getSkillWorkspaceContext } from '../../workspace-context';
import { jsonResponse } from '../helpers/json-response';
import { getPlatformOrigin } from '../../config/origins';
import { schemaReady } from '../../pages/setup';

export async function routeMiscApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, url, addCORS } = ctx;

  const subdomainMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/subdomain$/);
  if (subdomainMatch) {
    const [, workspaceId] = subdomainMatch;
    const user = await requireToken(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      return addCORS(await handleGetSubdomain(env, user, workspaceId));
    }
    if (request.method === 'POST') {
      return addCORS(await handleEnableSubdomain(request, env, user, workspaceId));
    }
    if (request.method === 'DELETE') {
      return addCORS(await handleDisableSubdomain(env, user, workspaceId));
    }
  }

  if (path === '/v1/skill' && (request.method === 'GET' || request.method === 'HEAD')) {
    const wsParam = url.searchParams.get('workspace');
    let workspaceContext = '';
    if (wsParam) {
      const user = await getTokenOrSessionUser(ctx);
      if (user) workspaceContext = await getSkillWorkspaceContext(env, wsParam, user.id);
    }
    return handleGetSkill(request, env, workspaceContext);
  }

  if (path === '/v1/skill/version' && request.method === 'GET') {
    return handleGetSkillVersion(env);
  }

  if (path === '/v1/skill/meta' && request.method === 'GET') {
    return handleGetSkillMeta(env);
  }

  const skillFileMatch = path.match(/^\/v1\/skill\/(.+)$/);
  if (skillFileMatch && request.method === 'GET') {
    const [, filePath] = skillFileMatch;
    if (filePath !== 'version' && filePath !== 'meta') {
      return handleGetSkillFile(filePath, env);
    }
  }

  if (path === '/api/proxy') {
    if (request.method !== 'OPTIONS') {
      const user = await requireTokenOrSession(ctx);
      if (!isAuthUser(user)) return user;
    }
    return handleGlobalProxy(request, env);
  }

  if (path === '/health') {
    // An unset SHAREOUT_BASE_URL is not a cosmetic default: every agent-facing URL
    // (the skill, the discovery documents, the OpenAPI servers block) then names the
    // hosted instance, so agents publish this instance's content somewhere else.
    // Surface it here so a deploy check catches it instead of a confused user.
    const warnings: string[] = [];
    if (!env.SHAREOUT_BASE_URL?.trim()) {
      warnings.push('SHAREOUT_BASE_URL is unset — agent-facing URLs fall back to the hosted instance');
    }
    // The Deploy button creates the D1 database but does not apply migrations, so a
    // fresh instance can answer /health while every real request 500s. Say so here
    // rather than letting the operator discover it one opaque error at a time.
    const schema = await schemaReady(env);
    if (!schema) {
      warnings.push('database schema not applied — run: npx wrangler d1 migrations apply DB --remote');
    }
    return jsonResponse({
      status: 'ok',
      ts: Date.now(),
      origin: getPlatformOrigin(env),
      schema: schema ? 'ready' : 'missing',
      ...(warnings.length ? { warnings } : {}),
    });
  }

  if (path === '/__debug/request') {
    return jsonResponse({
      url: request.url,
      hostname: url.hostname,
      host: request.headers.get('Host'),
      cfConnectingIp: request.headers.get('cf-connecting-ip'),
      xForwardedFor: request.headers.get('x-forwarded-for'),
    });
  }

  return null;
}
