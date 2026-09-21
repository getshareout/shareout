/**
 * Skill authoring, governance and install routes.
 *
 * Browse/vote/attach live with the artifact and workspace routers already; this file
 * is everything added for the library overhaul — creating and editing a skill from a
 * session, the review flow, and the surfaces an external agent installs from.
 * Registered ahead of the workspace router so `/v1/workspaces/:id/skills/index.json`
 * is not read as a skill id.
 */
import type { FetchContext } from '../context';
import { getTokenOrSessionUser, isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';
import {
  handleCreateSkill,
  handleSetSkillPolicy,
  handleSetWorkspaceSkillPolicy,
  handleUpdateSkillMarkdown,
} from '../../skills/editing';
import {
  handleGetSkillChange,
  handleListSkillChanges,
  handleProposeSkillChange,
  handleReviewSkillChange,
} from '../../skills/changes';
import {
  handleGetSkillRaw,
  handleWorkspaceSkillsIndex,
  serveSkillInstaller,
} from '../../skills/install';
import { handleSyncAgentSkill } from '../../skill-marketplace';

export async function routeSkillsApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS, executionCtx } = ctx;

  // Public: carries no data, authenticates with the caller's own token at run time.
  if (path === '/v1/skills/install.sh' && request.method === 'GET') {
    return addCORS(serveSkillInstaller(env));
  }

  // Optional auth — official skills are readable without a token (see install.ts).
  const rawMatch = path.match(/^\/v1\/skills\/([^/]+)\/raw$/);
  if (rawMatch && request.method === 'GET') {
    return addCORS(await handleGetSkillRaw(env, await getTokenOrSessionUser(ctx), rawMatch[1]));
  }

  const skillMarkdownMatch = path.match(/^\/v1\/skills\/([^/]+)\/markdown$/);
  if (skillMarkdownMatch && (request.method === 'PUT' || request.method === 'PATCH')) {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleUpdateSkillMarkdown(request, env, user, skillMarkdownMatch[1], executionCtx));
  }

  const skillPolicyMatch = path.match(/^\/v1\/skills\/([^/]+)\/policy$/);
  if (skillPolicyMatch && (request.method === 'PUT' || request.method === 'PATCH')) {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleSetSkillPolicy(request, env, user, skillPolicyMatch[1]));
  }

  const changeItemMatch = path.match(/^\/v1\/skills\/([^/]+)\/changes\/([^/]+)$/);
  if (changeItemMatch) {
    const [, skillId, changeId] = changeItemMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') return addCORS(await handleGetSkillChange(env, user, skillId, changeId));
    if (request.method === 'POST') {
      return addCORS(await handleReviewSkillChange(request, env, user, skillId, changeId, executionCtx));
    }
  }

  const changesMatch = path.match(/^\/v1\/skills\/([^/]+)\/changes$/);
  if (changesMatch) {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') return addCORS(await handleListSkillChanges(request, env, user, changesMatch[1]));
    if (request.method === 'POST') return addCORS(await handleProposeSkillChange(request, env, user, changesMatch[1]));
  }

  const wsIndexMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/skills\/index\.json$/);
  if (wsIndexMatch && request.method === 'GET') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleWorkspaceSkillsIndex(env, user, wsIndexMatch[1]));
  }

  const wsCreateMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/skills$/);
  if (wsCreateMatch && request.method === 'POST') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleCreateSkill(request, env, user, wsCreateMatch[1], executionCtx));
  }

  const wsSkillPolicyMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/skill-policy$/);
  if (wsSkillPolicyMatch && (request.method === 'PUT' || request.method === 'PATCH')) {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleSetWorkspaceSkillPolicy(request, env, user, wsSkillPolicyMatch[1]));
  }

  // Re-pin an attached agent skill to the skill's current version. DELETE on the
  // same path (detach) stays with the workspace-settings router.
  const agentSkillSyncMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/agent-skills\/([^/]+)$/);
  if (agentSkillSyncMatch && (request.method === 'POST' || request.method === 'PUT')) {
    const [, scope, skillId] = agentSkillSyncMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleSyncAgentSkill(env, user, scope, skillId));
  }

  return null;
}
