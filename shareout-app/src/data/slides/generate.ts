import { errorResponse, successResponse, verifyOwner, type DataContext } from '../middleware';
import { logSlidesAiFailure, userFacingAgentCompletionError } from '../agent/errors';
import { chat, getBuildConfig } from '../agent/anthropic';

const MAX_PROMPT_LENGTH = 4000;
const DEFAULT_LENGTH = 8;
const MAX_LENGTH = 30;

/** Layout names the SDK can render (mirrors LayoutHelpers public methods). */
const ALLOWED_LAYOUTS = new Set([
  'title',
  'section',
  'titleContent',
  'twoCol',
  'imageText',
  'fullImage',
  'bigStat',
  'quote',
  'cards',
  'chart',
  'blank',
]);

interface GeneratedSlide {
  layout?: string;
  html?: string;
  [key: string]: unknown;
}

function buildSystemPrompt(length: number): string {
  return `You are a presentation designer. Given a topic, produce a concise, well-structured slide deck.

Return ONLY a JSON object (no markdown, no prose) of the form:
{ "title": "Deck title", "slides": [ ...slide specs... ] }

Each slide spec is one of these layouts. Use the slot fields shown; omit optional slots you don't need:
- { "layout": "title", "title": str, "subtitle"?: str, "eyebrow"?: str }
- { "layout": "section", "number"?: str|num, "title": str, "subtitle"?: str }
- { "layout": "titleContent", "title": str, "body": str }   // body is plain text or simple HTML
- { "layout": "twoCol", "title"?: str, "left": str, "right": str }
- { "layout": "imageText", "image": url, "title": str, "body": str, "side"?: "left"|"right" }
- { "layout": "bigStat", "value": str, "label": str, "context"?: str }
- { "layout": "quote", "text": str, "author"?: str, "role"?: str }
- { "layout": "cards", "title"?: str, "cards": [ { "icon"?: emoji, "title": str, "body": str } ] }
- { "layout": "chart", "title"?: str, "chart": { "type": "bar"|"line"|"pie", "data": [ { "label": str, "value": num } ] }, "insight"?: str }

Rules:
- Aim for about ${length} slides. Open with a "title" slide.
- One idea per slide. Keep text tight (headlines short, max ~6 bullet-like points).
- Do not invent image URLs; prefer layouts without images unless the user supplies one.
- Output valid JSON only.`;
}

/** Extract a JSON object from a model response that may be fenced or prefixed. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object in response');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Keep only specs with a known layout or a raw html escape hatch. */
function sanitizeSlides(raw: unknown): GeneratedSlide[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is GeneratedSlide => {
    if (!s || typeof s !== 'object') return false;
    const spec = s as GeneratedSlide;
    if (typeof spec.html === 'string') return true;
    return typeof spec.layout === 'string' && ALLOWED_LAYOUTS.has(spec.layout);
  });
}

export async function handleGenerateRoute(request: Request, ctx: DataContext): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  const isOwner = await verifyOwner(request, ctx);
  if (!isOwner) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Only owner can generate decks', status: 403 });
  }

  let body: { prompt?: string; length?: number };
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_JSON', message: 'Invalid JSON body', status: 400 });
  }

  const prompt = (body.prompt || '').trim();
  if (!prompt) {
    return errorResponse({ code: 'INVALID_REQUEST', message: 'prompt is required', status: 400 });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return errorResponse({ code: 'PROMPT_TOO_LARGE', message: `Prompt exceeds ${MAX_PROMPT_LENGTH} characters`, status: 400 });
  }

  const length = Math.min(Math.max(body.length || DEFAULT_LENGTH, 1), MAX_LENGTH);

  if (!getBuildConfig(ctx.env)) {
    return errorResponse({ code: 'AI_UNAVAILABLE', message: 'AI provider not configured', status: 503 });
  }

  let content: string;
  try {
    const result = await chat(
      ctx.env,
      [{ role: 'user', content: prompt }],
      buildSystemPrompt(length),
      '',
      4096,
      getBuildConfig(ctx.env)
    );
    content = result.content;
  } catch (e) {
    logSlidesAiFailure(ctx.env, 'slides generate completion failed', e, {
      artifactId: ctx.artifactId,
      route: 'generate',
    });
    return errorResponse({
      code: 'AI_ERROR',
      message: userFacingAgentCompletionError(e),
      status: 502,
    });
  }

  let parsed: { title?: unknown; slides?: unknown };
  try {
    parsed = extractJson(content) as { title?: unknown; slides?: unknown };
  } catch {
    return errorResponse({ code: 'AI_BAD_OUTPUT', message: 'Model did not return valid JSON', status: 502 });
  }

  const slides = sanitizeSlides(parsed.slides);
  if (slides.length === 0) {
    return errorResponse({ code: 'AI_BAD_OUTPUT', message: 'Model returned no usable slides', status: 502 });
  }

  return successResponse({
    title: typeof parsed.title === 'string' ? parsed.title : null,
    slides,
    count: slides.length,
  });
}
