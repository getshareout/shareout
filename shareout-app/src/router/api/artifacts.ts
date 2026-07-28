import { handlePublish } from '../../publish';
import { getAnalytics } from '../../analytics';
import { handleEditor } from '../../editor/index';
import {
  handleListArtifacts,
  handleGetArtifact,
  handleUpdateArtifact,
  handleDeleteArtifact,
  handleListDeletedArtifacts,
  handleRestoreArtifact,
  handleRestoreAllDeleted,
  handleGetCollaborators,
  handleAddCollaborators,
  handleRemoveCollaborator,
  handleShareArtifact,
  handleTransferOwnership,
  handleGetVersions,
  handleRollback,
  handleGetArtifactFiles,
  handleAddFavorite,
  handleRemoveFavorite,
  handleGetTags,
  handleAddTag,
  handleRemoveTag,
} from '../../artifacts';
import {
  handleCreateArtifactEmail,
  handleGetArtifactEmail,
} from '../../scheduling/handler';
import { handleArchiveUnusedArtifacts, handleArchivePersonalUnused } from '../../artifacts/unused-sweep';
import { generateArtifactThumbnail } from '../../screenshots';
import { handleGetTests, handleConfigureTests, handleRunTests } from './tests';
import { handleShareToSlack } from '../../slack/share-handler';
import {
  handleVoteSkill,
  handleInstallSkill,
  handleSkillAdmin,
  handleListAttachedSkills,
  handleAttachSkill,
  handleDetachSkill,
  handleUpdateAttachedSkillVersion,
} from '../../skill-marketplace';
import {
  handleResolveLibrary,
  handlePinLibrary,
  handleUnpinLibrary,
  handleListArtifactLibraries,
} from '../../workspace-library';
import { getInternalWorkspaceRole } from '../../workspaces';
import { canAccess } from '../../access/can-access';
import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import { validateToken, hasScope } from '../../api-auth';
import type { FetchContext } from '../context';
import { isAuthUser, requireAuthUser, requireToken, requireTokenOrSession } from '../helpers/auth-guard';
import { handleCreatePublishApproval, handleDecidePublishApproval } from '../../publish-approval';
import { resolveArtifactEditorAccess } from '../helpers/editor-access';
import { isVisualEditorRoute, requireVisualEditorEnabled } from '../../editor/visual-editor-gate';
import { jsonError, jsonResponse } from '../helpers/json-response';
import { handleDeliverNow, handleDeliverStatus, handleDeliverSlackChannels } from './artifact-deliver';
import { quickSearch, type SearchGroup } from '../../search/quick-search';
import { askWorkspace } from '../../search/ask-workspace';
import { presentArtifact } from '../../present/present-artifact';
import { handleExportArtifact } from '../../artifacts/export';
import { setPresentation } from '../../artifacts/satellites';

export async function routeArtifactApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, url, addCORS } = ctx;

  // Agent (service) token scope gate, one chokepoint for the whole artifact REST
  // surface. /v1/publish enforces artifacts:publish in handlePublish; GETs need
  // artifacts:read; every other mutation (update/delete/collaborators/share/…) is
  // outside the v1 scope model, so Agent tokens are denied. Humans/personal tokens
  // have no `.service` → validateToken returns it null → this never triggers.
  // validateToken is memoized per request, so this peek is free for later branches.
  if (path !== '/v1/publish') {
    const svc = await validateToken(request, env);
    if (svc?.service) {
      if (request.method === 'GET') {
        if (!hasScope(svc, 'artifacts:read')) {
          return addCORS(jsonError('Token missing artifacts:read scope', 'INSUFFICIENT_SCOPE', 403));
        }
      } else {
        return addCORS(jsonError('Agent tokens cannot perform this action', 'INSUFFICIENT_SCOPE', 403));
      }
    }
  }

  if (path === '/v1/publish' && request.method === 'POST') {
    return addCORS(await handlePublish(request, env, ctx.executionCtx));
  }

  if (path === '/v1/artifacts' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListArtifacts(request, env, user));
  }

  // Ranked fuzzy "pro search" — same engine as the Cmd+K palette. Personal (`so_`)
  // and workspace Agent (`sot_`) tokens both work; Agent tokens are pinned to their
  // token's workspace, humans may pass ?workspace=. Sessions work too (dogfooding).
  if (path === '/v1/search' && request.method === 'GET') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    const q = url.searchParams.get('q')?.trim() || '';
    const limit = Math.min(Number(url.searchParams.get('limit')) || 10, 25);
    const workspaceId = user.service?.workspaceId || url.searchParams.get('workspace')?.trim() || undefined;
    const groupsParam = url.searchParams.get('groups')?.trim();
    const groups = groupsParam
      ? (groupsParam.split(',').map((g) => g.trim()).filter(Boolean) as SearchGroup[])
      : undefined;
    const result = await quickSearch(env, user.id, { q, workspaceId, groups, limit });
    return addCORS(jsonResponse(result));
  }

  // "Ask your workspace" — a question in, an answer + artifact citations out. Same
  // access-scoped engine as /v1/search feeds one agent turn; citations only ever point
  // at pages the caller can already see. Membership is re-checked here because the
  // agent's catalog tools trust the passed workspace id.
  if (path === '/v1/ask' && request.method === 'POST') {
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    const body = (await request.json().catch(() => ({}))) as { question?: string; workspace?: string };
    const question = body.question?.trim() || '';
    if (!question) return addCORS(jsonError('Missing question', 'INVALID_REQUEST', 400));
    const workspaceId = user.service?.workspaceId || body.workspace?.trim() || undefined;
    if (workspaceId) {
      const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
      if (!role) return addCORS(jsonError('Forbidden', 'FORBIDDEN', 403));
    }
    const result = await askWorkspace(env, user.id, workspaceId, question);
    return addCORS(jsonResponse(result));
  }

  // Trash: soft-deleted artifacts the caller can restore. Must precede the
  // /v1/artifacts/:id match so "deleted" isn't captured as an artifact id.
  if (path === '/v1/artifacts/deleted' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListDeletedArtifacts(request, env, user));
  }

  // Bulk "restore all" for the trash modal. Same static-path reasoning as its sibling
  // above — must precede the /v1/artifacts/:id match.
  if (path === '/v1/artifacts/deleted/restore-all' && request.method === 'POST') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleRestoreAllDeleted(request, env, user));
  }

  // Never-viewed janitor (personal): "archive all" for your own unopened pages. Static
  // path — colocated with /v1/artifacts/deleted so it reads next to its sibling (it can't
  // collide with /v1/artifacts/:id since that region matches artifact ids, not this POST).
  if (path === '/v1/artifacts/unused/archive' && request.method === 'POST') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleArchivePersonalUnused(env, user));
  }

  // Never-viewed janitor: one-click "archive all" from the bell card / monthly email.
  // Owner-or-admin only; soft-deletes the workspace's unused pages into the 30-day trash.
  const unusedArchiveMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/unused\/archive$/);
  if (unusedArchiveMatch && request.method === 'POST') {
    const [, workspaceId] = unusedArchiveMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleArchiveUnusedArtifacts(env, user, workspaceId));
  }

  const restoreMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/restore$/);
  if (restoreMatch && request.method === 'POST') {
    const [, artifactId] = restoreMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleRestoreArtifact(request, env, user, artifactId));
  }

  const decideApprovalMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/publish-approval\/([^/]+)\/decision$/);
  if (decideApprovalMatch && request.method === 'POST') {
    const [, , approvalId] = decideApprovalMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleDecidePublishApproval(request, env, user, approvalId));
  }

  const createApprovalMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/publish-approval$/);
  if (createApprovalMatch && request.method === 'POST') {
    const [, artifactId] = createApprovalMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleCreatePublishApproval(request, env, user, artifactId));
  }

  // "Present this" — generate a sibling slides deck from a published artifact. Any
  // caller who can access the source (owner/editor/workspace member) may deck it;
  // access is re-checked in presentArtifact, mirroring /v1/ask + metric-watch.
  const presentMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/present$/);
  if (presentMatch && request.method === 'POST') {
    const [, artifactId] = presentMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    const result = await presentArtifact(env, user.id, artifactId, ctx.executionCtx);
    if (!result.ok) return addCORS(jsonError(result.error || 'Failed to present', 'PRESENT_FAILED', result.status || 500));
    return addCORS(jsonResponse({ artifact_id: result.artifact_id, url: result.url }, 201));
  }

  // "Your data is yours" — one-click zip of an artifact (source + json + tables +
  // manifest). Owner or workspace admin; access is re-checked in the handler.
  const exportMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/export$/);
  if (exportMatch && request.method === 'GET') {
    const [, artifactId] = exportMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleExportArtifact(env, user, artifactId));
  }

  const artifactMatch = path.match(/^\/v1\/artifacts\/([^/]+)$/);
  if (artifactMatch) {
    const [, artifactId] = artifactMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      return addCORS(await handleGetArtifact(request, env, user, artifactId));
    }
    if (request.method === 'PUT' || request.method === 'PATCH') {
      return addCORS(await handleUpdateArtifact(request, env, user, artifactId));
    }
    if (request.method === 'DELETE') {
      return addCORS(await handleDeleteArtifact(request, env, user, artifactId));
    }
  }

  const collaboratorsMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/collaborators$/);
  if (collaboratorsMatch) {
    const [, artifactId] = collaboratorsMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      return addCORS(await handleGetCollaborators(request, env, user, artifactId));
    }
    if (request.method === 'POST') {
      return addCORS(await handleAddCollaborators(request, env, user, artifactId));
    }
  }

  const collaboratorMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/collaborators\/([^/]+)$/);
  if (collaboratorMatch && request.method === 'DELETE') {
    const [, artifactId, email] = collaboratorMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleRemoveCollaborator(request, env, user, artifactId, decodeURIComponent(email)));
  }

  const shareMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/share$/);
  if (shareMatch && request.method === 'POST') {
    const [, artifactId] = shareMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleShareArtifact(request, env, user, artifactId));
  }

  const shareSlackMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/share\/slack$/);
  if (shareSlackMatch && request.method === 'POST') {
    const [, artifactId] = shareSlackMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleShareToSlack(request, env, user, artifactId));
  }

  const slackChannelsMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/deliver\/slack-channels$/);
  if (slackChannelsMatch && request.method === 'GET') {
    const [, artifactId] = slackChannelsMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleDeliverSlackChannels(request, env, user, artifactId));
  }

  const deliverMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/deliver$/);
  if (deliverMatch && (request.method === 'POST' || request.method === 'GET')) {
    const [, artifactId] = deliverMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(request.method === 'GET'
      ? await handleDeliverStatus(request, env, user, artifactId)
      : await handleDeliverNow(request, env, user, artifactId));
  }

  const favoriteMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/favorite$/);
  if (favoriteMatch) {
    const [, artifactId] = favoriteMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'POST' || request.method === 'PUT') {
      return addCORS(await handleAddFavorite(request, env, user, artifactId));
    }
    if (request.method === 'DELETE') {
      return addCORS(await handleRemoveFavorite(request, env, user, artifactId));
    }
  }

  // Skill Marketplace — per-skill actions (vote/install/admin) and attachments.
  const skillVoteMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/skill\/vote$/);
  if (skillVoteMatch) {
    const [, artifactId] = skillVoteMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'POST' || request.method === 'PUT') return addCORS(await handleVoteSkill(env, user, artifactId, true));
    if (request.method === 'DELETE') return addCORS(await handleVoteSkill(env, user, artifactId, false));
  }

  const skillInstallMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/skill\/install$/);
  if (skillInstallMatch) {
    const [, artifactId] = skillInstallMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'POST' || request.method === 'PUT') return addCORS(await handleInstallSkill(env, user, artifactId, true));
    if (request.method === 'DELETE') return addCORS(await handleInstallSkill(env, user, artifactId, false));
  }

  const skillAdminMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/skill\/admin$/);
  if (skillAdminMatch && (request.method === 'PATCH' || request.method === 'POST')) {
    const [, artifactId] = skillAdminMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleSkillAdmin(request, env, user, artifactId));
  }

  // Attachments: skills bound to a target artifact.
  const skillAttachItemMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/skills\/([^/]+)$/);
  if (skillAttachItemMatch) {
    const [, artifactId, skillId] = skillAttachItemMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'DELETE') return addCORS(await handleDetachSkill(env, user, artifactId, skillId));
    if (request.method === 'POST' || request.method === 'PUT') return addCORS(await handleUpdateAttachedSkillVersion(env, user, artifactId, skillId));
  }

  const skillAttachMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/skills$/);
  if (skillAttachMatch) {
    const [, artifactId] = skillAttachMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') return addCORS(await handleListAttachedSkills(env, user, artifactId));
    if (request.method === 'POST') return addCORS(await handleAttachSkill(request, env, user, artifactId));
  }

  // Workspace Library: resolve a module name → pinned-or-latest same-origin import URL
  // for a consuming artifact. Public (module bytes are public) so so.lib() needs no auth.
  const libResolveMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/lib\/([^/]+)$/);
  if (libResolveMatch && request.method === 'GET') {
    const [, artifactId, name] = libResolveMatch;
    return addCORS(await handleResolveLibrary(env, artifactId, decodeURIComponent(name)));
  }

  // Per-artifact module pins (editor manages; viewer lists).
  const libItemMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/libs\/([^/]+)$/);
  if (libItemMatch && request.method === 'DELETE') {
    const [, artifactId, name] = libItemMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleUnpinLibrary(env, user, artifactId, decodeURIComponent(name)));
  }
  const libsMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/libs$/);
  if (libsMatch) {
    const [, artifactId] = libsMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') return addCORS(await handleListArtifactLibraries(env, user, artifactId));
    if (request.method === 'POST') return addCORS(await handlePinLibrary(request, env, user, artifactId));
  }

  const tagsMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/tags$/);
  if (tagsMatch) {
    const [, artifactId] = tagsMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      return addCORS(await handleGetTags(request, env, user, artifactId));
    }
    if (request.method === 'POST') {
      return addCORS(await handleAddTag(request, env, user, artifactId));
    }
  }

  const tagMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/tags\/([^/]+)$/);
  if (tagMatch && request.method === 'DELETE') {
    const [, artifactId, label] = tagMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleRemoveTag(request, env, user, artifactId, decodeURIComponent(label)));
  }

  const transferMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/transfer-ownership$/);
  if (transferMatch && request.method === 'POST') {
    const [, artifactId] = transferMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleTransferOwnership(request, env, user, artifactId));
  }

  const versionsMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/versions$/);
  if (versionsMatch && request.method === 'GET') {
    const [, artifactId] = versionsMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleGetVersions(request, env, user, artifactId));
  }

  const filesMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/files$/);
  if (filesMatch && request.method === 'GET') {
    const [, artifactId] = filesMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleGetArtifactFiles(request, env, user, artifactId));
  }

  const rollbackMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/rollback$/);
  if (rollbackMatch && request.method === 'POST') {
    const [, artifactId] = rollbackMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleRollback(request, env, user, artifactId));
  }

  const thumbnailMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/thumbnail$/);
  if (thumbnailMatch && request.method === 'PUT') {
    return addCORS(await handleUploadThumbnail(ctx, thumbnailMatch[1]));
  }

  const screenshotMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/screenshot$/);
  if (screenshotMatch && request.method === 'POST') {
    return addCORS(await handleGenerateScreenshot(ctx, screenshotMatch[1]));
  }

  const analyticsMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/analytics$/);
  if (analyticsMatch && request.method === 'GET') {
    return addCORS(await handleArtifactAnalytics(ctx, analyticsMatch[1]));
  }

  const presenceMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/presence$/);
  if (presenceMatch && request.method === 'GET') {
    return addCORS(await handleArtifactPresence(ctx, presenceMatch[1]));
  }

  const testsRunMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/tests\/run$/);
  if (testsRunMatch && request.method === 'POST') {
    return addCORS(await handleRunTests(ctx, testsRunMatch[1]));
  }

  const testsMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/tests$/);
  if (testsMatch) {
    if (request.method === 'GET') return addCORS(await handleGetTests(ctx, testsMatch[1]));
    if (request.method === 'PUT' || request.method === 'POST') {
      return addCORS(await handleConfigureTests(ctx, testsMatch[1]));
    }
  }

  const editorApiMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/editor(\/.*)?$/);
  if (editorApiMatch) {
    const [, artifactId, editorPath] = editorApiMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;

    const access = await resolveArtifactEditorAccess(env, artifactId, user);
    if (!access.ok) return addCORS(access.response);

    const subPath = editorPath?.replace(/^\//, '') || '';
    if (isVisualEditorRoute(subPath)) {
      const disabled = await requireVisualEditorEnabled(env, access.artifact.workspace_id, user.email);
      if (disabled) return addCORS(disabled);
    }

    access.editorContext.waitUntil = ctx.executionCtx?.waitUntil?.bind(ctx.executionCtx);
    return addCORS(await handleEditor(request, access.editorContext, editorPath || ''));
  }

  const artifactEmailMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/email$/);
  if (artifactEmailMatch) {
    const [, artifactId] = artifactEmailMatch;
    const user = await requireToken(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'POST') {
      return addCORS(await handleCreateArtifactEmail(request, env, user, artifactId));
    }
    if (request.method === 'GET') {
      return addCORS(await handleGetArtifactEmail(env, user, artifactId));
    }
  }

  return null;
}

type ArtifactAuthRow = { owner_id: string | null; workspace_id: string | null };

async function loadArtifactForAuth(env: Env, artifactId: string): Promise<ArtifactAuthRow | null> {
  return env.DB.prepare(
    'SELECT owner_id, workspace_id FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<ArtifactAuthRow>();
}

async function canWriteArtifact(env: Env, artifactId: string, user: AuthUser, artifact: ArtifactAuthRow): Promise<boolean> {
  if (artifact.owner_id === user.id) return true;
  const collab = await env.DB.prepare(
    'SELECT role FROM collaborators WHERE artifact_id = ? AND email = ?'
  ).bind(artifactId, user.email).first<{ role: string }>();
  return !!collab && (collab.role === 'owner' || collab.role === 'editor');
}

async function canReadArtifact(env: Env, artifactId: string, user: AuthUser, artifact: ArtifactAuthRow): Promise<boolean> {
  if (artifact.owner_id === user.id) return true;
  if (artifact.workspace_id && (await getInternalWorkspaceRole(env, artifact.workspace_id, user.id))) return true;
  const collab = await env.DB.prepare(
    'SELECT role FROM collaborators WHERE artifact_id = ? AND email = ?'
  ).bind(artifactId, user.email).first<{ role: string }>();
  if (collab) return true;
  // External-sharing spine (work/030): an external identity with a view grant
  // (e.g. a scoped sot_ token) may read this artifact's metadata.
  return canAccess(env, { userIds: [user.id], emails: user.email ? [user.email] : [] }, 'artifact', artifactId, 'view');
}

async function handleUploadThumbnail(ctx: FetchContext, artifactId: string): Promise<Response> {
  const { request, env } = ctx;
  const user = await requireAuthUser(ctx);
  if (!isAuthUser(user)) return user;

  const artifact = await loadArtifactForAuth(env, artifactId);

  if (!artifact) {
    return jsonError('Not found', 'NOT_FOUND', 404);
  }

  if (!(await canWriteArtifact(env, artifactId, user, artifact))) {
    return jsonError('Forbidden', 'FORBIDDEN', 403);
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.startsWith('image/')) {
    return jsonError('Invalid content type', 'INVALID_CONTENT_TYPE', 400);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > 500 * 1024) {
    return jsonError('Thumbnail too large (max 500KB)', 'TOO_LARGE', 400);
  }

  const ext = contentType.includes('webp') ? 'webp' : contentType.includes('png') ? 'png' : 'jpg';
  await env.ARTIFACTS.put(`thumbnails/${artifactId}.${ext}`, body, {
    httpMetadata: { contentType, cacheControl: 'public, max-age=86400' },
  });

  await setPresentation(env, artifactId, {
    thumbnail_ext: ext,
    thumbnail_generated_at: new Date().toISOString(),
  });

  return jsonResponse({
    success: true,
    thumbnail_url: `/t/${artifactId}.${ext}`,
  });
}

async function handleGenerateScreenshot(ctx: FetchContext, artifactId: string): Promise<Response> {
  const { env } = ctx;
  const user = await requireAuthUser(ctx);
  if (!isAuthUser(user)) return user;

  const artifact = await loadArtifactForAuth(env, artifactId);

  if (!artifact) {
    return jsonError('Not found', 'NOT_FOUND', 404);
  }

  if (!(await canWriteArtifact(env, artifactId, user, artifact))) {
    return jsonError('Forbidden', 'FORBIDDEN', 403);
  }

  if (!env.BROWSER) {
    return jsonError('Preview generation is not available', 'NO_BROWSER', 503);
  }

  const ok = await generateArtifactThumbnail(env, artifactId);
  if (!ok) {
    return jsonError('Could not generate preview', 'SCREENSHOT_FAILED', 502);
  }

  return jsonResponse({
    success: true,
    thumbnail_url: `/t/${artifactId}.webp?v=${Date.now()}`,
  });
}

async function handleArtifactAnalytics(ctx: FetchContext, artifactId: string): Promise<Response> {
  const { env, url } = ctx;
  const user = await requireTokenOrSession(ctx);
  if (!isAuthUser(user)) return user;

  const artifact = await loadArtifactForAuth(env, artifactId);

  if (!artifact) {
    return jsonError('Not found', 'NOT_FOUND', 404);
  }

  if (!(await canReadArtifact(env, artifactId, user, artifact))) {
    return jsonError('Access denied', 'FORBIDDEN', 403);
  }

  const days = parseInt(url.searchParams.get('days') || '7', 10);
  const analytics = await getAnalytics(env, artifactId, Math.min(days, 30));
  return jsonResponse(analytics);
}

// Live concurrent-viewer count from the artifact's PresenceCoordinator DO. Same
// owner/collaborator gate as analytics — the count is owner-facing, not public.
async function handleArtifactPresence(ctx: FetchContext, artifactId: string): Promise<Response> {
  const { env } = ctx;
  const user = await requireTokenOrSession(ctx);
  if (!isAuthUser(user)) return user;

  const artifact = await loadArtifactForAuth(env, artifactId);
  if (!artifact) {
    return jsonError('Not found', 'NOT_FOUND', 404);
  }
  if (!(await canReadArtifact(env, artifactId, user, artifact))) {
    return jsonError('Access denied', 'FORBIDDEN', 403);
  }

  let count = 0;
  try {
    const stub = env.PRESENCE.get(env.PRESENCE.idFromName(artifactId));
    const res = await stub.fetch('https://presence/count');
    if (res.ok) count = ((await res.json()) as { count?: number }).count || 0;
  } catch {
    // DO unreachable — report zero rather than failing the panel.
  }
  return jsonResponse({ count });
}
