import type { Env, TypeMetadata } from '../types';
import { trackPageView } from '../analytics';
import { trackViewerView } from '../view-tracking';
import { hasCustomViewer, renderViewer } from '../viewers';
import { loadSkillViewerMetrics } from '../skill-marketplace';
import { loadLibraryViewerMetrics } from '../workspace-library';
import { getSessionUser } from '../auth';
import type { ArtifactInfo } from './types';
import { detectAdminStatus, detectFavoriteState } from './prefetch';
import { getSecurityHeaders } from './security';
import { notFound, runBackground, NOINDEX_ROBOTS } from './utils';
import type { SocialPreview } from './social-meta';
import { normalizeVisibility } from '../visibility-config';

export async function serveTypeViewer(
  request: Request,
  env: Env,
  artifact: ArtifactInfo,
  asset: { r2_key: string; mime: string; size_bytes: number },
  slug: string,
  socialPreview: SocialPreview,
  executionCtx?: ExecutionContext,
): Promise<Response> {
  const baseUrl = env.SHAREOUT_BASE_URL.replace(/\/$/, '');

  // Fetch the raw content
  const obj = await env.ARTIFACTS.get(asset.r2_key);
  if (!obj) {
    return notFound();
  }

  const content = await obj.text();

  // Parse type metadata
  let typeMetadata: TypeMetadata = {};
  if (artifact.type_metadata) {
    try {
      typeMetadata = JSON.parse(artifact.type_metadata);
    } catch {
      // Invalid metadata, use empty
    }
  }

  // Resolve the session once, then check admin + favorite state.
  const sessionUser = await getSessionUser(request, env);
  const [adminInfo, favInfo] = await Promise.all([
    detectAdminStatus(sessionUser, env, artifact.artifact_id, artifact.owner_id),
    detectFavoriteState(sessionUser, env, artifact.artifact_id),
  ]);
  const isAdmin = !!adminInfo;

  // Skill Marketplace: skills are persisted as 'markdown' (the artifact_type CHECK
  // can't be widened on D1) and flagged by a skill_marketplace row. When present,
  // upgrade the viewer to the skill viewer. Counts show for everyone; action buttons
  // are gated to workspace members (skillMetrics.canAct).
  // A markdown artifact may be flagged as a skill OR a library module by its sidecar
  // row; resolve at most one upgrade (skill takes precedence, mutually exclusive in
  // practice). Library viewer renders the README + import snippets.
  const skillMetrics = artifact.artifact_type === 'markdown'
    ? (await loadSkillViewerMetrics(env, artifact.artifact_id, sessionUser?.id ?? null)) ?? undefined
    : undefined;
  const libraryMetrics = !skillMetrics && artifact.artifact_type === 'markdown'
    ? (await loadLibraryViewerMetrics(env, artifact.artifact_id)) ?? undefined
    : undefined;
  const effectiveType = skillMetrics ? 'skill' : libraryMetrics ? 'library' : artifact.artifact_type;

  // Render the type-specific viewer
  const html = renderViewer(
    effectiveType,
    slug,
    artifact.artifact_name,
    typeMetadata,
    baseUrl,
    content,
    isAdmin,
    artifact.artifact_id,
    favInfo.loggedIn,
    favInfo.isFavorite,
    socialPreview,
    skillMetrics,
    libraryMetrics,
  );

  if (!html) {
    // Fallback to serving raw asset if no viewer available
    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': asset.mime,
        'Cache-Control': 'public, max-age=0, must-revalidate',
      },
    });
  }

  // Track page view (registered with waitUntil so it isn't cancelled at response end)
  runBackground(executionCtx, trackPageView(env, request, artifact.artifact_id, artifact.entrypoint));
  if (sessionUser) {
    runBackground(executionCtx, trackViewerView(env, artifact.artifact_id, sessionUser.email, artifact.entrypoint, sessionUser.id === artifact.owner_id));
  }

  const isOpen = normalizeVisibility(artifact.visibility) === 'public';
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': isOpen ? 'public, max-age=0, must-revalidate' : 'private, no-store',
      ...getSecurityHeaders(false, env),
      ...(!isOpen ? { 'X-Robots-Tag': NOINDEX_ROBOTS } : {}),
    },
  });
}