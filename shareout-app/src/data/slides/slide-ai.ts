import { generateId } from '../../crypto-utils';
import { errorResponse, successResponse, type DataContext } from '../middleware';
import { canEditSlide } from './auth';
import { logSlidesAiFailure, userFacingAgentCompletionError } from '../agent/errors';
import { chat, getBuildConfig } from '../agent/anthropic';
import { broadcastEvent } from './realtime';
import type { DbSlide } from './db';
import { mapSlide } from './db';
import { MAX_CONTENT_LENGTH } from './constants';

type AiAction = 'rewrite' | 'expand' | 'generateNotes' | 'suggestLayout';

const ACTIONS = new Set<AiAction>(['rewrite', 'expand', 'generateNotes', 'suggestLayout']);

const LAYOUTS = 'title, section, titleContent, twoCol, imageText, fullImage, bigStat, quote, cards, chart, blank';

function systemPrompt(action: AiAction): string {
  switch (action) {
    case 'rewrite':
      return `You edit a single presentation slide. The user gives you the slide's HTML and an optional instruction. Rewrite the slide to be clearer and tighter while preserving its structure and intent. Return ONLY the new slide HTML — no markdown fences, no commentary.`;
    case 'expand':
      return `You edit a single presentation slide. The user gives you the slide's HTML. Expand it with more detail and supporting points, keeping it presentation-appropriate (concise, scannable). Return ONLY the new slide HTML — no markdown fences, no commentary.`;
    case 'generateNotes':
      return `You write speaker notes for a presentation slide. The user gives you the slide's HTML. Write concise speaker notes (a short paragraph or a few talking points) the presenter can read aloud. Return ONLY the notes as plain text or simple markdown.`;
    case 'suggestLayout':
      return `You advise on presentation slide layout. The user gives you the slide's HTML. Suggest the single best layout from this list and explain briefly why: ${LAYOUTS}. Respond in one or two sentences.`;
  }
}

function stripFences(text: string): string {
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

export async function handleSlideAiRoute(
  request: Request,
  ctx: DataContext,
  presId: string,
  slideId: string
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

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

  let body: { action?: string; instruction?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  const action = body.action as AiAction;
  if (!ACTIONS.has(action)) {
    return errorResponse({ code: 'INVALID_REQUEST', message: 'Invalid action', status: 400 });
  }

  if (!getBuildConfig(ctx.env)) {
    return errorResponse({ code: 'AI_UNAVAILABLE', message: 'AI provider not configured', status: 503 });
  }

  const userMsg = [
    `Slide HTML:\n${slide.content || '(empty)'}`,
    body.instruction ? `Instruction: ${body.instruction}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  let output: string;
  try {
    const result = await chat(
      ctx.env,
      [{ role: 'user', content: userMsg }],
      systemPrompt(action),
      '',
      2048,
      getBuildConfig(ctx.env)
    );
    output = result.content;
  } catch (e) {
    logSlidesAiFailure(ctx.env, 'slide AI completion failed', e, {
      artifactId: ctx.artifactId,
      route: 'slide-ai',
      action,
    });
    return errorResponse({
      code: 'AI_ERROR',
      message: userFacingAgentCompletionError(e),
      status: 502,
    });
  }

  if (action === 'suggestLayout') {
    return successResponse({ suggestion: output.trim() });
  }

  if (action === 'generateNotes') {
    const notes = output.trim();
    await ctx.env.DB.prepare(
      `INSERT INTO slide_notes (id, slide_id, content, updated_at)
       VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(slide_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
    )
      .bind(generateId('note'), slideId, notes)
      .run();
    return successResponse({ notes });
  }

  // rewrite | expand → apply new content
  const content = stripFences(output);
  if (!content) {
    return errorResponse({ code: 'AI_BAD_OUTPUT', message: 'Model returned empty content', status: 502 });
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return errorResponse({ code: 'CONTENT_TOO_LARGE', message: `Content exceeds ${MAX_CONTENT_LENGTH} characters`, status: 400 });
  }

  const now = new Date().toISOString();
  await ctx.env.DB.prepare(`UPDATE slides SET content = ?, updated_at = ? WHERE id = ?`)
    .bind(content, now, slideId)
    .run();
  await ctx.env.DB.prepare(`UPDATE presentations SET updated_at = ? WHERE id = ?`).bind(now, presId).run();

  const updated = await ctx.env.DB.prepare(`SELECT * FROM slides WHERE id = ?`).bind(slideId).first<DbSlide>();
  await broadcastEvent(ctx, presId, { type: 'slide:updated', data: mapSlide(updated!) });

  return successResponse(mapSlide(updated!));
}
