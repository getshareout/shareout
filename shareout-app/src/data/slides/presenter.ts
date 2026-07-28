import { errorResponse, successResponse, verifyOwner, type DataContext } from '../middleware';
import { getSession } from './auth';
import { broadcastEvent } from './realtime';

export async function handlePresenterRoutes(
  request: Request,
  ctx: DataContext,
  presId: string,
  parts: string[]
): Promise<Response> {
  const action = parts[0];

  switch (action) {
    case 'start':
      return startPresentation(request, ctx, presId);
    case 'stop':
      return stopPresentation(request, ctx, presId);
    case 'navigate':
      return navigatePresentation(request, ctx, presId);
    case 'state':
      return getPresenterState(ctx, presId);
    case 'timer':
      return handlePresenterTimer(request, ctx, presId);
    case 'laser':
      return handlePresenterLaser(request, ctx, presId);
    default:
      return errorResponse({ code: 'NOT_FOUND', message: 'Presenter action not found', status: 404 });
  }
}

async function startPresentation(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  let body: { fromSlide?: number; countdown?: number } = {};
  try {
    body = await request.json();
  } catch {
    // Use defaults
  }

  const session = await getSession(request, ctx);
  const now = new Date().toISOString();
  const slideIndex = body.fromSlide ?? 0;

  await ctx.env.DB.prepare(
    `INSERT INTO presentation_state (
      presentation_id, is_presenting, presenter_id, presenter_name, current_slide_index,
      started_at, slide_started_at, countdown_total, countdown_remaining, countdown_paused,
      laser_enabled, laser_x, laser_y, updated_at
    )
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, ?)
     ON CONFLICT(presentation_id) DO UPDATE SET
       is_presenting = 1, presenter_id = ?, presenter_name = ?, current_slide_index = ?,
       started_at = ?, slide_started_at = ?, countdown_total = ?, countdown_remaining = ?, countdown_paused = 0,
       laser_enabled = 0, laser_x = NULL, laser_y = NULL, updated_at = ?`
  )
    .bind(
      presId,
      session?.userId || null,
      session?.name || null,
      slideIndex,
      now,
      now,
      body.countdown || null,
      body.countdown || null,
      now,
      session?.userId || null,
      session?.name || null,
      slideIndex,
      now,
      now,
      body.countdown || null,
      body.countdown || null,
      now
    )
    .run();

  await broadcastEvent(ctx, presId, {
    type: 'presenter:changed',
    data: { isPresenting: true, presenterId: session?.userId, presenterName: session?.name, currentSlideIndex: slideIndex, startedAt: now },
  });

  return successResponse({ started: true, startedAt: now, userId: session?.userId });
}

async function stopPresentation(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  await ctx.env.DB.prepare(`UPDATE presentation_state SET is_presenting = 0, updated_at = ? WHERE presentation_id = ?`)
    .bind(new Date().toISOString(), presId)
    .run();

  await broadcastEvent(ctx, presId, {
    type: 'presenter:changed',
    data: { isPresenting: false, presenterId: null, currentSlideIndex: 0 },
  });

  return successResponse({ stopped: true });
}

async function navigatePresentation(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  let body: { slideIndex: number };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  if (typeof body.slideIndex !== 'number') {
    return errorResponse({ code: 'INVALID_REQUEST', message: 'slideIndex required', status: 400 });
  }

  const state = await ctx.env.DB.prepare(`SELECT * FROM presentation_state WHERE presentation_id = ?`)
    .bind(presId)
    .first<{ presenter_id: string | null }>();

  if (!state) {
    return errorResponse({ code: 'NOT_PRESENTING', message: 'Presentation not started', status: 400 });
  }

  const session = await getSession(request, ctx);
  const isOwner = await verifyOwner(request, ctx);

  if (!isOwner && state.presenter_id !== session?.userId) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only presenter can navigate', status: 403 });
  }

  const now = new Date().toISOString();
  await ctx.env.DB.prepare(
    `UPDATE presentation_state SET current_slide_index = ?, slide_started_at = ?, updated_at = ? WHERE presentation_id = ?`
  )
    .bind(body.slideIndex, now, now, presId)
    .run();

  await broadcastEvent(ctx, presId, {
    type: 'presenter:changed',
    data: { currentSlideIndex: body.slideIndex, slideStartedAt: now },
  });

  return successResponse({ navigated: true, slideIndex: body.slideIndex });
}

async function getPresenterState(ctx: DataContext, presId: string): Promise<Response> {
  const state = await ctx.env.DB.prepare(`SELECT * FROM presentation_state WHERE presentation_id = ?`)
    .bind(presId)
    .first<{
      is_presenting: number;
      presenter_id: string | null;
      presenter_name: string | null;
      current_slide_index: number;
      started_at: string | null;
      slide_started_at: string | null;
      countdown_total: number | null;
      countdown_remaining: number | null;
      countdown_paused: number | null;
      laser_enabled: number | null;
      laser_x: number | null;
      laser_y: number | null;
      updated_at: string;
    }>();

  const slideCount = await ctx.env.DB.prepare(`SELECT COUNT(*) as cnt FROM slides WHERE presentation_id = ?`)
    .bind(presId)
    .first<{ cnt: number }>();

  if (!state) {
    return successResponse({
      isPresenting: false,
      presenterId: null,
      presenterName: null,
      currentSlideIndex: 0,
      totalSlides: slideCount?.cnt || 0,
      startedAt: null,
      slideStartedAt: null,
      countdown: null,
      laser: { enabled: false, position: null },
    });
  }

  return successResponse({
    isPresenting: state.is_presenting === 1,
    presenterId: state.presenter_id,
    presenterName: state.presenter_name,
    currentSlideIndex: state.current_slide_index,
    totalSlides: slideCount?.cnt || 0,
    startedAt: state.started_at,
    slideStartedAt: state.slide_started_at,
    countdown:
      state.countdown_total != null
        ? {
            total: state.countdown_total,
            remaining: state.countdown_remaining || 0,
            paused: state.countdown_paused === 1,
          }
        : null,
    laser: {
      enabled: state.laser_enabled === 1,
      position:
        state.laser_x != null && state.laser_y != null ? { x: state.laser_x, y: state.laser_y } : null,
    },
  });
}

async function handlePresenterTimer(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  const state = await ctx.env.DB.prepare(`SELECT presenter_id FROM presentation_state WHERE presentation_id = ?`)
    .bind(presId)
    .first<{ presenter_id: string | null }>();

  if (!state) {
    return errorResponse({ code: 'NOT_PRESENTING', message: 'Presentation not started', status: 400 });
  }

  const session = await getSession(request, ctx);
  const isOwner = await verifyOwner(request, ctx);

  if (!isOwner && state.presenter_id !== session?.userId) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only presenter can control timer', status: 403 });
  }

  let body: { action: 'setCountdown' | 'pause' | 'resume' | 'reset'; seconds?: number };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  const now = new Date().toISOString();

  switch (body.action) {
    case 'setCountdown':
      if (typeof body.seconds !== 'number' || body.seconds < 0) {
        return errorResponse({ code: 'INVALID_REQUEST', message: 'Invalid countdown seconds', status: 400 });
      }
      await ctx.env.DB.prepare(
        `UPDATE presentation_state SET countdown_total = ?, countdown_remaining = ?, countdown_paused = 0, updated_at = ? WHERE presentation_id = ?`
      )
        .bind(body.seconds, body.seconds, now, presId)
        .run();
      break;

    case 'pause':
      await ctx.env.DB.prepare(`UPDATE presentation_state SET countdown_paused = 1, updated_at = ? WHERE presentation_id = ?`)
        .bind(now, presId)
        .run();
      break;

    case 'resume':
      await ctx.env.DB.prepare(`UPDATE presentation_state SET countdown_paused = 0, updated_at = ? WHERE presentation_id = ?`)
        .bind(now, presId)
        .run();
      break;

    case 'reset':
      await ctx.env.DB.prepare(
        `UPDATE presentation_state SET countdown_remaining = countdown_total, countdown_paused = 0, updated_at = ? WHERE presentation_id = ?`
      )
        .bind(now, presId)
        .run();
      break;

    default:
      return errorResponse({ code: 'INVALID_REQUEST', message: 'Invalid timer action', status: 400 });
  }

  await broadcastEvent(ctx, presId, { type: 'presenter:changed', data: { timer: body.action } });

  return successResponse({ action: body.action });
}

async function handlePresenterLaser(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  const state = await ctx.env.DB.prepare(`SELECT presenter_id FROM presentation_state WHERE presentation_id = ?`)
    .bind(presId)
    .first<{ presenter_id: string | null }>();

  if (!state) {
    return errorResponse({ code: 'NOT_PRESENTING', message: 'Presentation not started', status: 400 });
  }

  const session = await getSession(request, ctx);
  const isOwner = await verifyOwner(request, ctx);

  if (!isOwner && state.presenter_id !== session?.userId) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only presenter can control laser', status: 403 });
  }

  let body: { enabled: boolean; x?: number; y?: number };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  const now = new Date().toISOString();

  await ctx.env.DB.prepare(
    `UPDATE presentation_state SET laser_enabled = ?, laser_x = ?, laser_y = ?, updated_at = ? WHERE presentation_id = ?`
  )
    .bind(body.enabled ? 1 : 0, body.x ?? null, body.y ?? null, now, presId)
    .run();

  await broadcastEvent(ctx, presId, {
    type: 'presenter:changed',
    data: { laser: { enabled: body.enabled, position: body.x != null && body.y != null ? { x: body.x, y: body.y } : null } },
  });

  return successResponse({ enabled: body.enabled, x: body.x, y: body.y });
}

