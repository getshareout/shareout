import { inboxAddress } from '../../scheduling/email';
import type { FetchContext } from '../context';
import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';
import { getInternalWorkspaceRole } from '../../workspaces';
import { isFeatureEnabled, webAgentBlockedPayload } from '../../features/flags';
import { buildClientsContextForWorkspace } from '../../sharees/context';
import { knowledgeTrunkForContext } from '../../knowledge-context';
import { guidanceEntryForContext } from '../../workspace-context';
import { checkAiChatLimit, checkWebAgentWorkspaceLimit } from '../../rate-limit';
import { queryHomeArtifactCatalog } from '../../pages/home/queries';
import {
  jsonResp, streamAgentChat, confirmAgentAction, listAgentThreads,
  getAgentThreadMessages, renameAgentThread, deleteAgentThread, serveAgentMedia,
} from './web-agent-shared';

/** Lightweight orientation snapshot injected into the system prompt. Untrusted user data. */
export async function buildWorkspaceSnapshot(env: Env, wsId: string, user: AuthUser): Promise<string> {
  const cat = await queryHomeArtifactCatalog(env, { id: user.id, email: user.email }, wsId)
    .catch(() => ({ artifacts: [] as { id: string; name: string }[], total: 0, truncated: false }));
  const pages = cat.artifacts.slice(0, 15).map((a) => `- ${a.name} (id: ${a.id})`).join('\n');

  const [conns, mc, wsRow] = await Promise.all([
    env.DB.prepare(
      "SELECT name, provider, kind, agent_query_enabled FROM connections WHERE scope_type = 'workspace' AND scope_id = ? ORDER BY name"
    ).bind(wsId).all<{ name: string; provider: string; kind: string; agent_query_enabled: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?')
      .bind(wsId).first<{ n: number }>(),
    env.DB.prepare('SELECT slug FROM workspaces WHERE id = ?').bind(wsId).first<{ slug: string }>(),
  ]);

  const connLines = conns.results
    .map((c) => `- ${c.name} (${c.provider}${c.kind === 'platform' && c.agent_query_enabled === 1 ? ', queryable' : ''})`)
    .join('\n');

  const clientNotes = await buildClientsContextForWorkspace(env, wsId).catch(() => '');
  const [trunk, guidance] = await Promise.all([
    knowledgeTrunkForContext(env, wsId),
    guidanceEntryForContext(env, wsId),
  ]);
  const inboxLine = wsRow?.slug
    ? `Members can email files to ${inboxAddress(wsRow.slug, env)}; they appear in list_files.`
    : '';

  return [
    `Pages (${cat.artifacts.length} shown${cat.truncated ? '+' : ''}):`,
    pages || '(none yet)',
    '',
    'Connectors:',
    connLines || '(none)',
    '',
    `Members: ${mc?.n ?? '?'}`,
    ...(clientNotes ? ['', clientNotes] : []),
    ...(trunk ? ['', trunk] : []),
    ...(guidance ? ['', guidance] : []),
    ...(inboxLine ? ['', inboxLine] : []),
  ].join('\n');
}

async function handleChat(ctx: FetchContext, wsId: string, user: AuthUser): Promise<Response> {
  const { env } = ctx;
  const body = await ctx.request.json().catch(() => ({})) as { text?: string; threadId?: string };
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return jsonResp({ error: 'Empty message' }, 400);

  const retryMin = (r: { reset: number }) => Math.max(1, Math.ceil((r.reset - Math.floor(Date.now() / 1000)) / 60));
  const perUser = await checkAiChatLimit(env, user.id);
  if (!perUser.allowed) return jsonResp({ error: `You’re sending messages too fast — try again in about ${retryMin(perUser)} min.` }, 429);
  const perWs = await checkWebAgentWorkspaceLimit(env, wsId);
  if (!perWs.allowed) return jsonResp({ error: `This workspace has hit its assistant limit — try again in about ${retryMin(perWs)} min.` }, 429);

  return streamAgentChat(env, {
    scopeKey: wsId,
    user,
    selectedWorkspaceId: wsId,
    text,
    threadId: typeof body.threadId === 'string' ? body.threadId : undefined,
    buildSnapshot: () => buildWorkspaceSnapshot(env, wsId, user),
  });
}

export async function routeWorkspaceAgentApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS, url } = ctx;

  const m = path.match(/^\/v1\/workspace\/([^/]+)\/agent\/(.+)$/);
  if (!m) return null;
  const wsId = m[1];
  const rest = m[2];
  const method = request.method;

  const user = await requireTokenOrSession(ctx);
  if (!isAuthUser(user)) return user;

  const role = await getInternalWorkspaceRole(env, wsId, user.id);
  if (!role) return addCORS(jsonResp({ error: 'Forbidden' }, 403));
  if (!(await isFeatureEnabled(env, 'ai.web_agent', wsId))) {
    const body = await webAgentBlockedPayload(env, wsId);
    return addCORS(jsonResp(body, 403));
  }

  if (rest === 'chat' && method === 'POST') return addCORS(await handleChat(ctx, wsId, user));
  if (rest === 'confirm' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as { token?: string };
    return addCORS(await confirmAgentAction(env, wsId, user, typeof body.token === 'string' ? body.token : ''));
  }
  if (rest === 'threads' && method === 'GET') return addCORS(await listAgentThreads(env, wsId, user.id));

  const media = rest.match(/^media\/([^/]+)$/);
  if (media && method === 'GET') return addCORS(await serveAgentMedia(env, user.id, media[1]));

  const rename = rest.match(/^threads\/([^/]+)\/rename$/);
  if (rename && method === 'POST') {
    const body = await request.json().catch(() => ({})) as { title?: string };
    return addCORS(await renameAgentThread(env, wsId, user.id, rename[1], typeof body.title === 'string' ? body.title : ''));
  }

  const thread = rest.match(/^threads\/([^/]+)$/);
  if (thread && method === 'GET') {
    const before = url.searchParams.get('before') || undefined;
    return addCORS(await getAgentThreadMessages(env, wsId, user.id, thread[1], before));
  }
  if (thread && method === 'DELETE') return addCORS(await deleteAgentThread(env, wsId, user.id, thread[1]));

  return addCORS(jsonResp({ error: 'Method not allowed' }, 405));
}
