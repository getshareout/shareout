import { generateId } from '../../crypto-utils';
import { errorResponse, successResponse, verifyOwner, type DataContext } from '../middleware';
import { canEditPresentation, getSession } from './auth';
import type { DbSlide } from './db';
import { mapSlide } from './db';
import { AUTO_SAVE_LIMIT, MAX_VERSIONS_PER_PRESENTATION, VERSION_ID_PATTERN } from './constants';
import type { Slide, Version } from './types';

export async function handleVersionsRoutes(
  request: Request,
  ctx: DataContext,
  presId: string,
  parts: string[]
): Promise<Response> {
  const versionId = parts[0];

  if (!versionId) {
    switch (request.method) {
      case 'GET':
        return listVersions(ctx, presId);
      case 'POST':
        return createVersion(request, ctx, presId);
      default:
        return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
    }
  }

  if (versionId === 'diff') {
    return getVersionDiff(request, ctx, presId);
  }

  if (!VERSION_ID_PATTERN.test(versionId)) {
    return errorResponse({ code: 'INVALID_ID', message: 'Invalid version ID', status: 400 });
  }

  const action = parts[1];

  if (action === 'restore') {
    return restoreVersion(request, ctx, presId, versionId);
  }

  switch (request.method) {
    case 'GET':
      return getVersion(ctx, presId, versionId);
    case 'DELETE':
      return deleteVersion(request, ctx, presId, versionId);
    default:
      return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }
}

async function listVersions(ctx: DataContext, presId: string): Promise<Response> {
  const result = await ctx.env.DB.prepare(
    `SELECT id, presentation_id, name, description, slide_count, created_by_id, created_by_name, is_auto_save, created_at
     FROM presentation_versions
     WHERE presentation_id = ?
     ORDER BY created_at DESC`
  )
    .bind(presId)
    .all<{
      id: string;
      presentation_id: string;
      name: string;
      description: string | null;
      slide_count: number;
      created_by_id: string | null;
      created_by_name: string | null;
      is_auto_save: number;
      created_at: string;
    }>();

  const versions: Version[] = result.results.map((row) => ({
    id: row.id,
    presentationId: row.presentation_id,
    name: row.name,
    description: row.description,
    slideCount: row.slide_count,
    createdById: row.created_by_id,
    createdByName: row.created_by_name,
    isAutoSave: row.is_auto_save === 1,
    createdAt: row.created_at,
  }));

  return successResponse({ versions, count: versions.length });
}

async function createVersion(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  const canEdit = await canEditPresentation(request, ctx, presId);
  if (!canEdit) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Cannot create version', status: 403 });
  }

  let body: { name: string; description?: string; isAutoSave?: boolean };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  if (!body.name) {
    return errorResponse({ code: 'INVALID_REQUEST', message: 'Version name required', status: 400 });
  }

  const count = await ctx.env.DB.prepare(`SELECT COUNT(*) as cnt FROM presentation_versions WHERE presentation_id = ?`)
    .bind(presId)
    .first<{ cnt: number }>();

  if (count && count.cnt >= MAX_VERSIONS_PER_PRESENTATION) {
    const oldest = await ctx.env.DB.prepare(
      `SELECT id FROM presentation_versions WHERE presentation_id = ? AND is_auto_save = 1 ORDER BY created_at ASC LIMIT 1`
    )
      .bind(presId)
      .first<{ id: string }>();

    if (oldest) {
      await ctx.env.DB.prepare(`DELETE FROM presentation_versions WHERE id = ?`).bind(oldest.id).run();
    } else {
      return errorResponse({
        code: 'LIMIT_EXCEEDED',
        message: `Maximum ${MAX_VERSIONS_PER_PRESENTATION} versions`,
        status: 400,
      });
    }
  }

  const slidesResult = await ctx.env.DB.prepare(`SELECT * FROM slides WHERE presentation_id = ? ORDER BY position ASC`)
    .bind(presId)
    .all<DbSlide>();

  const notesResult = await ctx.env.DB.prepare(
    `SELECT slide_id, content FROM slide_notes WHERE slide_id IN (SELECT id FROM slides WHERE presentation_id = ?)`
  )
    .bind(presId)
    .all<{ slide_id: string; content: string }>();

  const notesMap = new Map(notesResult.results.map((n) => [n.slide_id, n.content]));

  const snapshot = slidesResult.results.map((s) => ({
    ...mapSlide(s),
    notes: notesMap.get(s.id) || '',
  }));

  const session = await getSession(request, ctx);
  const id = generateId('ver');

  await ctx.env.DB.prepare(
    `INSERT INTO presentation_versions (id, presentation_id, name, description, snapshot, slide_count, created_by_id, created_by_name, is_auto_save, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  )
    .bind(
      id,
      presId,
      body.name,
      body.description || null,
      JSON.stringify(snapshot),
      snapshot.length,
      session?.userId || null,
      session?.name || null,
      body.isAutoSave ? 1 : 0
    )
    .run();

  if (body.isAutoSave) {
    const autoSaveCount = await ctx.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM presentation_versions WHERE presentation_id = ? AND is_auto_save = 1`
    )
      .bind(presId)
      .first<{ cnt: number }>();

    if (autoSaveCount && autoSaveCount.cnt > AUTO_SAVE_LIMIT) {
      await ctx.env.DB.prepare(
        `DELETE FROM presentation_versions WHERE id IN (
          SELECT id FROM presentation_versions WHERE presentation_id = ? AND is_auto_save = 1
          ORDER BY created_at ASC LIMIT ?
        )`
      )
        .bind(presId, autoSaveCount.cnt - AUTO_SAVE_LIMIT)
        .run();
    }
  }

  const version = await ctx.env.DB.prepare(`SELECT * FROM presentation_versions WHERE id = ?`)
    .bind(id)
    .first<{
      id: string;
      presentation_id: string;
      name: string;
      description: string | null;
      slide_count: number;
      created_by_id: string | null;
      created_by_name: string | null;
      is_auto_save: number;
      created_at: string;
    }>();

  return successResponse(
    {
      id: version!.id,
      presentationId: version!.presentation_id,
      name: version!.name,
      description: version!.description,
      slideCount: version!.slide_count,
      createdById: version!.created_by_id,
      createdByName: version!.created_by_name,
      isAutoSave: version!.is_auto_save === 1,
      createdAt: version!.created_at,
    },
    201
  );
}

async function getVersion(ctx: DataContext, presId: string, versionId: string): Promise<Response> {
  const version = await ctx.env.DB.prepare(`SELECT * FROM presentation_versions WHERE presentation_id = ? AND id = ?`)
    .bind(presId, versionId)
    .first<{
      id: string;
      presentation_id: string;
      name: string;
      description: string | null;
      snapshot: string;
      slide_count: number;
      created_by_id: string | null;
      created_by_name: string | null;
      is_auto_save: number;
      created_at: string;
    }>();

  if (!version) {
    return errorResponse({ code: 'VERSION_NOT_FOUND', message: 'Version not found', status: 404 });
  }

  return successResponse({
    id: version.id,
    presentationId: version.presentation_id,
    name: version.name,
    description: version.description,
    slideCount: version.slide_count,
    createdById: version.created_by_id,
    createdByName: version.created_by_name,
    isAutoSave: version.is_auto_save === 1,
    createdAt: version.created_at,
    snapshot: JSON.parse(version.snapshot),
  });
}

async function restoreVersion(request: Request, ctx: DataContext, presId: string, versionId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  const canEdit = await canEditPresentation(request, ctx, presId);
  if (!canEdit) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Cannot restore version', status: 403 });
  }

  const version = await ctx.env.DB.prepare(`SELECT snapshot FROM presentation_versions WHERE presentation_id = ? AND id = ?`)
    .bind(presId, versionId)
    .first<{ snapshot: string }>();

  if (!version) {
    return errorResponse({ code: 'VERSION_NOT_FOUND', message: 'Version not found', status: 404 });
  }

  const snapshot = JSON.parse(version.snapshot) as Array<Slide & { notes: string }>;

  await ctx.env.DB.prepare(`DELETE FROM slides WHERE presentation_id = ?`).bind(presId).run();

  const now = new Date().toISOString();

  for (const slide of snapshot) {
    const newId = generateId('slide');
    await ctx.env.DB.prepare(
      `INSERT INTO slides (id, presentation_id, position, owner_id, override_background, override_fonts, override_transition, content, hidden, locked, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        newId,
        presId,
        slide.position,
        slide.ownerId,
        slide.overrideBackground,
        slide.overrideFonts ? JSON.stringify(slide.overrideFonts) : null,
        slide.overrideTransition ? JSON.stringify(slide.overrideTransition) : null,
        slide.content,
        slide.hidden ? 1 : 0,
        slide.locked ? 1 : 0,
        now,
        now
      )
      .run();

    if (slide.notes) {
      const noteId = generateId('note');
      await ctx.env.DB.prepare(`INSERT INTO slide_notes (id, slide_id, content, updated_at) VALUES (?, ?, ?, ?)`)
        .bind(noteId, newId, slide.notes, now)
        .run();
    }
  }

  await ctx.env.DB.prepare(`UPDATE presentations SET updated_at = ? WHERE id = ?`).bind(now, presId).run();

  return successResponse({ restored: true });
}

async function deleteVersion(request: Request, ctx: DataContext, presId: string, versionId: string): Promise<Response> {
  const isOwner = await verifyOwner(request, ctx);
  if (!isOwner) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only owner can delete versions', status: 403 });
  }

  const version = await ctx.env.DB.prepare(`SELECT id FROM presentation_versions WHERE presentation_id = ? AND id = ?`)
    .bind(presId, versionId)
    .first();

  if (!version) {
    return errorResponse({ code: 'VERSION_NOT_FOUND', message: 'Version not found', status: 404 });
  }

  await ctx.env.DB.prepare(`DELETE FROM presentation_versions WHERE id = ?`).bind(versionId).run();

  return successResponse({ deleted: true });
}

async function getVersionDiff(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  const url = new URL(request.url);
  const fromId = url.searchParams.get('from');
  const toId = url.searchParams.get('to');

  if (!fromId || !toId) {
    return errorResponse({ code: 'INVALID_REQUEST', message: 'from and to version IDs required', status: 400 });
  }

  const fromVersion = await ctx.env.DB.prepare(`SELECT snapshot FROM presentation_versions WHERE presentation_id = ? AND id = ?`)
    .bind(presId, fromId)
    .first<{ snapshot: string }>();

  const toVersion = await ctx.env.DB.prepare(`SELECT snapshot FROM presentation_versions WHERE presentation_id = ? AND id = ?`)
    .bind(presId, toId)
    .first<{ snapshot: string }>();

  if (!fromVersion) {
    return errorResponse({ code: 'VERSION_NOT_FOUND', message: 'From version not found', status: 404 });
  }

  if (!toVersion) {
    return errorResponse({ code: 'VERSION_NOT_FOUND', message: 'To version not found', status: 404 });
  }

  const fromSlides = JSON.parse(fromVersion.snapshot) as Array<{ id: string; content: string; position: number }>;
  const toSlides = JSON.parse(toVersion.snapshot) as Array<{ id: string; content: string; position: number }>;

  const fromIds = new Set(fromSlides.map((s) => s.id));
  const toIds = new Set(toSlides.map((s) => s.id));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const toSlide of toSlides) {
    if (!fromIds.has(toSlide.id)) {
      added.push(toSlide.id);
    } else {
      const fromSlide = fromSlides.find((s) => s.id === toSlide.id);
      if (fromSlide && fromSlide.content !== toSlide.content) {
        modified.push(toSlide.id);
      }
    }
  }

  for (const fromSlide of fromSlides) {
    if (!toIds.has(fromSlide.id)) {
      removed.push(fromSlide.id);
    }
  }

  const fromOrder = fromSlides.map((s) => s.id).join(',');
  const toOrder = toSlides
    .filter((s) => fromIds.has(s.id))
    .map((s) => s.id)
    .join(',');
  const reordered = fromOrder !== toOrder && fromSlides.length > 0;

  const metadataChanged: string[] = [];

  return successResponse({
    slides: {
      added,
      removed,
      modified,
      reordered,
    },
    metadata: {
      changed: metadataChanged,
    },
  });
}

