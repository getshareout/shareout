import { errorResponse, successResponse, verifyOwner, type DataContext } from '../middleware';
import { generateId, sha256 } from '../../crypto-utils';

// Slides B2B P0 — viewer analytics (DocSend wedge).
// `beat` is the public capture endpoint hit by the read-only viewer; `getAnalytics`
// is the owner-only readout. Plain D1 writes, same pattern as presenter.ts.

interface BeatBody {
  sessionId?: string;
  slideIndex: number;
  slideId?: string | null;
  slideDwellMs?: number;       // accumulated dwell on this slide so far (client-tracked)
  sessionDurationMs?: number;  // total time in deck so far
  totalSlides?: number;
  completed?: boolean;
}

export async function handleAnalyticsRoutes(
  request: Request,
  ctx: DataContext,
  presId: string,
  parts: string[]
): Promise<Response> {
  const action = parts[0];

  if (action === 'beat') {
    return recordBeat(request, ctx, presId);
  }

  if (!action) {
    if (request.method !== 'GET') {
      return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
    }
    return getAnalytics(request, ctx, presId);
  }

  return errorResponse({ code: 'NOT_FOUND', message: 'Analytics action not found', status: 404 });
}

async function hashIp(ip: string, presId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${ip}:${presId}`);
  return (await sha256(bytes.buffer as ArrayBuffer)).slice(0, 32);
}

// Public — any viewer (anonymous) posts heartbeats. Never trust the body for identity.
async function recordBeat(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  let body: BeatBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  const slideIndex = Number.isInteger(body.slideIndex) ? body.slideIndex : 0;
  if (slideIndex < 0) {
    return errorResponse({ code: 'INVALID_SLIDE_INDEX', message: 'slideIndex must be >= 0', status: 400 });
  }

  const now = new Date().toISOString();
  const dnt = request.headers.get('DNT') === '1';
  const slideDwellMs = Math.max(0, Math.floor(body.slideDwellMs ?? 0));
  const sessionDurationMs = Math.max(0, Math.floor(body.sessionDurationMs ?? 0));
  const completed = body.completed ? 1 : 0;

  let sessionId = typeof body.sessionId === 'string' && body.sessionId.startsWith('ses_') ? body.sessionId : null;

  // Confirm an existing session actually belongs to this presentation; else mint a new one.
  if (sessionId) {
    const owns = await ctx.env.DB.prepare(
      `SELECT id FROM view_sessions WHERE id = ? AND presentation_id = ?`
    ).bind(sessionId, presId).first();
    if (!owns) sessionId = null;
  }

  if (!sessionId) {
    sessionId = generateId('ses');
    const rawIp = request.headers.get('CF-Connecting-IP') || '';
    const ipHash = dnt || !rawIp ? null : await hashIp(rawIp, presId);
    const ua = dnt ? null : (request.headers.get('User-Agent') || '').slice(0, 400);
    const country = dnt ? null : ((request as { cf?: { country?: string } }).cf?.country ?? null);
    await ctx.env.DB.prepare(
      `INSERT INTO view_sessions (
        id, presentation_id, artifact_id, ip_hash, user_agent, country,
        started_at, last_seen_at, completed, duration_ms, slides_seen
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).bind(sessionId, presId, ctx.artifactId, ipHash, ua, country, now, now, completed, sessionDurationMs).run();
  } else {
    await ctx.env.DB.prepare(
      `UPDATE view_sessions
         SET last_seen_at = ?, duration_ms = MAX(duration_ms, ?), completed = MAX(completed, ?)
       WHERE id = ?`
    ).bind(now, sessionDurationMs, completed, sessionId).run();
  }

  // Upsert per-slide dwell. dwell is client-accumulated → SET to the larger value (idempotent).
  await ctx.env.DB.prepare(
    `INSERT INTO slide_views (id, session_id, presentation_id, slide_id, slide_index, entered_at, dwell_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, slide_index) DO UPDATE SET
       dwell_ms = MAX(dwell_ms, excluded.dwell_ms),
       slide_id = COALESCE(excluded.slide_id, slide_id)`
  ).bind(generateId('sv'), sessionId, presId, body.slideId ?? null, slideIndex, now, slideDwellMs).run();

  const seen = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM slide_views WHERE session_id = ?`
  ).bind(sessionId).first<{ n: number }>();
  await ctx.env.DB.prepare(
    `UPDATE view_sessions SET slides_seen = ? WHERE id = ?`
  ).bind(seen?.n ?? 1, sessionId).run();

  return successResponse({ sessionId }, 200, ctx.origin);
}

// Owner-only — engagement readout for the deck.
async function getAnalytics(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  const isOwner = await verifyOwner(request, ctx);
  if (!isOwner) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only the owner can view analytics', status: 403 });
  }

  const summary = await ctx.env.DB.prepare(
    `SELECT
       COUNT(*) AS total_views,
       COUNT(DISTINCT COALESCE(ip_hash, id)) AS unique_viewers,
       COALESCE(AVG(duration_ms), 0) AS avg_duration_ms,
       COALESCE(AVG(completed), 0) AS completion_rate
     FROM view_sessions WHERE presentation_id = ?`
  ).bind(presId).first<{ total_views: number; unique_viewers: number; avg_duration_ms: number; completion_rate: number }>();

  const perSlideRows = await ctx.env.DB.prepare(
    `SELECT slide_index, COUNT(*) AS views, COALESCE(AVG(dwell_ms), 0) AS avg_dwell_ms
     FROM slide_views WHERE presentation_id = ?
     GROUP BY slide_index ORDER BY slide_index ASC`
  ).bind(presId).all<{ slide_index: number; views: number; avg_dwell_ms: number }>();

  const firstSlideViews = perSlideRows.results.find((r) => r.slide_index === 0)?.views
    ?? perSlideRows.results[0]?.views ?? 0;
  const perSlide = perSlideRows.results.map((r) => ({
    slideIndex: r.slide_index,
    views: r.views,
    avgDwellMs: Math.round(r.avg_dwell_ms),
    dropOffRate: firstSlideViews > 0 ? Math.max(0, 1 - r.views / firstSlideViews) : 0,
  }));

  const sessionRows = await ctx.env.DB.prepare(
    `SELECT id, viewer_email, country, user_agent, slides_seen, duration_ms, completed, started_at, last_seen_at
     FROM view_sessions WHERE presentation_id = ?
     ORDER BY started_at DESC LIMIT 100`
  ).bind(presId).all<{
    id: string; viewer_email: string | null; country: string | null; user_agent: string | null;
    slides_seen: number; duration_ms: number; completed: number; started_at: string; last_seen_at: string;
  }>();

  const sessions = sessionRows.results.map((s) => ({
    id: s.id,
    viewerEmail: s.viewer_email,
    country: s.country,
    device: deviceLabel(s.user_agent),
    slidesSeen: s.slides_seen,
    durationMs: s.duration_ms,
    completed: s.completed === 1,
    startedAt: s.started_at,
    lastSeenAt: s.last_seen_at,
  }));

  return successResponse({
    summary: {
      totalViews: summary?.total_views ?? 0,
      uniqueViewers: summary?.unique_viewers ?? 0,
      avgDurationMs: Math.round(summary?.avg_duration_ms ?? 0),
      completionRate: summary?.completion_rate ?? 0,
    },
    perSlide,
    sessions,
  }, 200, ctx.origin);
}

function deviceLabel(ua: string | null): string {
  if (!ua) return 'Unknown';
  if (/Mobi|Android|iPhone|iPad/i.test(ua)) return 'Mobile';
  if (/Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Desktop';
}
