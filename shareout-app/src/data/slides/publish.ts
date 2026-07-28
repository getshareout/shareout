import { errorResponse, successResponse, verifyOwner, type DataContext } from '../middleware';
import { normalizeVisibility } from '../../visibility-config';

export async function handlePublishRoutes(
  request: Request,
  ctx: DataContext,
  presId: string,
  parts: string[]
): Promise<Response> {
  const action = parts[0];

  if (!action || action === 'status') {
    const pres = await ctx.env.DB.prepare(`SELECT visibility, published_artifact_id FROM presentations WHERE id = ?`)
      .bind(presId)
      .first<{ visibility: string; published_artifact_id: string | null }>();

    if (!pres) {
      return errorResponse({ code: 'PRESENTATION_NOT_FOUND', message: 'Presentation not found', status: 404 });
    }

    return successResponse({
      visibility: pres.visibility,
      publishedArtifactId: pres.published_artifact_id,
      publishedUrl: `${ctx.env.SHAREOUT_BASE_URL}/p/${ctx.artifact.name}`,
    });
  }

  if (action === 'visibility') {
    if (request.method !== 'PUT') {
      return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
    }

    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) {
      return errorResponse({ code: 'FORBIDDEN', message: 'Only owner can change visibility', status: 403 });
    }

    let body: { visibility: 'public' | 'private' };
    try {
      body = await request.json();
    } catch {
      return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
    }

    // Accept legacy 'unlisted' and fold it into 'public' (retired 2026-07).
    const requested = normalizeVisibility(body.visibility);
    if (!['public', 'private'].includes(requested)) {
      return errorResponse({ code: 'INVALID_VISIBILITY', message: 'Invalid visibility value', status: 400 });
    }

    await ctx.env.DB.prepare(`UPDATE presentations SET visibility = ?, updated_at = ? WHERE id = ?`)
      .bind(requested, new Date().toISOString(), presId)
      .run();

    return successResponse({ visibility: requested });
  }

  if (action === 'unpublish') {
    if (request.method !== 'POST') {
      return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
    }

    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) {
      return errorResponse({ code: 'FORBIDDEN', message: 'Only owner can unpublish', status: 403 });
    }

    await ctx.env.DB.prepare(`UPDATE presentations SET visibility = 'private', updated_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), presId)
      .run();

    return successResponse({ unpublished: true });
  }

  if (action === 'republish') {
    if (request.method !== 'POST') {
      return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
    }

    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) {
      return errorResponse({ code: 'FORBIDDEN', message: 'Only owner can republish', status: 403 });
    }

    await ctx.env.DB.prepare(`UPDATE presentations SET visibility = 'public', updated_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), presId)
      .run();

    return successResponse({ republished: true });
  }

  return errorResponse({ code: 'NOT_FOUND', message: 'Publish action not found', status: 404 });
}

