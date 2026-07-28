import { generateId } from '../../crypto-utils';
import { errorResponse, successResponse, verifyOwner, type DataContext } from '../middleware';
import { canEditPresentation, canEditSlide, getSession } from './auth';
import type { DbSlide } from './db';
import { mapSlide } from './db';
import { broadcastEvent } from './realtime';
import { MAX_CONTENT_LENGTH, MAX_SLIDES_PER_PRESENTATION, SLIDE_ID_PATTERN } from './constants';
import { handleSlideAiRoute } from './slide-ai';

export async function handleSlidesRoutes(
  request: Request,
  ctx: DataContext,
  presId: string,
  parts: string[]
): Promise<Response> {
  const slideIdOrAction = parts[0];

  if (!slideIdOrAction) {
    switch (request.method) {
      case 'GET':
        return listSlides(ctx, presId);
      case 'POST':
        return addSlide(request, ctx, presId);
      default:
        return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
    }
  }

  if (slideIdOrAction === 'reorder') {
    return reorderSlides(request, ctx, presId);
  }

  if (slideIdOrAction === 'batch') {
    return batchSlides(request, ctx, presId);
  }

  if (!SLIDE_ID_PATTERN.test(slideIdOrAction)) {
    return errorResponse({ code: 'INVALID_ID', message: 'Invalid slide ID', status: 400 });
  }

  const slideId = slideIdOrAction;
  const action = parts[1];

  if (action === 'notes') {
    return handleNotesRoutes(request, ctx, presId, slideId);
  }

  if (action === 'duplicate') {
    return duplicateSlide(request, ctx, presId, slideId);
  }

  if (action === 'lock') {
    return lockSlide(request, ctx, presId, slideId);
  }

  if (action === 'unlock') {
    return unlockSlide(request, ctx, presId, slideId);
  }

  if (action === 'owner') {
    return setSlideOwner(request, ctx, presId, slideId);
  }

  if (action === 'ai') {
    return handleSlideAiRoute(request, ctx, presId, slideId);
  }

  switch (request.method) {
    case 'GET':
      return getSlide(ctx, presId, slideId);
    case 'PATCH':
      return updateSlide(request, ctx, presId, slideId);
    case 'DELETE':
      return deleteSlide(request, ctx, presId, slideId);
    default:
      return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }
}

async function listSlides(ctx: DataContext, presId: string): Promise<Response> {
  const pres = await ctx.env.DB.prepare(`SELECT id FROM presentations WHERE artifact_id = ? AND id = ?`)
    .bind(ctx.artifactId, presId)
    .first();

  if (!pres) {
    return errorResponse({ code: 'PRESENTATION_NOT_FOUND', message: 'Presentation not found', status: 404 });
  }

  const result = await ctx.env.DB.prepare(`SELECT * FROM slides WHERE presentation_id = ? ORDER BY position ASC`)
    .bind(presId)
    .all<DbSlide>();

  const slides = result.results.map(mapSlide);
  return successResponse({ slides, count: slides.length });
}

async function addSlide(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  const canEdit = await canEditPresentation(request, ctx, presId);
  if (!canEdit) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Cannot edit this presentation', status: 403 });
  }

  const count = await ctx.env.DB.prepare(`SELECT COUNT(*) as cnt FROM slides WHERE presentation_id = ?`)
    .bind(presId)
    .first<{ cnt: number }>();

  if (count && count.cnt >= MAX_SLIDES_PER_PRESENTATION) {
    return errorResponse({
      code: 'LIMIT_EXCEEDED',
      message: `Maximum ${MAX_SLIDES_PER_PRESENTATION} slides per presentation`,
      status: 400,
    });
  }

  let body: Partial<{
    position: number;
    content: string;
    afterSlideId: string;
  }>;

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const session = await getSession(request, ctx);
  const id = generateId('slide');
  const now = new Date().toISOString();

  let position = body.position;

  if (body.afterSlideId) {
    const afterSlide = await ctx.env.DB.prepare(`SELECT position FROM slides WHERE presentation_id = ? AND id = ?`)
      .bind(presId, body.afterSlideId)
      .first<{ position: number }>();

    if (afterSlide) {
      position = afterSlide.position + 1;
      await ctx.env.DB.prepare(`UPDATE slides SET position = position + 1 WHERE presentation_id = ? AND position >= ?`)
        .bind(presId, position)
        .run();
    }
  }

  if (position === undefined) {
    const maxPos = await ctx.env.DB.prepare(`SELECT MAX(position) as max FROM slides WHERE presentation_id = ?`)
      .bind(presId)
      .first<{ max: number | null }>();
    position = (maxPos?.max ?? -1) + 1;
  }

  await ctx.env.DB.prepare(
    `INSERT INTO slides (id, presentation_id, position, owner_id, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, presId, position, session?.userId || null, body.content || '', now, now)
    .run();

  await ctx.env.DB.prepare(`UPDATE presentations SET updated_at = ? WHERE id = ?`).bind(now, presId).run();

  const slide = await ctx.env.DB.prepare(`SELECT * FROM slides WHERE id = ?`).bind(id).first<DbSlide>();

  await broadcastEvent(ctx, presId, { type: 'slide:added', data: mapSlide(slide!) });

  return successResponse(mapSlide(slide!), 201);
}

async function getSlide(ctx: DataContext, presId: string, slideId: string): Promise<Response> {
  const slide = await ctx.env.DB.prepare(
    `SELECT s.* FROM slides s
     JOIN presentations p ON s.presentation_id = p.id
     WHERE p.artifact_id = ? AND s.presentation_id = ? AND s.id = ?`
  )
    .bind(ctx.artifactId, presId, slideId)
    .first<DbSlide>();

  if (!slide) {
    return errorResponse({ code: 'SLIDE_NOT_FOUND', message: 'Slide not found', status: 404 });
  }

  const notes = await ctx.env.DB.prepare(`SELECT content FROM slide_notes WHERE slide_id = ?`)
    .bind(slideId)
    .first<{ content: string }>();

  return successResponse({
    ...mapSlide(slide),
    notes: notes?.content || '',
  });
}

async function updateSlide(request: Request, ctx: DataContext, presId: string, slideId: string): Promise<Response> {
  const slide = await ctx.env.DB.prepare(
    `SELECT s.* FROM slides s
     JOIN presentations p ON s.presentation_id = p.id
     WHERE p.artifact_id = ? AND s.presentation_id = ? AND s.id = ?`
  )
    .bind(ctx.artifactId, presId, slideId)
    .first<DbSlide>();

  if (!slide) {
    return errorResponse({ code: 'SLIDE_NOT_FOUND', message: 'Slide not found', status: 404 });
  }

  const canEdit = await canEditSlide(request, ctx, presId, slide);
  if (!canEdit) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Cannot edit this slide', status: 403 });
  }

  let body: Partial<{
    content: string;
    hidden: boolean;
    overrideBackground: string | null;
    overrideFonts: { heading?: string; body?: string; mono?: string } | null;
    overrideTransition: { type?: string; duration?: number } | null;
  }>;

  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (body.content !== undefined) {
    if (body.content.length > MAX_CONTENT_LENGTH) {
      return errorResponse({
        code: 'CONTENT_TOO_LARGE',
        message: `Content exceeds ${MAX_CONTENT_LENGTH} characters`,
        status: 400,
      });
    }
    updates.push('content = ?');
    params.push(body.content);
  }
  if (body.hidden !== undefined) {
    updates.push('hidden = ?');
    params.push(body.hidden ? 1 : 0);
  }
  if (body.overrideBackground !== undefined) {
    updates.push('override_background = ?');
    params.push(body.overrideBackground);
  }
  if (body.overrideFonts !== undefined) {
    updates.push('override_fonts = ?');
    params.push(body.overrideFonts ? JSON.stringify(body.overrideFonts) : null);
  }
  if (body.overrideTransition !== undefined) {
    updates.push('override_transition = ?');
    params.push(body.overrideTransition ? JSON.stringify(body.overrideTransition) : null);
  }

  if (updates.length === 0) {
    return errorResponse({ code: 'NO_UPDATES', message: 'No valid fields to update', status: 400 });
  }

  const now = new Date().toISOString();
  updates.push('updated_at = ?');
  params.push(now);
  params.push(slideId);

  await ctx.env.DB.prepare(`UPDATE slides SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();

  await ctx.env.DB.prepare(`UPDATE presentations SET updated_at = ? WHERE id = ?`).bind(now, presId).run();

  const updated = await ctx.env.DB.prepare(`SELECT * FROM slides WHERE id = ?`).bind(slideId).first<DbSlide>();

  await broadcastEvent(ctx, presId, { type: 'slide:updated', data: mapSlide(updated!) });

  return successResponse(mapSlide(updated!));
}

async function deleteSlide(request: Request, ctx: DataContext, presId: string, slideId: string): Promise<Response> {
  const slide = await ctx.env.DB.prepare(
    `SELECT s.* FROM slides s
     JOIN presentations p ON s.presentation_id = p.id
     WHERE p.artifact_id = ? AND s.presentation_id = ? AND s.id = ?`
  )
    .bind(ctx.artifactId, presId, slideId)
    .first<DbSlide>();

  if (!slide) {
    return errorResponse({ code: 'SLIDE_NOT_FOUND', message: 'Slide not found', status: 404 });
  }

  const canEdit = await canEditSlide(request, ctx, presId, slide);
  if (!canEdit) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Cannot delete this slide', status: 403 });
  }

  const count = await ctx.env.DB.prepare(`SELECT COUNT(*) as cnt FROM slides WHERE presentation_id = ?`)
    .bind(presId)
    .first<{ cnt: number }>();

  if (count && count.cnt <= 1) {
    return errorResponse({ code: 'CANNOT_DELETE_LAST', message: 'Cannot delete the last slide', status: 400 });
  }

  await ctx.env.DB.prepare(`DELETE FROM slides WHERE id = ?`).bind(slideId).run();

  await ctx.env.DB.prepare(`UPDATE slides SET position = position - 1 WHERE presentation_id = ? AND position > ?`)
    .bind(presId, slide.position)
    .run();

  await ctx.env.DB.prepare(`UPDATE presentations SET updated_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), presId)
    .run();

  await broadcastEvent(ctx, presId, { type: 'slide:deleted', data: { id: slideId } });

  return successResponse({ deleted: true });
}

async function reorderSlides(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  const canEdit = await canEditPresentation(request, ctx, presId);
  if (!canEdit) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Cannot edit this presentation', status: 403 });
  }

  let body: { slideIds: string[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  if (!Array.isArray(body.slideIds)) {
    return errorResponse({ code: 'INVALID_REQUEST', message: 'slideIds array required', status: 400 });
  }

  const batch = body.slideIds.map((id, idx) =>
    ctx.env.DB.prepare(`UPDATE slides SET position = ? WHERE presentation_id = ? AND id = ?`).bind(idx, presId, id)
  );

  await ctx.env.DB.batch(batch);

  await ctx.env.DB.prepare(`UPDATE presentations SET updated_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), presId)
    .run();

  await broadcastEvent(ctx, presId, { type: 'slide:reordered', data: { slideIds: body.slideIds } });

  return successResponse({ reordered: true });
}

async function batchSlides(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  const canEdit = await canEditPresentation(request, ctx, presId);
  if (!canEdit) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Cannot edit this presentation', status: 403 });
  }

  let body: { slides?: { content?: string; hidden?: boolean; notes?: string }[]; replace?: boolean };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  if (!Array.isArray(body.slides) || body.slides.length === 0) {
    return errorResponse({ code: 'INVALID_REQUEST', message: 'slides array required', status: 400 });
  }

  for (const s of body.slides) {
    if (s.content && s.content.length > MAX_CONTENT_LENGTH) {
      return errorResponse({
        code: 'CONTENT_TOO_LARGE',
        message: `Content exceeds ${MAX_CONTENT_LENGTH} characters`,
        status: 400,
      });
    }
  }

  const existing = await ctx.env.DB.prepare(`SELECT COUNT(*) as cnt FROM slides WHERE presentation_id = ?`)
    .bind(presId)
    .first<{ cnt: number }>();
  const existingCount = existing?.cnt ?? 0;
  const resultCount = body.replace ? body.slides.length : existingCount + body.slides.length;

  if (resultCount > MAX_SLIDES_PER_PRESENTATION) {
    return errorResponse({
      code: 'LIMIT_EXCEEDED',
      message: `Maximum ${MAX_SLIDES_PER_PRESENTATION} slides per presentation`,
      status: 400,
    });
  }

  const session = await getSession(request, ctx);
  const now = new Date().toISOString();

  let startPosition = 0;
  if (!body.replace) {
    const maxPos = await ctx.env.DB.prepare(`SELECT MAX(position) as max FROM slides WHERE presentation_id = ?`)
      .bind(presId)
      .first<{ max: number | null }>();
    startPosition = (maxPos?.max ?? -1) + 1;
  }

  const statements = [];

  if (body.replace) {
    statements.push(ctx.env.DB.prepare(`DELETE FROM slides WHERE presentation_id = ?`).bind(presId));
  }

  const newIds: string[] = [];
  body.slides.forEach((s, idx) => {
    const id = generateId('slide');
    newIds.push(id);
    statements.push(
      ctx.env.DB.prepare(
        `INSERT INTO slides (id, presentation_id, position, owner_id, content, hidden, locked, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).bind(id, presId, startPosition + idx, session?.userId || null, s.content || '', s.hidden ? 1 : 0, now, now)
    );
    if (s.notes) {
      statements.push(
        ctx.env.DB.prepare(
          `INSERT INTO slide_notes (id, slide_id, content, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(slide_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
        ).bind(generateId('note'), id, s.notes, now)
      );
    }
  });

  statements.push(ctx.env.DB.prepare(`UPDATE presentations SET updated_at = ? WHERE id = ?`).bind(now, presId));

  await ctx.env.DB.batch(statements);

  const result = await ctx.env.DB.prepare(`SELECT * FROM slides WHERE presentation_id = ? ORDER BY position ASC`)
    .bind(presId)
    .all<DbSlide>();
  const slides = result.results.map(mapSlide);

  await broadcastEvent(ctx, presId, { type: 'slide:reordered', data: { slideIds: slides.map((s) => s.id) } });

  return successResponse({ slides, count: slides.length, created: newIds.length }, 201);
}

async function duplicateSlide(request: Request, ctx: DataContext, presId: string, slideId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  const canEdit = await canEditPresentation(request, ctx, presId);
  if (!canEdit) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Cannot edit this presentation', status: 403 });
  }

  const slide = await ctx.env.DB.prepare(`SELECT * FROM slides WHERE presentation_id = ? AND id = ?`)
    .bind(presId, slideId)
    .first<DbSlide>();

  if (!slide) {
    return errorResponse({ code: 'SLIDE_NOT_FOUND', message: 'Slide not found', status: 404 });
  }

  await ctx.env.DB.prepare(`UPDATE slides SET position = position + 1 WHERE presentation_id = ? AND position > ?`)
    .bind(presId, slide.position)
    .run();

  const newId = generateId('slide');
  const now = new Date().toISOString();
  const session = await getSession(request, ctx);

  await ctx.env.DB.prepare(
    `INSERT INTO slides (id, presentation_id, position, owner_id, override_background, override_fonts, override_transition, content, hidden, locked, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(
      newId,
      presId,
      slide.position + 1,
      session?.userId || null,
      slide.override_background,
      slide.override_fonts,
      slide.override_transition,
      slide.content,
      slide.hidden,
      now,
      now
    )
    .run();

  const newSlide = await ctx.env.DB.prepare(`SELECT * FROM slides WHERE id = ?`).bind(newId).first<DbSlide>();

  await broadcastEvent(ctx, presId, { type: 'slide:added', data: mapSlide(newSlide!) });

  return successResponse(mapSlide(newSlide!), 201);
}

async function lockSlide(request: Request, ctx: DataContext, presId: string, slideId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  const isOwner = await verifyOwner(request, ctx);
  const slide = await ctx.env.DB.prepare(`SELECT * FROM slides WHERE presentation_id = ? AND id = ?`)
    .bind(presId, slideId)
    .first<DbSlide>();

  if (!slide) {
    return errorResponse({ code: 'SLIDE_NOT_FOUND', message: 'Slide not found', status: 404 });
  }

  const session = await getSession(request, ctx);
  const isSlideOwner = session && slide.owner_id === session.userId;

  if (!isOwner && !isSlideOwner) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only presentation or slide owner can lock', status: 403 });
  }

  await ctx.env.DB.prepare(`UPDATE slides SET locked = 1, updated_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), slideId)
    .run();

  return successResponse({ locked: true });
}

async function unlockSlide(request: Request, ctx: DataContext, presId: string, slideId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  const isOwner = await verifyOwner(request, ctx);
  const slide = await ctx.env.DB.prepare(`SELECT * FROM slides WHERE presentation_id = ? AND id = ?`)
    .bind(presId, slideId)
    .first<DbSlide>();

  if (!slide) {
    return errorResponse({ code: 'SLIDE_NOT_FOUND', message: 'Slide not found', status: 404 });
  }

  const session = await getSession(request, ctx);
  const isSlideOwner = session && slide.owner_id === session.userId;

  if (!isOwner && !isSlideOwner) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only presentation or slide owner can unlock', status: 403 });
  }

  await ctx.env.DB.prepare(`UPDATE slides SET locked = 0, updated_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), slideId)
    .run();

  return successResponse({ locked: false });
}

async function setSlideOwner(request: Request, ctx: DataContext, presId: string, slideId: string): Promise<Response> {
  if (request.method !== 'PUT') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  const isOwner = await verifyOwner(request, ctx);
  if (!isOwner) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only presentation owner can set slide owner', status: 403 });
  }

  const slide = await ctx.env.DB.prepare(`SELECT * FROM slides WHERE presentation_id = ? AND id = ?`)
    .bind(presId, slideId)
    .first<DbSlide>();

  if (!slide) {
    return errorResponse({ code: 'SLIDE_NOT_FOUND', message: 'Slide not found', status: 404 });
  }

  let body: { userId: string | null };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  await ctx.env.DB.prepare(`UPDATE slides SET owner_id = ?, updated_at = ? WHERE id = ?`)
    .bind(body.userId, new Date().toISOString(), slideId)
    .run();

  await broadcastEvent(ctx, presId, { type: 'slide:updated', data: { id: slideId, ownerId: body.userId } });

  return successResponse({ ownerId: body.userId });
}

async function handleNotesRoutes(
  request: Request,
  ctx: DataContext,
  presId: string,
  slideId: string
): Promise<Response> {
  const canEdit = await canEditPresentation(request, ctx, presId);

  switch (request.method) {
    case 'GET': {
      const notes = await ctx.env.DB.prepare(`SELECT content FROM slide_notes WHERE slide_id = ?`)
        .bind(slideId)
        .first<{ content: string }>();
      return successResponse({ notes: notes?.content || '' });
    }

    case 'PUT': {
      if (!canEdit) {
        return errorResponse({ code: 'FORBIDDEN', message: 'Cannot edit notes', status: 403 });
      }

      let body: { content: string };
      try {
        body = await request.json();
      } catch {
        return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
      }

      const id = generateId('note');
      await ctx.env.DB.prepare(
        `INSERT INTO slide_notes (id, slide_id, content, updated_at)
         VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(slide_id) DO UPDATE SET content = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
      )
        .bind(id, slideId, body.content || '', body.content || '')
        .run();

      return successResponse({ notes: body.content || '' });
    }

    default:
      return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }
}

