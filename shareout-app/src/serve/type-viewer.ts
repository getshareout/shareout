import type { Env, TypeMetadata } from '../types';
import { trackPageView } from '../analytics';
import { trackViewerView } from '../view-tracking';
import { hasCustomViewer, renderViewer, viewerScriptCsp } from '../viewers';
import type { ViewerSource } from '../viewers/viewer-shell';
import { generateTypeMetadata } from '../validation';
import { loadSkillViewerMetrics } from '../skill-marketplace';
import { loadLibraryViewerMetrics } from '../workspace-library';
import { getSessionUser } from '../auth/session';
import type { ArtifactInfo } from './types';
import { detectAdminStatus, detectFavoriteState } from './prefetch';
import { getSecurityHeaders } from './security';
import { notFound, runBackground, NOINDEX_ROBOTS } from './utils';
import type { SocialPreview } from './social-meta';
import { normalizeVisibility } from '../visibility-config';
import { localeForViewer } from '../i18n/locale';
import { servingOrigin } from '../workspaces/domains/host-binding';

/** A PDF original can be shown inline (?show=original); other originals only download. */
function pdfTabs(href: string, original: string): ViewerSource['pdfTabs'] {
  if (!/\.pdf$/i.test(original)) return undefined;
  const q = new URL(href).searchParams;
  const showOriginal = q.get('show') === 'original';
  q.delete('show');
  const text = q.toString();
  q.set('show', 'original');
  return { showOriginal, textHref: '?' + text, originalHref: '?' + q.toString() };
}

export async function serveTypeViewer(
  request: Request,
  env: Env,
  artifact: ArtifactInfo,
  asset: { r2_key: string; mime: string; size_bytes: number },
  slug: string,
  socialPreview: SocialPreview,
  executionCtx?: ExecutionContext,
): Promise<Response> {
  const baseUrl = servingOrigin(env);

  // Parse type metadata
  let typeMetadata: TypeMetadata = {};
  if (artifact.type_metadata) {
    try {
      typeMetadata = JSON.parse(artifact.type_metadata);
    } catch {
      // Invalid metadata, use empty
    }
  }

  // Imported workbook: ?sheet=N shows another sheet's CSV (its own column metadata).
  const imported = typeMetadata.source;
  const sheetNo = Number(new URL(request.url).searchParams.get('sheet')) || 1;
  const sheet = imported?.sheets && sheetNo > 1 ? imported.sheets[sheetNo - 1] : undefined;
  let file = asset;
  if (sheet) {
    const row = await env.DB.prepare('SELECT r2_key, mime, size_bytes FROM assets WHERE version_id = ? AND path = ?')
      .bind(artifact.version_id, sheet.path).first<{ r2_key: string; mime: string; size_bytes: number }>();
    if (row) file = row;
  }

  // Fetch the raw content
  const obj = await env.ARTIFACTS.get(file.r2_key);
  if (!obj) {
    return notFound();
  }

  const content = await obj.text();
  if (file !== asset) typeMetadata = { ...typeMetadata, ...generateTypeMetadata(artifact.artifact_type, content, file.mime) };
  const source: ViewerSource | undefined = imported?.original
    ? { original: imported.original, sheets: imported.sheets?.map((x) => x.name), activeSheet: file !== asset ? sheetNo - 1 : 0, pdfTabs: pdfTabs(request.url, imported.original) }
    : undefined;

  // Resolve the session once, then check admin + favorite state.
  const sessionUser = await getSessionUser(request, env);
  const [adminInfo, favInfo, locale] = await Promise.all([
    detectAdminStatus(sessionUser, env, artifact.artifact_id, artifact.owner_id),
    detectFavoriteState(sessionUser, env, artifact.artifact_id),
    localeForViewer(env, { workspaceId: artifact.workspace_id, request }),
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
  const nonce = crypto.randomUUID().replace(/-/g, '');
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
    locale,
    nonce,
    source,
  );

  if (!html) {
    // Fallback to serving raw asset if no viewer available
    const open = normalizeVisibility(artifact.visibility) === 'public';
    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': asset.mime,
        'Cache-Control': open ? 'public, max-age=0, must-revalidate' : 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  // Track page view (registered with waitUntil so it isn't cancelled at response end)
  runBackground(executionCtx, trackPageView(env, request, artifact.artifact_id, artifact.entrypoint));
  if (sessionUser) {
    runBackground(executionCtx, trackViewerView(env, artifact.artifact_id, sessionUser.email, artifact.entrypoint, sessionUser.id === artifact.owner_id));
  }

  const isOpen = normalizeVisibility(artifact.visibility) === 'public';
  const securityHeaders = getSecurityHeaders(false, env);
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': isOpen ? 'public, max-age=0, must-revalidate' : 'private, no-store',
      ...securityHeaders,
      'Content-Security-Policy': `${securityHeaders['Content-Security-Policy']}; ${viewerScriptCsp(nonce)}`,
      ...(!isOpen ? { 'X-Robots-Tag': NOINDEX_ROBOTS } : {}),
    },
  });
}