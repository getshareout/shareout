import { generateId } from '../../crypto-utils';
import { errorResponse, successResponse, verifyOwner, type DataContext } from '../middleware';
import { normalizeVisibility } from '../../visibility-config';
import { broadcastEvent } from './realtime';
import type { DbPresentation, DbSlide } from './db';
import { mapPresentation, mapSlide } from './db';
import { getSession } from './auth';

export async function listPresentations(ctx: DataContext): Promise<Response> {
  const result = await ctx.env.DB.prepare(
    `SELECT * FROM presentations WHERE artifact_id = ? ORDER BY updated_at DESC`
  )
    .bind(ctx.artifactId)
    .all<DbPresentation>();

  const presentations = result.results.map(mapPresentation);
  return successResponse({ presentations, count: presentations.length });
}

export async function createPresentation(request: Request, ctx: DataContext): Promise<Response> {
  const isOwner = await verifyOwner(request, ctx);
  if (!isOwner) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only owner can create presentations', status: 403 });
  }

  let body: Partial<{
    title: string;
    description: string;
    width: number;
    height: number;
    aspectRatio: string;
    template: string;
    defaultFonts: { heading: string; body: string; mono: string };
    defaultColors: { background: string; text: string; accent: string };
    visibility: 'public' | 'private';
  }>;

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const session = await getSession(request, ctx);
  const id = generateId('pres');
  const now = new Date().toISOString();

  await ctx.env.DB.prepare(
    `INSERT INTO presentations (
      id, artifact_id, title, description, width, height, aspect_ratio,
      template, default_fonts, default_colors, visibility, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      ctx.artifactId,
      body.title || 'Untitled Presentation',
      body.description || null,
      body.width || 1920,
      body.height || 1080,
      body.aspectRatio || '16:9',
      body.template || null,
      JSON.stringify(body.defaultFonts || { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' }),
      JSON.stringify(body.defaultColors || { background: '#0f172a', text: '#f8fafc', accent: '#3b82f6' }),
      body.visibility || 'private',
      session?.userId || null,
      now,
      now
    )
    .run();

  const firstSlideId = generateId('slide');
  await ctx.env.DB.prepare(
    `INSERT INTO slides (id, presentation_id, position, content, created_at, updated_at)
     VALUES (?, ?, 0, '', ?, ?)`
  )
    .bind(firstSlideId, id, now, now)
    .run();

  const pres = await ctx.env.DB.prepare(`SELECT * FROM presentations WHERE id = ?`).bind(id).first<DbPresentation>();

  return successResponse(
    {
      ...mapPresentation(pres!),
      editorUrl: `${ctx.env.SHAREOUT_BASE_URL}/a/${ctx.artifact.name}`,
      publishedUrl: `${ctx.env.SHAREOUT_BASE_URL}/p/${ctx.artifact.name}`,
    },
    201
  );
}

export async function getPresentation(ctx: DataContext, presId: string): Promise<Response> {
  const pres = await ctx.env.DB.prepare(`SELECT * FROM presentations WHERE artifact_id = ? AND id = ?`)
    .bind(ctx.artifactId, presId)
    .first<DbPresentation>();

  if (!pres) {
    return errorResponse({ code: 'PRESENTATION_NOT_FOUND', message: 'Presentation not found', status: 404 });
  }

  const slidesResult = await ctx.env.DB.prepare(`SELECT * FROM slides WHERE presentation_id = ? ORDER BY position ASC`)
    .bind(presId)
    .all<DbSlide>();

  const slides = slidesResult.results.map(mapSlide);

  return successResponse({
    ...mapPresentation(pres),
    slides,
    editorUrl: `${ctx.env.SHAREOUT_BASE_URL}/a/${ctx.artifact.name}`,
    publishedUrl: `${ctx.env.SHAREOUT_BASE_URL}/p/${ctx.artifact.name}`,
  });
}

export async function updatePresentation(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  const isOwner = await verifyOwner(request, ctx);
  if (!isOwner) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only owner can update presentation', status: 403 });
  }

  const existing = await ctx.env.DB.prepare(`SELECT * FROM presentations WHERE artifact_id = ? AND id = ?`)
    .bind(ctx.artifactId, presId)
    .first<DbPresentation>();

  if (!existing) {
    return errorResponse({ code: 'PRESENTATION_NOT_FOUND', message: 'Presentation not found', status: 404 });
  }

  let body: Partial<{
    title: string;
    description: string;
    width: number;
    height: number;
    aspectRatio: string;
    template: string;
    defaultFonts: { heading: string; body: string; mono: string };
    defaultColors: { background: string; text: string; accent: string };
    defaultTransition: { type: string; duration: number };
    visibility: 'public' | 'private';
  }>;

  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (body.title !== undefined) {
    updates.push('title = ?');
    params.push(body.title);
  }
  if (body.description !== undefined) {
    updates.push('description = ?');
    params.push(body.description);
  }
  if (body.width !== undefined) {
    updates.push('width = ?');
    params.push(body.width);
  }
  if (body.height !== undefined) {
    updates.push('height = ?');
    params.push(body.height);
  }
  if (body.aspectRatio !== undefined) {
    updates.push('aspect_ratio = ?');
    params.push(body.aspectRatio);
  }
  if (body.template !== undefined) {
    updates.push('template = ?');
    params.push(body.template);
  }
  if (body.defaultFonts !== undefined) {
    updates.push('default_fonts = ?');
    params.push(JSON.stringify(body.defaultFonts));
  }
  if (body.defaultColors !== undefined) {
    updates.push('default_colors = ?');
    params.push(JSON.stringify(body.defaultColors));
  }
  if (body.defaultTransition !== undefined) {
    updates.push('default_transition = ?');
    params.push(JSON.stringify(body.defaultTransition));
  }
  if (body.visibility !== undefined) {
    // Accept legacy 'unlisted' and fold it into 'public' (retired 2026-07).
    const requested = normalizeVisibility(body.visibility);
    if (!['public', 'private'].includes(requested)) {
      return errorResponse({ code: 'INVALID_VISIBILITY', message: 'Invalid visibility value', status: 400 });
    }
    updates.push('visibility = ?');
    params.push(requested);
  }

  if (updates.length === 0) {
    return errorResponse({ code: 'NO_UPDATES', message: 'No valid fields to update', status: 400 });
  }

  updates.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(presId);

  await ctx.env.DB.prepare(`UPDATE presentations SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();

  const updated = await ctx.env.DB.prepare(`SELECT * FROM presentations WHERE id = ?`).bind(presId).first<DbPresentation>();

  await broadcastEvent(ctx, presId, { type: 'presentation:updated', data: mapPresentation(updated!) });

  return successResponse(mapPresentation(updated!));
}

export async function deletePresentation(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  const isOwner = await verifyOwner(request, ctx);
  if (!isOwner) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only owner can delete presentation', status: 403 });
  }

  const existing = await ctx.env.DB.prepare(`SELECT id FROM presentations WHERE artifact_id = ? AND id = ?`)
    .bind(ctx.artifactId, presId)
    .first();

  if (!existing) {
    return errorResponse({ code: 'PRESENTATION_NOT_FOUND', message: 'Presentation not found', status: 404 });
  }

  await ctx.env.DB.prepare(`DELETE FROM presentations WHERE id = ?`).bind(presId).run();

  return successResponse({ deleted: true });
}

