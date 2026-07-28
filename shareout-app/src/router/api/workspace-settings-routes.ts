import {
  handleGetWorkspaceAccessPolicy,
  handleUpdateWorkspaceAccessPolicy,
  handleGetWorkspaceBranding,
  handleUpdateWorkspaceBranding,
  handleUploadWorkspaceLogo,
  handleDeleteWorkspaceLogo,
  getInternalWorkspaceRole,
} from '../../workspaces';
import { buildFeaturesPayload } from '../../features/flags';
import { handleGetPublishPolicy, handleSetPublishPolicy, handleListPublishApprovals } from '../../publish-approval';
import {
  handleListWorkspaceContext,
  handleGetWorkspaceContextFile,
  handlePutWorkspaceContextFile,
  handleDeleteWorkspaceContextFile,
  handleSetWorkspaceContextEntry,
} from '../../workspace-context';
import {
  handleListSkills,
  handleListSkillCategories,
  handleListMySkills,
  handleGetSkillMarkdown,
  handleListAgentSkills,
  handleAttachAgentSkill,
  handleDetachAgentSkill,
} from '../../skill-marketplace';
import { handleListRecommendedSkills } from '../../official-skills/list';
import { handleListWorkspaceLibraries } from '../../workspace-library';
import { handleGetWorkspaceAudit } from './workspace-audit';
import { handleGetWorkspaceSessionPolicy, handleSetWorkspaceSessionPolicy } from './workspace-session-policy';
import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';

/** Workspace policy, branding, context, skills, and library routes.
 *  Split out of workspaces.ts to keep the main router under the size cap. */
export async function routeWorkspaceSettings(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;

  const workspaceAccessPolicyMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/access-policy$/);
  if (workspaceAccessPolicyMatch) {
    const [, workspaceId] = workspaceAccessPolicyMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      return addCORS(await handleGetWorkspaceAccessPolicy(env, user, workspaceId));
    }
    if (request.method === 'PUT' || request.method === 'PATCH') {
      return addCORS(await handleUpdateWorkspaceAccessPolicy(request, env, user, workspaceId));
    }
  }

  const publishPolicyMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/publish-policy$/);
  if (publishPolicyMatch) {
    const [, workspaceId] = publishPolicyMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') {
      return addCORS(await handleGetPublishPolicy(env, user, workspaceId));
    }
    if (request.method === 'PUT' || request.method === 'PATCH') {
      return addCORS(await handleSetPublishPolicy(request, env, user, workspaceId));
    }
  }

  const publishApprovalsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/publish-approvals$/);
  if (publishApprovalsMatch) {
    const [, workspaceId] = publishApprovalsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') {
      return addCORS(await handleListPublishApprovals(request, env, user, workspaceId));
    }
  }

  const workspaceBrandingMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/branding$/);
  if (workspaceBrandingMatch) {
    const [, workspaceId] = workspaceBrandingMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      return addCORS(await handleGetWorkspaceBranding(env, user, workspaceId));
    }
    if (request.method === 'PUT' || request.method === 'PATCH') {
      return addCORS(await handleUpdateWorkspaceBranding(request, env, user, workspaceId));
    }
  }

  const workspaceFeaturesMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/features$/);
  if (workspaceFeaturesMatch && request.method === 'GET') {
    const [, workspaceId] = workspaceFeaturesMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
    if (!role) return addCORS(Response.json({ error: 'Not a member of this workspace', code: 'FORBIDDEN' }, { status: 403 }));
    return addCORS(Response.json({ ...(await buildFeaturesPayload(env, workspaceId)), readonly: true }));
  }

  const workspaceAuditMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/audit$/);
  if (workspaceAuditMatch && request.method === 'GET') {
    const [, workspaceId] = workspaceAuditMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleGetWorkspaceAudit(request, env, user, workspaceId));
  }

  const workspaceSessionPolicyMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/session-policy$/);
  if (workspaceSessionPolicyMatch) {
    const [, workspaceId] = workspaceSessionPolicyMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') {
      return addCORS(await handleGetWorkspaceSessionPolicy(env, user, workspaceId));
    }
    if (request.method === 'PUT' || request.method === 'PATCH') {
      return addCORS(await handleSetWorkspaceSessionPolicy(request, env, user, workspaceId));
    }
  }

  const wsContextFileMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/context\/([^/]+)$/);
  if (wsContextFileMatch) {
    const [, workspaceId, name] = wsContextFileMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      return addCORS(await handleGetWorkspaceContextFile(env, user, workspaceId, name));
    }
    if (request.method === 'PUT' || request.method === 'POST') {
      return addCORS(await handlePutWorkspaceContextFile(request, env, user, workspaceId, name));
    }
    if (request.method === 'DELETE') {
      return addCORS(await handleDeleteWorkspaceContextFile(env, user, workspaceId, name));
    }
  }

  const wsContextMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/context$/);
  if (wsContextMatch) {
    const [, workspaceId] = wsContextMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      return addCORS(await handleListWorkspaceContext(env, user, workspaceId));
    }
    if (request.method === 'PUT' || request.method === 'PATCH') {
      return addCORS(await handleSetWorkspaceContextEntry(request, env, user, workspaceId));
    }
  }

  if (path === '/v1/skills/recommended' && request.method === 'GET') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListRecommendedSkills(env, user));
  }

  const skillMdMatch = path.match(/^\/v1\/skills\/([^/]+)\/markdown$/);
  if (skillMdMatch && request.method === 'GET') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleGetSkillMarkdown(env, user, skillMdMatch[1]));
  }

  const agentSkillOneMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/agent-skills\/([^/]+)$/);
  if (agentSkillOneMatch && request.method === 'DELETE') {
    const [, scope, skillId] = agentSkillOneMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleDetachAgentSkill(env, user, scope, skillId));
  }

  const agentSkillsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/agent-skills$/);
  if (agentSkillsMatch) {
    const [, scope] = agentSkillsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') return addCORS(await handleListAgentSkills(env, user, scope));
    if (request.method === 'POST') return addCORS(await handleAttachAgentSkill(request, env, user, scope));
  }

  const wsSkillCategoriesMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/skills\/categories$/);
  if (wsSkillCategoriesMatch && request.method === 'GET') {
    const [, workspaceId] = wsSkillCategoriesMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListSkillCategories(env, user, workspaceId));
  }

  const wsMySkillsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/skills\/installed$/);
  if (wsMySkillsMatch && request.method === 'GET') {
    const [, workspaceId] = wsMySkillsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListMySkills(env, user, workspaceId));
  }

  const wsSkillsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/skills$/);
  if (wsSkillsMatch && request.method === 'GET') {
    const [, workspaceId] = wsSkillsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListSkills(request, env, user, workspaceId));
  }

  const wsLibrariesMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/libraries$/);
  if (wsLibrariesMatch && request.method === 'GET') {
    const [, workspaceId] = wsLibrariesMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListWorkspaceLibraries(env, user, workspaceId));
  }

  const workspaceLogoMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/logo$/);
  if (workspaceLogoMatch) {
    const [, workspaceId] = workspaceLogoMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'POST' || request.method === 'PUT') {
      return addCORS(await handleUploadWorkspaceLogo(request, env, user, workspaceId));
    }
    if (request.method === 'DELETE') {
      return addCORS(await handleDeleteWorkspaceLogo(env, user, workspaceId));
    }
  }

  return null;
}
